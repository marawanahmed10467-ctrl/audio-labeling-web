const express = require('express');
const multer = require('multer');
const { PutCommand, ScanCommand, UpdateCommand, QueryCommand, GetCommand} = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../utils/dynamodb');
const { getPresignedUrl } = require('../utils/s3');
const { uploadFile } = require('../utils/s3'); 
const { createLabeler, getLabelers, delete_user } = require('../controllers/adminController');
const { updateAudioMetrics,copyToLabeledItems } = require('../utils/labelsHandlers'); 
//const { updateUserActivity, trackLabelSubmission, getActiveUsers } = require('../controllers/userController');



const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, 
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed'), false);
    }
  }
});

const TARGET_LABELS = 2;
const RESERVATION_TIMEOUT = 120000; // 2 minutes
const activeUsers = new Map(); // userEmail -> lastActivity

async function getUserRequestCount(userEmail) {
  try {
    const result = await docClient.send(new GetCommand({
      TableName: process.env.USERS_TABLE,
      Key: { email: userEmail }
    }));
    
    return result.Item?.requestCount || 0;
  } catch (error) {
    console.log('❌ CATCH BLOCK - Error:', error.message);
    return 0;
  }
}

async function updateUserRequestCount(userEmail) {
  console.log('🔍 [1] updateUserRequestCount started for:', userEmail);
  
  const currentCount = await getUserRequestCount(userEmail);
  console.log('🔍 [2] currentCount:', currentCount, 'type:', typeof currentCount);
  
  let newCount = currentCount + 1;
  console.log('🔍 [3] newCount after +1:', newCount, 'type:', typeof newCount);
  
  // Reset when it reaches 20
  if (newCount > 20) {
    newCount = 0;
    console.log(`🔄 Reset count for ${userEmail} back to 0 (reached limit)`);
  }
  
  console.log('🔍 [4] Final newCount to save:', newCount);
  
  const updateResult = await docClient.send(new UpdateCommand({
    TableName: process.env.USERS_TABLE,
    Key: { email: userEmail },
    UpdateExpression: 'SET requestCount = :newCount',
    ExpressionAttributeValues: {
      ':newCount': newCount
    }
  }));
  
  console.log('🔍 [5] UpdateCommand result:', updateResult);
  console.log('🔍 [6] Returning newCount:', newCount, 'type:', typeof newCount);
  
  return newCount;
}

// Labeler Management Routes
router.post('/create-labeler', createLabeler);
router.get('/labelers', getLabelers);
router.delete(`/delete-user`,delete_user);

// Enhanced audio upload with priority system
router.post('/upload-audio', upload.array('audio', 10000), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ 
        success: false,
        message: "No audio files uploaded" 
      });
    }

    const { priority: explicitPriority } = req.body;
    const uploaded = [];

    for (const file of req.files) {
      if (!file.mimetype.startsWith('audio/')) {
        continue;
      }
      function detectPriorityFromPath(objectKey) {
        const pathParts = objectKey.split('/');
        console.log(`🔍 Analyzing path: ${objectKey}`);
        console.log(`📁 Path parts:`, pathParts);

        // Look for priority in the first level of folders
        // Since bucket root has high/, medium/, low/ directly
        if (pathParts.length > 0) {
          const firstFolder = pathParts[0].toLowerCase();
          console.log(`🎯 Checking first folder: ${firstFolder}`);
          
          if (['high', 'medium', 'low','standard'].includes(firstFolder)) {
            console.log(`✅ Detected priority: ${firstFolder}`);
            return firstFolder;
          }
        }

        // Fallback: check any folder level for priority
        for (let i = 0; i < pathParts.length - 1; i++) {
          const folder = pathParts[i].toLowerCase();
          if (['high', 'medium', 'low','standard'].includes(folder)) {
            console.log(`✅ Detected priority in nested folder: ${folder}`);
            return folder;
          }
        }

        // Default to 'high' if no priority folder found anywhere
        console.log(`⚡ No priority folder found, defaulting to 'high'`);
        return 'high';
      }

      const detectedPriority = detectPriorityFromPath(file.originalname);
      const finalPriority = explicitPriority || detectedPriority;
      
      // Clean filename (remove folder paths)
      const fileName = file.originalname.split('/').pop();
      const folder = `${finalPriority}`;
      const key = `${folder}/${Date.now()}-${fileName}`;

      console.log(`📁 File: ${file.originalname} → Priority: ${finalPriority}, Key: ${key}`);
      await uploadFile(file, key);

      // Register in DynamoDB with consistent schema
      const audioItem = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        created_at: Date.now(),
        s3_key: key,
        original_name: fileName,
        file_size: file.size,
        mime_type: file.mimetype,
        priority: finalPriority,
        label_count: 0,
        target_labels: 3,
        label_map: [],
        label_confidence: 0,
        labeling_history: [],
        average_labeling_time: 0,
        last_labeled_at: null
      };

      await docClient.send(new PutCommand({
        TableName: process.env.LABELS_TABLE,
        Item: audioItem
      }));

      uploaded.push({
        id: audioItem.id,
        original_name: fileName,
        key: key,
        priority: finalPriority
      });
    }

    res.json({
      success: true,
      message: `${uploaded.length} audio file(s) uploaded`,
      files: uploaded
    });

  } catch (err) {
    console.error("Audio upload failed:", err);
    res.status(500).json({ 
      success: false,
      message: "Server error during audio upload",
      error: err.message 
    });
  }
});

