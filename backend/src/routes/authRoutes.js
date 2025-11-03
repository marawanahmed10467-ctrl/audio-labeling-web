const express = require('express');
const { login, register, getMe } = require('../controllers/authController');
const { PutCommand, ScanCommand, UpdateCommand, QueryCommand,GetCommand} = require('@aws-sdk/lib-dynamodb');
const {trackUserLogin,updateUserActivity,trackUserLogout,getActiveUsers} = require('../controllers/userController');
const { docClient } = require('../utils/dynamodb');
const router = express.Router();

// Backend: Store the users temporarily
let usersPendingLogout = new Set();

async function cleanupExpiredReservations() {
  try {
    const now = Date.now();
    
    const query = {
      TableName: process.env.LABELS_TABLE,
      IndexName: 'cleanup_status-reserved_until-index',
      KeyConditionExpression: 'cleanup_status = :status AND reserved_until < :now',
      ExpressionAttributeValues: {
        ':status': 'reserved',
        ':now': now
      }
    };
    
    const result = await docClient.send(new QueryCommand(query));
    const expiredItems = result.Items || [];
    
    console.log(`🧹 Cleaning up ${expiredItems.length} expired reservations`);
    
    let cleanedCount = 0;
    const currentBatchLogout = new Set();
    
    for (const item of expiredItems) {
      try {
        console.log(`🔄 Attempting to clean audio ${item.id} (user: ${item.reserved_by})`);
        
        // MOVE THE UPDATE TO HAPPEN FIRST
        await docClient.send(new UpdateCommand({
          TableName: process.env.LABELS_TABLE,
          Key: { id: item.id },
          UpdateExpression: 'REMOVE reserved_by, reserved_until, cleanup_status',
          ConditionExpression: 'reserved_until < :now',
          ExpressionAttributeValues: { 
            ':now': now,
          }
        }));
        
        // ONLY AFTER SUCCESSFUL UPDATE:
        cleanedCount++;
        
        if (item.reserved_by) {
          currentBatchLogout.add(item.reserved_by);
          usersPendingLogout.add(item.reserved_by);
        }
        
        console.log(`✅ Successfully cleaned audio ${item.id} (user: ${item.reserved_by})`);
        
      } catch (error) {
        if (error.name === 'ConditionalCheckFailedException') {
          console.log(`❌ Failed to clean ${item.id} - condition check failed (already updated?)`);
        } else {
          console.error(`❌ Failed to clean audio ${item.id}:`, error.message);
        }
      }
    }
    
    console.log(`✅ Cleanup completed: ${cleanedCount} reservations cleaned`);
    console.log(`🚫 Users to logout: ${Array.from(currentBatchLogout).join(', ')}`);
    console.log(` Users pending log out are: ${Array.from(usersPendingLogout).join(', ')}`);


    
    // Clear old logout requests after 1 minute
    setTimeout(() => {
      currentBatchLogout.forEach(user => usersPendingLogout.delete(user));
    }, 60000);
    
  } catch (error) {
    console.error('Error cleaning expired reservations:', error);
  }
}

// Start the cleanup job
function initializeCleanup() {
  // Run immediately
  cleanupExpiredReservations();
  
  // Then every 5 minutes
  setInterval(cleanupExpiredReservations, 5 * 60 * 1000);
  
  console.log('🧹 Reservation cleanup job started');
}

// Public routes
router.post('/login', login);
router.post('/register', register); // Optional


// Track user login
router.post('/user/login', async (req, res) => {
  try {
    const {userEmail} = req.body;
    const userActivity = await trackUserLogin(userEmail);
    
    res.json({
      success: true,
      message: 'User activity tracked',
      user: userActivity
    });
  } catch (error) {
    console.error('Error in user login:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Track user activity (called periodically from frontend)
router.post('/user/activity', async (req, res) => {
  try {
    const { userEmail, currentAudioId } = req.body;
    await updateUserActivity(userEmail, currentAudioId);
    
    res.json({ success: true, message: 'Activity updated' });
  } catch (error) {
    console.error('Error updating user activity:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Backend - use consistent naming
router.get('/user/should-logout', (req, res) => {  // ✅ Consistent
  const { userEmail } = req.query;
  const shouldLogout = usersPendingLogout.has(userEmail);

  console.log("the user email to logout was sent to the frontend")
  
  if (shouldLogout) {
    usersPendingLogout.delete(userEmail);
  }
  
  res.json({ shouldLogout });
});

// Get active users list (for monitoring)
router.get('/user/active-users', async (req, res) => {
  try {
    const activeUsers = await getActiveUsers();
    
    res.json({
      success: true,
      activeUsers: activeUsers,
      totalActive: activeUsers.length,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error getting active users:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});


// Add this route to your userRoutes.js
router.post('/user/release-audio', async (req, res) => {
  try {
    const { userEmail, audioId } = req.body;
    
    // Release the audio reservation
    await docClient.send(new UpdateCommand({
      TableName: process.env.LABELS_TABLE,
      Key: { id: audioId },
      UpdateExpression: "REMOVE reserved_by, reserved_at, reservation_id",
      ConditionExpression: "reserved_by = :userEmail",
      ExpressionAttributeValues: {
        ":userEmail": userEmail
      }
    }));
    
    console.log(`🔓 Audio ${userEmail} released by user ${userEmail}`);
    res.json({ success: true, message: 'Audio released' });
  } catch (error) {
    console.error('Audio release error:', error);
    res.status(500).json({ success: false, message: 'Audio release failed' });
  }
});

exports.router = router;
exports.initializeCleanup = initializeCleanup;
