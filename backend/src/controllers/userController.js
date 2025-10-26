// Add this to your backend (userController.js or similar)
const activeLabelers = new Map(); // In-memory store for active users

// Track user login/activity
const trackUserLogin = async (userEmail) => {
  try {
    const userActivity = {
      userEmail,
      lastActive: Date.now(),
      isActive: true,
      loginTime: Date.now(),
      currentAudio: null,
      labelsSubmitted: 0
    };

    activeLabelers.set(userEmail, userActivity);
    
    console.log(`👤 (${userEmail}) logged in - Active users: ${activeLabelers.size}`);
    
    return userActivity;
  } catch (error) {
    console.error('Error tracking user login:', error);
  }
};

// Track user activity (called periodically from frontend)
const updateUserActivity = async (userEmail, currentAudioId = null) => {
  try {
    if (activeLabelers.has(userEmail)) {
      const user = activeLabelers.get(userEmail);
      user.lastActive = Date.now();
      user.isActive = true;
      console.log(`👤 (${userEmail}) is still active`)
      
      if (currentAudioId) {
        user.currentAudio = currentAudioId;
      }
      
      activeLabelers.set(userEmail, user);
    }
  } catch (error) {
    console.error('Error updating user activity:', error);
  }
};

// Track label submission
const trackLabelSubmission = async (userEmail) => {
  try {
    if (activeLabelers.has(userEmail)) {
      const user = activeLabelers.get(userEmail);
      user.labelsSubmitted += 1;
      user.lastActive = Date.now();
      user.currentAudio = null; // Clear current audio after submission
      activeLabelers.set(userEmail, user);
      
      console.log(`📝 User ${user.userEmail} submitted label #${user.labelsSubmitted}`);
    }
  } catch (error) {
    console.error('Error tracking label submission:', error);
  }
};

// Update trackUserLogout to release reserved audio
const trackUserLogout = async (userEmail) => {
  try {
    if (activeLabelers.has(userEmail)) {
      const user = activeLabelers.get(userEmail);
      const sessionDuration = Date.now() - user.loginTime;
      
      console.log(`👋 User ${userEmail} logged out - Session: ${Math.round(sessionDuration/1000)}s, Labels: ${user.labelsSubmitted}`);
      
      // Release any reserved audio when user logs out
      if (user.currentAudio) {
        console.log(`🔓 Releasing audio ${user.currentAudio} from logging out user ${userEmail}`);
        try {
          await docClient.send(new UpdateCommand({
            TableName: process.env.LABELS_TABLE,
            Key: { id: user.currentAudio },
            UpdateExpression: "REMOVE reserved_by, reserved_at, reservation_id",
            ConditionExpression: "reserved_by = :userEmail",
            ExpressionAttributeValues: {
              ":userEmail": userEmail
            }
          }));
        } catch (error) {
          console.log(`Could not release audio ${user.currentAudio}:`, error.message);
        }
      }
      
      activeLabelers.delete(userEmail);
    }
  } catch (error) {
    console.error('Error tracking user logout:', error);
  }
};

// Update the cleanupInactiveUsers function to also clean reserved audio
const cleanupInactiveUsers = async () => {
  const INACTIVITY_THRESHOLD = 2 * 60 * 1000; // 5 minutes
  
  try {
    const now = Date.now();
    let cleanedCount = 0;
    
    for (const [userEmail, user] of activeLabelers.entries()) {
      if (now - user.lastActive > INACTIVITY_THRESHOLD) {
        console.log(`🧹 Removing inactive user: ${userEmail} (last active: ${Math.round((now - user.lastActive)/1000)}s ago)`);
        
        // If user had a current audio reserved, release it
        if (user.currentAudio) {
          console.log(`🔓 Releasing audio ${user.currentAudio} from inactive user ${userEmail}`);
          try {
            await docClient.send(new UpdateCommand({
              TableName: process.env.LABELS_TABLE,
              Key: { id: user.currentAudio },
              UpdateExpression: "REMOVE reserved_by, reserved_at, reservation_id",
              ConditionExpression: "reserved_by = :userEmail",
              ExpressionAttributeValues: {
                ":userEmail": userEmail
              }
            }));
          } catch (error) {
            console.log(`Could not release audio ${user.currentAudio}:`, error.message);
          }
        }
        
        activeLabelers.delete(userEmail);
        cleanedCount++;
      }
    }
    
    // Also clean up any other reserved audio that might be orphaned
    await cleanupReservedAudio();
    
    if (cleanedCount > 0) {
      console.log(`🧹 Cleaned ${cleanedCount} inactive users. Active users: ${activeLabelers.size}`);
    }
  } catch (error) {
    console.error('Error cleaning inactive users:', error);
  }
};

// Add this function to clean up reserved audio for inactive users
const cleanupReservedAudio = async () => {
  const INACTIVITY_THRESHOLD = 5 * 60 * 1000; // 5 minutes
  
  try {
    const now = Date.now();
    let cleanedCount = 0;
    
    // Get all reserved audio items
    const reservedItems = await docClient.send(new ScanCommand({
      TableName: process.env.LABELS_TABLE,
      FilterExpression: "attribute_exists(reserved_by) AND attribute_exists(reserved_at)",
    }));

    const items = reservedItems.Items || [];
    
    for (const item of items) {
      // Check if reservation is older than threshold
      if (now - item.reserved_at > INACTIVITY_THRESHOLD) {
        console.log(`🧹 Releasing reserved audio ${item.id} from inactive user ${item.reserved_by}`);
        
        // Release the reservation
        await docClient.send(new UpdateCommand({
          TableName: process.env.LABELS_TABLE,
          Key: { id: item.id },
          UpdateExpression: "REMOVE reserved_by, reserved_at, reservation_id",
          ConditionExpression: "reserved_by = :reservedBy AND reserved_at = :reservedAt",
          ExpressionAttributeValues: {
            ":reservedBy": item.reserved_by,
            ":reservedAt": item.reserved_at
          }
        }));
        
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      console.log(`🧹 Released ${cleanedCount} reserved audio files from inactive users`);
    }
  } catch (error) {
    console.error('Error cleaning reserved audio:', error);
  }
};

const getActiveUsers = async () => {
  try {
    const now = Date.now();
    const INACTIVITY_THRESHOLD = 2 * 60 * 1000; // 2 minutes
    
    // Filter out users who are technically in the map but inactive
    const trulyActiveUsers = Array.from(activeLabelers.entries())
      .filter(([userEmail, user]) => now - user.lastActive <= INACTIVITY_THRESHOLD)
      .map(([userEmail, user]) => ({
        userEmail: user.userEmail,
        lastActive: user.lastActive,
        labelsSubmitted: user.labelsSubmitted,
        loginTime: user.loginTime,
        currentAudio: user.currentAudio,
        isActive: true,
        sessionDuration: Math.round((now - user.loginTime) / 1000)
      }));
    
    console.log(`📊 Active users report: ${trulyActiveUsers.length} users`);
    
    return trulyActiveUsers;
  } catch (error) {
    console.error('Error getting active users:', error);
    return [];
  }
};



module.exports = {
  activeLabelers,
  trackUserLogin,
  updateUserActivity,
  trackLabelSubmission,
  trackUserLogout,
  cleanupInactiveUsers,
  getActiveUsers,
  cleanupReservedAudio
};