// Update on every request
async function updateUserActivity(userEmail) {
  activeUsers.set(userEmail, Date.now());
  
  // Cleanup inactive users (e.g., >5 minutes)
  const now = Date.now();
  for (const [email, lastActive] of activeUsers.entries()) {
    if (now - lastActive > 5 * 60 * 1000) {
      activeUsers.delete(email);
    }
  }
}

function getActiveUserCount() {
  return activeUsers.size;
}

function calculateDynamicLimit(activeUserCount) {
  const BASE_LIMIT = 10;
  const BUFFER_PER_USER = 1;
  const MAX_LIMIT = 100; 
  
  const calculated = BASE_LIMIT + (activeUserCount * BUFFER_PER_USER);
  return Math.min(calculated, MAX_LIMIT);
}



async function findCandidatesByPriority(userEmail, limit) {
  let priorities;

  if (userEmail != process.env.ADMIN_EMAIL) {
    priorities = ['high', 'medium', 'low'];
  } else {
    priorities = ['standard'];
  }

  for (const priority of priorities) {
    const candidates = await getAvailableAudios(priority, userEmail, limit);
    console.log(`I am trying to getAvailableAudios`);

    if (candidates && candidates.length > 0) {
      console.log(`✅ Found ${candidates.length} ${priority} priority candidates`);
      return { priority, candidates };
    }
  }

  return null;
}

// async function getAvailableAudios(priority, userEmail, limit = 15) {
//   console.log(`🔍 Getting ${priority} priority audios - USING SCAN ONLY (index not available)`);
  
//   try {
//     const scanParams = {
//       TableName: process.env.LABELS_TABLE,
//       FilterExpression: 
//         'priority = :priority AND label_count < :target AND ' +
//         '(attribute_not_exists(reserved_until) OR reserved_until < :now) AND ' +
//         'attribute_not_exists(blacklisted_users)',
//       ExpressionAttributeValues: {
//         ':priority': priority,
//         ':target': TARGET_LABELS,
//         ':now': Date.now()
//       }
//     };
    
//     const result = await docClient.send(new ScanCommand(scanParams));
//     console.log(` After scanning, ${result.Items} found let me filer them`);
    
//     // Manual filtering for blacklisted users (since FilterExpression can't handle complex array checks easily)
//     const filteredItems = result.Items.filter(item => {
//       // Skip if user is blacklisted
//       if (item.blacklisted_users && item.blacklisted_users.includes(userEmail)) {
//         return false;
//       }
//       return true;
//     });
    
//     // Manual sorting (descending by label_count)
//     const sortedItems = filteredItems.sort((a, b) => {
//       const countA = a.label_count || 0;
//       const countB = b.label_count || 0;
//       return countB - countA; // Descending (2 → 1 → 0)
//     });
    
//     console.log(`✅ SCAN successful: Found ${filteredItems.length} ${priority} priority audios (after filtering)`);
//     return sortedItems.slice(0, limit);
    
