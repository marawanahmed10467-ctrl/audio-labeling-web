const express = require('express');
const multer = require('multer');
const { PutCommand, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../utils/dynamodb');
const { getPresignedUrl } = require('../utils/s3');
const { uploadFile } = require('../utils/s3'); 
const { createLabeler, getLabelers } = require('../controllers/adminController');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed'), false);
    }
  }
});

// Labeler Management Routes
router.post('/create-labeler', createLabeler);
router.get('/labelers', getLabelers);

// Enhanced audio upload with priority system
router.post('/upload-audio', upload.array('audio', 10000), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ 
        success: false,
        message: "No audio files uploaded" 
      });
    }

    const { priority = 'medium' } = req.body; // 'high', 'medium', 'low'
    const uploaded = [];

    for (const file of req.files) {
      if (!file.mimetype.startsWith('audio/')) {
        continue;
      }

      // Upload to S3 with priority folder
      const folder = `audio/${priority}`;
      const key = `${folder}/${Date.now()}-${file.originalname}`;
      await uploadFile(file, key); // Modify your uploadFile to accept custom key

      // Register in DynamoDB with priority
      const audioItem = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        s3_key: key,
        original_name: file.originalname,
        file_size: file.size,
        mime_type: file.mimetype,
        status: "unlabeled",
        label_count: 0,
        label_map: [],
        priority: priority, // 🆕 Add priority
        last_labeled_at: null, // 🆕 Track when it was last labeled
        created_at: Date.now(),
      };

      await docClient.send(new PutCommand({
        TableName: process.env.LABELS_TABLE,
        Item: audioItem
      }));

      uploaded.push({
        id: audioItem.id,
        original_name: file.originalname,
        key: key,
        status: "unlabeled",
        priority: priority
      });
    }

    res.json({
      success: true,
      message: `${uploaded.length} audio file(s) uploaded to ${priority} priority`,
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

// Get audio items for labeling with priority and distribution
router.get('/label-items', async (req, res) => {
  try {
    const threshold = 3;
    const cooldownPeriod = 10 * 60 * 1000; // 10 minutes cooldown
    const minGapBetweenSameAudio = 10; // Show same audio after 10 other labels
    
    const params = {
      TableName: process.env.LABELS_TABLE,
      FilterExpression: "attribute_not_exists(label_count) OR label_count < :t",
      ExpressionAttributeValues: {
        ":t": threshold,
      },
    };

    const result = await docClient.send(new ScanCommand(params));
    let items = result.Items || [];

    console.log(`📊 Found ${items.length} items needing labeling`);

    if (items.length === 0) {
      return res.json({ items: [] });
    }

    // 🆕 1. PRIORITY-BASED SORTING: high → medium → low
    const priorityOrder = { 'high': 1, 'medium': 2, 'low': 3 };
    
    items.sort((a, b) => {
      const priorityA = priorityOrder[a.priority || 'medium'] || 2;
      const priorityB = priorityOrder[b.priority || 'medium'] || 2;
      
      // First sort by priority (high first)
      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }
      
      // Then by label count (less labeled first)
      const countA = a.label_count || 0;
      const countB = b.label_count || 0;
      if (countA !== countB) {
        return countA - countB;
      }
      
      // Finally random shuffle for same priority & count
      return Math.random() - 0.5;
    });

    // 🆕 2. BETTER DISTRIBUTION: Avoid showing same audio repeatedly
    // Group by priority and apply distribution logic
    const priorityGroups = {
      high: items.filter(item => (item.priority || 'medium') === 'high'),
      medium: items.filter(item => (item.priority || 'medium') === 'medium'), 
      low: items.filter(item => (item.priority || 'medium') === 'low')
    };

    console.log(`🎯 Priority distribution - High: ${priorityGroups.high.length}, Medium: ${priorityGroups.medium.length}, Low: ${priorityGroups.low.length}`);

    // Select the best candidate based on priority and distribution
    let selectedItem = null;

    // Strategy: Always try to select from highest available priority
    if (priorityGroups.high.length > 0) {
      selectedItem = selectBestCandidate(priorityGroups.high, minGapBetweenSameAudio);
    } else if (priorityGroups.medium.length > 0) {
      selectedItem = selectBestCandidate(priorityGroups.medium, minGapBetweenSameAudio);
    } else if (priorityGroups.low.length > 0) {
      selectedItem = selectBestCandidate(priorityGroups.low, minGapBetweenSameAudio);
    }

    if (!selectedItem) {
      console.log('❌ No suitable audio found after distribution logic');
      return res.json({ items: [] });
    }

    // Generate presigned URL for the selected item
    const audio_url = await getPresignedUrl(selectedItem.s3_key);

    const withUrls = [{
      id: selectedItem.id,
      audio_url: audio_url,
      label_count: selectedItem.label_count || 0,
      status: selectedItem.status || 'unlabeled',
      priority: selectedItem.priority || 'medium',
      filename: selectedItem.s3_key?.split('/').pop() || 'audio'
    }];

    console.log(`✅ SELECTED: ${selectedItem.id}, Priority: ${selectedItem.priority}, Labels: ${selectedItem.label_count || 0}, File: ${selectedItem.s3_key?.split('/').pop()}`);

    res.json({ items: withUrls });

  } catch (err) {
    console.error("Error fetching items:", err);
    res.status(500).json({ error: err.message });
  }
});

// 🆕 Helper function for better audio distribution
function selectBestCandidate(items, minGap) {
  if (items.length === 0) return null;
  
  // Sort by label count (prefer less labeled)
  items.sort((a, b) => (a.label_count || 0) - (b.label_count || 0));
  
  // Group by similar label counts
  const groups = {};
  items.forEach(item => {
    const count = item.label_count || 0;
    if (!groups[count]) groups[count] = [];
    groups[count].push(item);
  });
  
  // Select from the group with lowest label count
  const lowestCount = Math.min(...Object.keys(groups).map(Number));
  const candidateGroup = groups[lowestCount];
  
  // Randomly select from the candidate group to avoid patterns
  const randomIndex = Math.floor(Math.random() * candidateGroup.length);
  return candidateGroup[randomIndex];
}

// 🆕 Enhanced label submission with cooldown tracking
router.post('/labeled-items', async (req, res) => {
  const { id, label, type, severity } = req.body;

  try {
    // Combine type and severity if provided
    const finalLabel = type && severity ? `${type}_${severity}` : label;

    await docClient.send(new UpdateCommand({
      TableName: process.env.LABELS_TABLE,
      Key: { id },
      UpdateExpression: `
        SET label_map = list_append(if_not_exists(label_map, :emptyList), :newLabel),
            label_count = if_not_exists(label_count, :zero) + :one,
            last_labeled_at = :now,
            updated_at = :now
      `,
      ExpressionAttributeValues: {
        ":newLabel": [finalLabel],
        ":emptyList": [],
        ":one": 1,
        ":zero": 0,
        ":now": Date.now(),
      },
      ReturnValues: "UPDATED_NEW",
    }));

    console.log(`✅ Label submitted for ${id}: ${finalLabel}`);
    res.json({ message: "Label submitted successfully" });
  } catch (err) {
    console.error("Error updating label:", err);
    res.status(500).json({ error: err.message });
  }
});



module.exports = router;