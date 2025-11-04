const { GetCommand, PutCommand, ScanCommand,DeleteCommand,UpdateCommand } = require("@aws-sdk/lib-dynamodb"); // Add ScanCommand here
const { docClient } = require("../utils/dynamodb");
const { uploadFile } = require("../utils/s3");
const bcrypt = require('bcryptjs');

const usersTable = process.env.USERS_TABLE;
const labelsTable = process.env.LABELS_TABLE;

exports.createLabeler = async (req, res) => {
  const { name, email, password } = req.body;

  // Validation
  if (!name || !email || !password) {
    return res.status(400).json({ 
      success: false,
      message: "Name, email, and password are required" 
    });
  }

  try {
    // Check if user exists
    const existing = await docClient.send(new GetCommand({
      TableName: usersTable,
      Key: { email },
    }));

    if (existing.Item) {
      return res.status(400).json({ 
        success: false,
        message: "User already exists with this email" 
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create new labeler user
    const userItem = {
      email,
      name,
      password: hashedPassword,
      role: "labeler",
      createdAt: new Date().toISOString(),
      isActive: true
    };

    await docClient.send(new PutCommand({
      TableName: usersTable,
      Item: userItem
    }));

    // Remove password from response
    const { password: _, ...userResponse } = userItem;

    res.status(201).json({
      success: true,
      message: "Labeler created successfully",
      user: userResponse
    });

  } catch (err) {
    console.error("Create labeler error:", err);
    res.status(500).json({ 
      success: false,
      message: "Server error while creating labeler" 
    });
  }
};


// Get all labelers for admin management
exports.getLabelers = async (req, res) => {
  try {
    // Note: This is a simplified approach. In production, we might want to use GSI for role-based queries
    const result = await docClient.send(new ScanCommand({
      TableName: usersTable,
      FilterExpression: "role = :role",
      ExpressionAttributeValues: {
        ":role": "labeler"
      }
    }));

    const labelers = result.Items.map(user => {
      const { password, ...userWithoutPassword } = user;
      return userWithoutPassword;
    });

    res.json({
      success: true,
      labelers: labelers
    });

  } catch (err) {
    console.error("Get labelers error:", err);
    res.status(500).json({ 
      success: false,
      message: "Server error while fetching labelers" 
    });
  }
};


exports.delete_user = async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    console.log(`Starting deletion process for user: ${email}`);

    // 1. Delete user from Users table
    try {
      const deleteCommand = new DeleteCommand({
        TableName: usersTable,
        Key: { email }
      });
      await docClient.send(deleteCommand);
      console.log(`Deleted user ${email} from Users table`);
    } catch (error) {
      console.log(`User ${email} not found in Users table, continuing cleanup...`);
    }

    // 2. Find all audio files this user has labeled using blacklisted_users column
    const scanParams = {
      TableName: labelsTable,
      FilterExpression: 'contains(blacklisted_users, :email)',
      ExpressionAttributeValues: {
        ':email': email
      }
    };

    let audioFiles = [];
    let lastEvaluatedKey = null;
    
    try {
      let scanResult;
      do {
        const scanCommandParams = { ...scanParams };
        
        if (lastEvaluatedKey) {
          scanCommandParams.ExclusiveStartKey = lastEvaluatedKey;
        }
        
        const scanCommand = new ScanCommand(scanCommandParams);
        scanResult = await docClient.send(scanCommand);
        
        audioFiles = audioFiles.concat(scanResult.Items);
        lastEvaluatedKey = scanResult.LastEvaluatedKey;
      } while (lastEvaluatedKey);
    } catch (scanError) {
      console.error('Error scanning audio files:', scanError);
      return res.status(500).json({
        success: false,
        message: 'Error scanning audio files: ' + scanError.message
      });
    }
    console.log(`Found ${audioFiles.length} audio files labeled by user ${email}`);

    // 3. Process each audio file to remove user's data
    let processedFiles = 0;
    let totalLabelsRemoved = 0;

    for (const audioFile of audioFiles) {
      try {
        console.log(`\n=== Processing audio file: ${audioFile.id} ===`);
        
        const setExpressions = [];
        const removeExpressions = [];
        const expressionAttributeNames = {};
        const expressionAttributeValues = {};

        // Track labels to remove from label_map
        const labelsToRemove = new Set();

        // // Remove user from blacklisted_users - Handle DynamoDB Set format
        // let currentBlacklisted = [];
        
        // if (audioFile.blacklisted_users) {
        //   // Check for DynamoDB Set format (has 'values' array)
        //   if (audioFile.blacklisted_users.values && Array.isArray(audioFile.blacklisted_users.values)) {
        //     // It's a DynamoDB Set - extract the values array
        //     currentBlacklisted = audioFile.blacklisted_users.values;
        //   } else if (Array.isArray(audioFile.blacklisted_users)) {
        //     // It's already a plain array
        //     currentBlacklisted = audioFile.blacklisted_users;
        //   } else if (typeof audioFile.blacklisted_users === 'string') {
        //     // It's a single string
        //     currentBlacklisted = [audioFile.blacklisted_users];
        //   }
        //   console.log(`Current blacklisted_users:`, currentBlacklisted);
        // }

        // if (currentBlacklisted.includes(email)) {
        //   console.log(`Removing user from blacklisted_users`);
        //   const updatedBlacklisted = currentBlacklisted.filter(user => user !== email);
        //   setExpressions.push('blacklisted_users = :newBlacklisted');
        //   expressionAttributeValues[':newBlacklisted'] = new Set(updatedBlacklisted);
        // }

        // Process labeling_history (array of objects based on submission code)
        if (audioFile.labeling_history && Array.isArray(audioFile.labeling_history)) {
          console.log(`Processing labeling_history with ${audioFile.labeling_history.length} entries`);
          
          const userEntries = audioFile.labeling_history.filter(entry => 
            entry && entry.userEmail === email
          );

          console.log(`Found ${userEntries.length} user entries to remove`);

          if (userEntries.length > 0) {
            // Collect finalLabels to remove from label_map
            userEntries.forEach(entry => {
              if (entry.finalLabel) {
                labelsToRemove.add(entry.finalLabel);
                totalLabelsRemoved++;
                console.log(`✅ Added label to remove: ${entry.finalLabel}`);
              }
            });

            // Remove user entries from labeling_history
            const updatedLabelingHistory = audioFile.labeling_history.filter(entry => 
              !entry || entry.userEmail !== email
            );

            setExpressions.push('labeling_history = :newLabelingHistory');
            expressionAttributeValues[':newLabelingHistory'] = updatedLabelingHistory;
            console.log(`Will remove ${userEntries.length} entries from labeling_history`);
          }
        }

        // Remove matching entries from label_map (array of strings based on submission code)
        if (audioFile.label_map && Array.isArray(audioFile.label_map) && labelsToRemove.size > 0) {
          console.log(`Processing label_map with ${audioFile.label_map.length} entries`);
          console.log(`Labels to remove:`, Array.from(labelsToRemove));
          
          const updatedLabelMap = [];
          const removedLabels = new Set();
          
          for (const labelItem of audioFile.label_map) {
            // label_map contains direct strings like "dry_mild-to-medium_child_female"
            const labelString = labelItem;
            
            // Remove only the first occurrence of each label
            if (labelString && labelsToRemove.has(labelString) && !removedLabels.has(labelString)) {
              console.log(`✅ Removing label from label_map: ${labelString}`);
              removedLabels.add(labelString);
            } else {
              updatedLabelMap.push(labelItem);
            }
          }

          if (updatedLabelMap.length < audioFile.label_map.length) {
            setExpressions.push('label_map = :newLabelMap');
            expressionAttributeValues[':newLabelMap'] = updatedLabelMap;
            console.log(`Updated label_map from ${audioFile.label_map.length} to ${updatedLabelMap.length} entries`);
          } else {
            console.log('No labels were removed from label_map');
          }
        }

        // Fix label_count based on actual labeling_history length
        if (audioFile.labeling_history && Array.isArray(audioFile.labeling_history)) {
          const userEntriesCount = audioFile.labeling_history.filter(entry => 
            entry && entry.userEmail === email
          ).length;
          
          const currentLabelCount = audioFile.label_count || 0;
          const newLabelCount = Math.max(0, currentLabelCount - userEntriesCount);
          
          console.log(`Updating label_count: ${currentLabelCount} - ${userEntriesCount} = ${newLabelCount}`);
          
          if (newLabelCount !== currentLabelCount) {
            setExpressions.push('label_count = :newLabelCount');
            expressionAttributeValues[':newLabelCount'] = newLabelCount;
          }
        }

        // Build the final UpdateExpression
        const updateExpressions = [];
        
        if (setExpressions.length > 0) {
          updateExpressions.push(`SET ${setExpressions.join(', ')}`);
        }
        
        if (removeExpressions.length > 0) {
          updateExpressions.push(`REMOVE ${removeExpressions.join(', ')}`);
        }

        console.log('Final UpdateExpression:', updateExpressions.join(' '));
        console.log('ExpressionAttributeValues:', JSON.stringify(expressionAttributeValues, null, 2));

        // Only update if there are changes to make
        if (updateExpressions.length > 0) {
          const primaryKey = {
            id: audioFile.id
          };

          const updateCommand = new UpdateCommand({
            TableName: labelsTable,
            Key: primaryKey,
            UpdateExpression: updateExpressions.join(' '),
            ExpressionAttributeNames: Object.keys(expressionAttributeNames).length > 0 ? expressionAttributeNames : undefined,
            ExpressionAttributeValues: Object.keys(expressionAttributeValues).length > 0 ? expressionAttributeValues : undefined,
            ReturnValues: 'NONE'
          });

          await docClient.send(updateCommand);
          processedFiles++;
          console.log(`✅ Updated audio file ${primaryKey.id}, removed ${labelsToRemove.size} labels`);
        } else {
          console.log('❌ No changes to make for this audio file');
        }
      } catch (fileError) {
        console.error(`❌ Error processing audio file:`, fileError);
        console.error('Error details:', fileError.message);
        console.error('Failed ExpressionAttributeValues:', JSON.stringify(expressionAttributeValues, null, 2));
      }
    }

    res.json({
      success: true,
      message: `User ${email} deletion process completed`,
      details: {
        userRemoved: true,
        audioFilesFound: audioFiles.length,
        audioFilesUpdated: processedFiles,
        totalLabelsRemoved: totalLabelsRemoved
      }
    });

  } catch (error) {
    console.error('DynamoDB deletion error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting user from DynamoDB: ' + error.message
    });
  }
};