//   } catch (scanError) {
//     console.error(`❌ SCAN failed for ${priority}:`, scanError.message);
//     return [];
//   }
// }
async function getAvailableAudios(priority, userEmail, limit) {
  let query; // Declare query outside if/else blocks
  
  if (userEmail == process.env.ADMIN_EMAIL) {
    console.log(`I am going to try Querying for the Admin`);
    query = {
    TableName: process.env.LABELS_TABLE,
    IndexName: 'priority-index', // ← You need a GSI with priority as partition key
    KeyConditionExpression: 'priority = :priority',
    ExpressionAttributeValues: {
      ':priority': priority,
      },
    };
  } else {
    console.log(`I am going to try Querying`);
    query = { // Remove 'const', just assign to existing variable
      TableName: process.env.LABELS_TABLE,
      IndexName: 'priority-label_count-index',
      KeyConditionExpression: 'priority = :priority AND label_count < :target',
      FilterExpression: 
        '(attribute_not_exists(reserved_until) OR reserved_until < :now) AND ' +
        'NOT contains(blacklisted_users, :user)',
      ExpressionAttributeValues: {
        ':priority': priority,
        ':target': TARGET_LABELS,
        ':now': Date.now(),
        ':user': userEmail
      },
      //Limit: limit,
      ScanIndexForward: false // Get highest label_count first (2/3 labels)
    };
  }

  try {
  const result = await docClient.send(new QueryCommand(query));
  return result.Items || [];
  } catch (error) {
    console.error(`Error querying ${priority} audios:`, error);
    return [];
  }
}

async function reserveAudioForUser(audioId, userEmail) {
  try {
    const result = await docClient.send(new UpdateCommand({
      TableName: process.env.LABELS_TABLE,
      Key: { id: audioId },
      UpdateExpression: `
        SET reserved_by = :user,
            reserved_until = :until,
            cleanup_status = :status
      `,
      ConditionExpression: `
        (attribute_not_exists(reserved_until) OR reserved_until < :now) AND
        label_count < :target AND
        (attribute_not_exists(blacklisted_users) OR NOT contains(blacklisted_users, :user))
      `,
      ExpressionAttributeValues: {
        ':user': userEmail,
        ':until': Date.now() + RESERVATION_TIMEOUT,
        ':status': 'reserved',
        ':now': Date.now(),
        ':target': TARGET_LABELS
        // REMOVED: empty_list and user_list
      },
      ReturnValues: 'ALL_NEW'
  }));

    
    console.log(`✅ Reserved audio ${audioId} for ${userEmail}`);
    return result.Attributes;
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException') {
      console.log(`❌ Audio ${audioId} already taken or user blacklisted`);
    } else {
      console.error(`Error reserving audio ${audioId}:`, error);
    }
    return null;
  }
}

