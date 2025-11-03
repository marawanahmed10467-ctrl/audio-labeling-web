const { docClient } = require('./dynamodb');
const { PutCommand, ScanCommand, UpdateCommand, QueryCommand,GetCommand} = require('@aws-sdk/lib-dynamodb');



// Helper function to calculate label confidence (exactly as in your schema)
function calculateLabelConfidence(labelMap) {
  if (!labelMap || labelMap.length === 0) return 0;
  
  const labelCounts = {};
  labelMap.forEach(label => {
    labelCounts[label] = (labelCounts[label] || 0) + 1;
  });
  
  const maxCount = Math.max(...Object.values(labelCounts));
  const confidence = maxCount / labelMap.length;
  
  // Return with 2 decimal places as in your example (0.67)
  return Math.round(confidence * 100) / 100;
}

// Helper function to calculate consensus label
function calculateConsensusLabel(labelMap) {
  if (!labelMap || labelMap.length === 0) return 'unknown';
  
  const labelCounts = {};
  labelMap.forEach(label => {
    labelCounts[label] = (labelCounts[label] || 0) + 1;
  });
  
  // Find the maximum count
  const maxCount = Math.max(...Object.values(labelCounts));
  
  // Get all labels that have the maximum count (handles ties)
  const topLabels = Object.keys(labelCounts).filter(label => 
    labelCounts[label] === maxCount
  );
  
  // If there's a tie (multiple labels with same max count), return 'no_consensus'
  if (topLabels.length > 1) {
    return 'no_consensus';
  }
  
  // Return the single most common label
  return topLabels[0];
}


// Function to update label confidence and average time
async function updateAudioMetrics(audioId, labelCount) {
  try {
    // Get the current audio to calculate metrics
    const audioResult = await docClient.send(new GetCommand({
      TableName: process.env.LABELS_TABLE,
      Key: { id: audioId }
    }));

    const audio = audioResult.Item;
    if (!audio) return;

    const labelMap = audio.label_map || [];
    const labelingHistory = audio.labeling_history || [];
    
    // Calculate label confidence
    const labelConfidence = calculateLabelConfidence(labelMap);
    
    // Calculate average labeling time (sum of all time_taken / label_count)
    const totalTime = labelingHistory.reduce((sum, record) => sum + (record.time_taken || 0), 0);
    const averageTime = labelCount > 0 ? Math.round(totalTime / labelCount) : 0;

    // Update the audio with calculated metrics
    await docClient.send(new UpdateCommand({
      TableName: process.env.LABELS_TABLE,
      Key: { id: audioId },
      UpdateExpression: `
        SET label_confidence = :confidence,
            average_labeling_time = :avgTime,
            updated_at = :now
      `,
      ExpressionAttributeValues: {
        ":confidence": labelConfidence,
        ":avgTime": averageTime,
        ":now": Date.now()
      }
    }));

    console.log(`📊 Updated metrics for ${audioId}: confidence=${labelConfidence}, avg_time=${averageTime}ms`);

  } catch (error) {
    console.error("Error updating audio metrics:", error);
  }
}

// Function to copy completed audio to labeled_items table
async function copyToLabeledItems(audioItem,table_name) {
  try {
    const labelMap = audioItem.label_map || [];
    const labelingHistory = audioItem.labeling_history || [];
    const labelCount = audioItem.label_count || 0;
    
    // Calculate final metrics
    const labelConfidence = calculateLabelConfidence(labelMap);
    const totalTime = labelingHistory.reduce((sum, record) => sum + (record.time_taken || 0), 0);
    const averageTime = labelCount > 0 ? Math.round(totalTime / labelCount) : 0;
    
    // Calculate consensus label
    const consensusLabel = calculateConsensusLabel(labelMap);

    console.log(`calculated consensusLabel is :${consensusLabel}`)

    // Create labeled item with EXACT SAME SCHEMA as LABELS_TABLE
    const labeledItem = {
      // Core audio data - same schema
      id: audioItem.id,
      created_at: audioItem.created_at,
      s3_key: audioItem.s3_key,
      original_name: audioItem.original_name,
      file_size: audioItem.file_size,
      mime_type: audioItem.mime_type,
      
      // Labeling data - same schema
      status: "completed",
      priority: audioItem.priority,
      label_count: audioItem.label_count,
      target_labels: 3,
      label_map: audioItem.label_map || [],
      label_confidence: labelConfidence,
      labeling_history: audioItem.labeling_history || [],
      average_labeling_time: averageTime,
      last_labeled_at: audioItem.last_labeled_at,
      completed_at: Date.now(),
    };

    // Save to labeled_items table
    await docClient.send(new PutCommand({
      TableName: table_name,
      Item: labeledItem
    }));

    console.log(`📦 Copied completed audio ${audioItem.id} to labeled_items table - Consensus: ${consensusLabel}`);

    // Update status in main table to completed
    await docClient.send(new UpdateCommand({
      TableName: process.env.LABELS_TABLE,
      Key: { id: audioItem.id },
      UpdateExpression: `
        SET #status = :completed, 
            completed_at = :now,
            label_confidence = :confidence,
            average_labeling_time = :avgTime
      `,
      ExpressionAttributeNames: {
        "#status": "status"
      },
      ExpressionAttributeValues: {
        ":completed": "completed",
        ":now": Date.now(),
        ":confidence": labelConfidence,
        ":avgTime": averageTime
      }
    }));

  } catch (error) {
    console.error("Error copying to labeled_items:", error);
  }
}


// Helper function to calculate consensus label
function calculateConsensusLabel(labelMap) {
  if (!labelMap || labelMap.length === 0) return 'unknown';
  
  const labelCounts = {};
  labelMap.forEach(label => {
    labelCounts[label] = (labelCounts[label] || 0) + 1;
  });
  
  // Find the maximum count
  const maxCount = Math.max(...Object.values(labelCounts));
  
  // Get all labels that have the maximum count (handles ties)
  const topLabels = Object.keys(labelCounts).filter(label => 
    labelCounts[label] === maxCount
  );
  
  // If there's a tie (multiple labels with same max count), return 'no_consensus'
  if (topLabels.length > 1) {
    return 'no_consensus';
  }
  
  // Return the single most common label
  return topLabels[0];
}




// async function cleanupExpiredReservations() {
//   try {
//     console.log('🧹 Cleaning expired reservations - USING SCAN ONLY');
    
//     const scanParams = {
//       TableName: process.env.LABELS_TABLE,
//       FilterExpression: 'reserved_until < :now',
//       ExpressionAttributeValues: {
//         ':now': Date.now()
//       }
//     };
    
//     const result = await docClient.send(new ScanCommand(scanParams));
//     const expiredItems = result.Items || [];
    
//     console.log(`🧹 Found ${expiredItems.length} expired reservations to clean`);
    
//     for (const item of expiredItems) {
//       try {
//         await docClient.send(new UpdateCommand({
//           TableName: process.env.LABELS_TABLE,
//           Key: { id: item.id },
//           UpdateExpression: 'REMOVE reserved_by, reserved_until',
//           ConditionExpression: 'attribute_exists(id)'
//         }));
//         console.log(`✅ Cleaned reservation for audio ${item.id}`);
//       } catch (updateError) {
//         console.error(`❌ Failed to clean audio ${item.id}:`, updateError.message);
//       }
//     }
    
//     console.log(`✅ Cleanup completed: ${expiredItems.length} reservations`);
//   } catch (error) {
//     console.error('Error in cleanup:', error);
//   }
// }



module.exports = {
  calculateLabelConfidence,
  calculateConsensusLabel,
  updateAudioMetrics,
  copyToLabeledItems,
};