router.get('/label-items', async (req, res) => {
  const userEmail = req.headers['user-email'];
  
  if (!userEmail) {
    return res.status(400).json({ error: 'User email required' });
  }
  
  console.log(`🎯 User ${userEmail} requesting next audio`);

  // Update active users tracking
  await updateUserActivity(userEmail);
  const activeUserCount = getActiveUserCount();
  const dynamicLimit = calculateDynamicLimit(activeUserCount);

 
  console.log('🔍 [A] Before calling updateUserRequestCount');
  const userCounts = await updateUserRequestCount(userEmail);
  console.log('🔍 [B] After calling - userCounts:', userCounts, 'type:', typeof userCounts);
  console.log('🔍 [C] userCounts JSON:', JSON.stringify(userCounts));
  console.log(`🎯 The user ${userEmail} count is ${userCounts}`);
  
  if (userEmail != process.env.ADMIN_EMAIL && userCounts == 20) {

    const params = {
      TableName: process.env.LABELS_TABLE,
      FilterExpression: 'priority = :priority', 
      ExpressionAttributeValues: {
        ':priority': 'standard'
      },
      ProjectionExpression: 'id, s3_key, original_name, priority, label_count' 
    };

    const result = await docClient.send(new ScanCommand(params)); 
    const items = result.Items;

    if (items.length > 0) {
      // Step 1: Pick a random audio
      const randomIndex = Math.floor(Math.random() * items.length);
      const randomAudio = items[randomIndex]; // ✅ full object, not just ID

      console.log('🎲 Randomly selected audio:', randomAudio.id);

      // Step 2: Generate presigned URL
      const audioUrl = await getPresignedUrl(randomAudio.s3_key);

      // Step 3: Prepare response
      const responseAudio = {
        id: randomAudio.id,
        original_name: randomAudio.original_name,
        audio_url: audioUrl,
        priority: randomAudio.priority,
        label_count: randomAudio.label_count || 0,
        target_labels: "no limit",
        filename: randomAudio.s3_key.split('/').pop() || 'audio',
        s3_key: randomAudio.s3_key,
        reservation_id: `res_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      };

      console.log(`🎉 Assigned random audio to ${userEmail}`);
      console.log(`   Audio: ${randomAudio.id}, Labels: ${randomAudio.label_count || 0}`);
      console.log(`   Original name: ${randomAudio.original_name}`);

      return res.json({ audio: responseAudio });


    }} else {
      try {
        // Step 1: Find candidates by priority (high → medium → low)
        const candidateResult = await findCandidatesByPriority(userEmail, dynamicLimit);
        
        if (!candidateResult) {
          console.log(`📭 No audios available for ${userEmail}`);
          return res.json({ 
            audio: null, 
            message: 'No audios available for labeling at this time' 
          });
        }
        
        const { priority, candidates } = candidateResult;
        
        // Step 2: Try to reserve each candidate until success
        let assignedAudio = null;
        
        for (const audio of candidates) {
          console.log(`🔄 Attempting to reserve ${audio.id}...`);
          const reservedAudio = await reserveAudioForUser(audio.id, userEmail);
          
          if (reservedAudio) {
            assignedAudio = reservedAudio;
            break;
          }
        }
        
        if (!assignedAudio) {
          console.log(`😞 All candidates taken for ${userEmail}`);
          return res.json({ 
            audio: null, 
            message: 'All selected audios were taken, please try again' 
          });
        }
        
        // Step 3: Generate presigned URL
        const audioUrl = await getPresignedUrl(assignedAudio.s3_key);
        
        // Step 4: Prepare response
        const responseAudio = {
          id: assignedAudio.id,
          original_name: assignedAudio.original_name,
          audio_url: audioUrl,
          priority: assignedAudio.priority,
          label_count: assignedAudio.label_count || 0,
          target_labels: TARGET_LABELS,
          filename: assignedAudio.s3_key.split('/').pop() || 'audio',
          s3_key:assignedAudio.s3_key,
          reservation_id: `res_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        };
        
        console.log(`🎉 Assigned ${assignedAudio.priority} priority audio to ${userEmail}`);
        console.log(`   Audio: ${assignedAudio.id}, Labels: ${assignedAudio.label_count || 0}/3`);
        console.log(`   Audio: ${assignedAudio.original_name}`);
        console.log(`   Audio: ${assignedAudio.s3_key}`);


        return res.json({ audio: responseAudio });
        
      } catch (error) {
        console.error('🚨 Error in /next-audio:', error);
        return res.status(500).json({ 
          audio: null, 
          error: 'Internal server error' 
        });
      }
    }
 
}); // ✅ properly closed router.get




router.post('/labeled-items', async (req, res) => {
  const { audioId, type, severity,age,sex, reservation_id, priority, s3_key, original_name, start_time } = req.body;
  const userEmail = req.headers['user-email'];

  console.log('🔔 Label submission received:', {
    audioId, type, severity, reservation_id, priority, s3_key, original_name, start_time, userEmail
  });

  const startTime = start_time || Date.now();
  const end_time = Date.now();
  const time_taken = (end_time - startTime) / 1000;
  const TARGET_LABELS = 3;

  const finalLabel = type && severity && age && sex ? `${type}_${severity}_${age}_${sex}` : 'unknown';

  const labelingRecord = {
    userEmail,
    finalLabel,
    time_taken,
    timestamp: end_time
  };

  console.log(`📝 Processing label: ${finalLabel} for audio ${audioId} by ${userEmail}`);
  console.log(`📝 Priority for the received audio is: ${priority}`);

  try {
    let updatedAudio;
    let newLabelCount;

    if (priority == "standard") {
      if (userEmail == process.env.ADMIN_EMAIL) {
        // ADMIN: Get from LABELS_TABLE and create/update in STANDARD_TABLE
        const audioData = await docClient.send(new GetCommand({
          TableName: process.env.LABELS_TABLE,
          Key: { id: audioId }
        }));

        if (!audioData.Item) {
          return res.status(404).json({ error: `Audio ${audioId} not found in source table` });
        }

        // Create or update in STANDARD_TABLE
        await docClient.send(new PutCommand({
          TableName: process.env.STANDARD_TABLE,
          Item: {
            ...audioData.Item,
            labeling_history: [...(audioData.Item.labeling_history || []), labelingRecord],
            updated_at: Date.now()
          }
        }));

        newLabelCount = (audioData.Item.label_count || 0) + 1;
        console.log(`✅ Label submitted for ${audioId} by ${userEmail} (ADMIN)`);
        console.log(`   Updated Table: ${process.env.STANDARD_TABLE}`);

      } else {
        // NON-ADMIN: Try to update existing item in STANDARD_TABLE
        try {
          const result = await docClient.send(new UpdateCommand({
            TableName: process.env.STANDARD_TABLE,
            Key: { id: audioId },
            UpdateExpression: `
              SET labeling_history = list_append(if_not_exists(labeling_history, :emptyHistory), :newRecord)
            `,
            ExpressionAttributeValues: {
              ':emptyHistory': [],
              ':newRecord': [labelingRecord]
            },
            ReturnValues: 'ALL_NEW'
          }));
          updatedAudio = result.Attributes;
          newLabelCount = updatedAudio.label_count || 1;
          console.log(`✅ Label submitted for ${audioId} by ${userEmail}`);
          console.log(`the updated table by the user ${userEmail} is ${process.env.STANDARD_TABLE}`);

        } catch (error) {
          if (error.name === 'ResourceNotFoundException' || error.name === 'ConditionalCheckFailedException') {
            console.log(`⚠️ Audio ${audioId} not found in STANDARD_TABLE, creating new entry...`);
            
            // Get audio data from source table and create in STANDARD_TABLE
            const audioData = await docClient.send(new GetCommand({
              TableName: process.env.LABELS_TABLE,
              Key: { id: audioId }
            }));

            if (audioData.Item) {
              await docClient.send(new PutCommand({
                TableName: process.env.STANDARD_TABLE,
                Item: {
                  ...audioData.Item,
                  labeling_history: [...(audioData.Item.labeling_history || []), labelingRecord],
                  updated_at: Date.now()
                }
              }));
              newLabelCount = (audioData.Item.label_count || 0) + 1;
              console.log(`✅ Created ${audioId} in STANDARD_TABLE and added label`);
            } else {
              return res.status(404).json({ error: `Audio ${audioId} not found in any table` });
            }
          } else {
            throw error;
          }
        }
      }

    // For standard priority, return success response
    return res.json({
      success: true,
      new_label_count: newLabelCount,
      labels_remaining: TARGET_LABELS - newLabelCount,
      is_completed: newLabelCount >= TARGET_LABELS,
    });

    } else {
      // NON-STANDARD priority: Update in LABELS_TABLE
      const result = await docClient.send(new UpdateCommand({
        TableName: process.env.LABELS_TABLE,
        Key: { id: audioId },
        UpdateExpression: `
          REMOVE reserved_by, reserved_until, reserved_at, reservation_id, cleanup_status
          SET 
            label_map = list_append(if_not_exists(label_map, :emptyList), :newLabel),
            labeling_history = list_append(if_not_exists(labeling_history, :emptyHistory), :newRecord),
            label_count = if_not_exists(label_count, :zero) + :one,
            last_labeled_at = :now
          ADD blacklisted_users :userSet
        `,
        ConditionExpression: 'reserved_by = :user AND reserved_until > :now',
        ExpressionAttributeValues: {
          ':newLabel': [finalLabel],
          ':newRecord': [labelingRecord],
          ':emptyList': [],
          ':emptyHistory': [],
          ':one': 1,
          ':zero': 0,
          ':now': end_time,
          ':user': userEmail,
          ':userSet': new Set([userEmail])
        },
        ReturnValues: 'ALL_NEW'
      }));

      updatedAudio = result.Attributes;
      newLabelCount = updatedAudio.label_count || 1;

      console.log(`✅ Label submitted for ${audioId} by ${userEmail}`);
      console.log(`   New label count: ${updatedAudio.label_count}/3`);

      // Calculate and update label confidence and average time
      await updateAudioMetrics(audioId, newLabelCount);

      // Check if audio reached 3 labels and copy to labeled_items
      if (newLabelCount >= TARGET_LABELS) {
        await copyToLabeledItems(updatedAudio, process.env.LABELED_ITEMS_TABLE);
      }

      return res.json({
        success: true,
        new_label_count: updatedAudio.label_count,
        labels_remaining: TARGET_LABELS - newLabelCount,
        is_completed: newLabelCount >= TARGET_LABELS,
      });
    }

  } catch (error) {
    console.error('Error submitting label:', error);

    if (error.name === 'ConditionalCheckFailedException') {
      return res.status(409).json({
        error: 'Reservation expired or invalid'
      });
    } else if (error.name === 'ResourceNotFoundException') {
      return res.status(404).json({
        error: 'Audio not found'
      });
    } else {
      return res.status(500).json({ 
        error: 'Failed to submit label',
        details: error.message 
      });
    }
  }});

// Export both router and initialize function
module.exports = router;