import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../api/axios';
import './LabelingPage.css';

// Forced Logout Checker Component
function ForcedLogoutChecker({ userEmail, onForcedLogout }) {
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  useEffect(() => {
    if (!userEmail) {
      console.log('❌ No userEmail provided to ForcedLogoutChecker');
      return;
    }

    console.log('🔍 ForcedLogoutChecker started for:', userEmail);

    const checkLogout = async () => {
      try {
        console.log("⏳ Checking logout status for:", userEmail);

        const response = await api.get(`/auth/user/should-logout`, {
          params: { userEmail }
        });
        const data = response.data;

        //const url = `/api/auth/user/should-logout?userEmail=${encodeURIComponent(userEmail)}`;
        //console.log("📡 Making request to:", url);
        
        //const response = await fetch(url);
        console.log("📨 Response status:", response.status);
        
        //const data = await response.json();
        console.log("📊 Logout check response:", data);
        
        if (data.shouldLogout) {
          console.log('🚫 Received logout command from server - shouldLogout:', data.shouldLogout);
          if (!showLogoutModal) {
            console.log('🎯 Showing logout modal');
            setShowLogoutModal(true);
          }
        } else {
          console.log('✅ No logout required - shouldLogout:', data.shouldLogout);
        }
      } catch (error) {
        console.error('❌ Error checking logout:', error);
        console.error('Error details:', error.message);
      }
    };

    // Check immediately and then every 10 seconds
    checkLogout();
    const interval = setInterval(checkLogout, 10000);
    
    return () => {
      console.log('🧹 Cleaning up ForcedLogoutChecker');
      clearInterval(interval);
    };
  }, [userEmail, showLogoutModal]);

  const handleLogoutClick = () => {
    console.log('👆 Logout button clicked in modal');
    setShowLogoutModal(false);
    onForcedLogout();
  };

  console.log('🎭 ForcedLogoutChecker render - showLogoutModal:', showLogoutModal);

  return (
    <>
      {showLogoutModal && (
        <div className="logout-modal-overlay">
          <div className="logout-modal">
            <div className="logout-modal-header">
              <h3>Session Expired</h3>
            </div>
            <div className="logout-modal-body">
              <p>Your session has expired due to inactivity.</p>
              <p>Please log in again to continue labeling.</p>
            </div>
            <div className="logout-modal-actions">
              <button 
                onClick={handleLogoutClick}
                className="logout-btn"
              >
                Log Out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const LabelingPanel = ({ user, onLogout }) => {
  const [currentAudio, setCurrentAudio] = useState(null);
  const [audioID, setaudioID] = useState(null);
  const [audioPriority, setaudioPriority] = useState(null);
  const [audioKey, setaudioKey] = useState(null);
  const [loading, setLoading] = useState(false);
  const [labelCount, setLabelCount] = useState(0);
  const [audioError, setAudioError] = useState(null);
  const [submissionError, setSubmissionError] = useState(null);
  const [currentStep, setCurrentStep] = useState('type'); 
  const [selectedType, setSelectedType] = useState(null);
  const [selectedSeverity, setSelectedSeverity] = useState(null);
  const [selectedAge, setSelectedAge] = useState(null);
  const [selectedSex, setSelectedSex] = useState(null);
  const [activeUsers, setActiveUsers] = useState(0);
  const [debugInfo, setDebugInfo] = useState({});
  const audioRef = useRef(null);
  const startTimeRef = useRef(null);

  const typeMap = {
    "w": "wet",
    "d": "dry", 
    "r": "regular",
    "u": "unknown",
    "f": "false positive",
    "z": "wheezing" // ADDED: Wheezing option
  };

  const severityMap = {
    "1": "mild", // CHANGED: 1 for Mild
    "3": "mild-to-medium", // CHANGED: 3 for Mild-to-medium
    "4": "medium", // CHANGED: 5 for Medium
    "7": "medium-to-severe", // CHANGED: 7 for Medium-to-severe
    "9": "severe", // CHANGED: 9 for Severe
    "u": "unknown" // KEPT: Unknown option
  };

  // NEW: Age options mapping
  const ageMap = {
    "i": "infant", // Infant (0 - 2 years)
    "y": "young-child", // Young Child (3 to 6 years)
    "c": "child", // Child (7 to 12 years)
    "d": "adolescent", // Adolescent (13 to 17 years)
    "a": "adult", // Adults (18 to 70 years)
    "s": "senior", // Senior (70+ years)
    "u": "unknown" // Unknown
  };

  // NEW: Sex options mapping
  const sexMap = {
    "m": "male", // Male
    "f": "female", // Female
    "u": "unknown" // Unknown
  };

  // Helper function to safely get user name from different user structures
  const getUserName = (user) => {
    if (!user) return 'User';
    
    // Handle regular user structure
    if (user.name) return user.name;
    
    // Handle admin user structure  
    if (user.userEmail) return user.userEmail.split('@')[0]; // Use email username
    
    // Fallback
    return 'User';
  };

  // Enhanced handleLogout with forced logout support
  const handleForcedLogout = () => {
    alert('You have been automatically logged out due to 5+ minutes of inactivity.');
    handleLogout();
  };

  const handleLogout = async () => {
    console.log('🔄 Starting logout process...');
    
    // Call original logout function
    if (onLogout && typeof onLogout === 'function') {
      onLogout();
    } else {
      // Fallback logout behavior
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
  };

  // FIXED: Proper fetchNextAudio function
  const fetchNextAudio = useCallback(async () => {
    try {
      console.log('🎵 Starting to fetch next audio...');
      setLoading(true);
      setAudioError(null);
      setSubmissionError(null);
      setCurrentStep('type');
      setSelectedType(null);
      setSelectedSeverity(null);
      setSelectedAge(null);
      setSelectedSex(null);
      startTimeRef.current = Date.now();
      
      const token = localStorage.getItem('token');
      const userData = JSON.parse(localStorage.getItem("user"));

      if (!userData || !userData.email) {
        throw new Error('No user data available');
      }

      console.log("🎵 Fetching audio for user:", userData.email);

      const response = await api.get('/audio/label-items', {
        headers: { 
          Authorization: `Bearer ${token}`, 
          'user-email': userData.email
        }
      });
      
      //console.log("📦 Audio API response:", response.data);
      
      // Match backend response structure
      if (response.data.audio) {
        const audioData = response.data.audio;
        console.log("✅ Received audio data:", {
          id: audioData.id,
          reservation_id: audioData.reservation_id,
          label_count: audioData.label_count,
          priority: audioData.priority,
          filename: audioData.filename,
          s3_key:audioData.s3_key
        });
        setCurrentAudio(audioData);
        setaudioID(audioData.original_name);




        
        // Reset audio element
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current.currentTime = 0;
        }
        
        setDebugInfo(prev => ({
          ...prev,
          lastAudioFetch: new Date().toISOString(),
          currentAudioId: audioData.id,
          audioStatus: 'loaded'
        }));
      } else {
        console.log("❌ No audio files available");
        setCurrentAudio(null);
        setDebugInfo(prev => ({
          ...prev,
          lastAudioFetch: new Date().toISOString(),
          audioStatus: 'no_audio_available'
        }));
      }
    } catch (error) {
      console.error('❌ Error fetching audio:', error);
      const errorMsg = error.response?.data?.error || error.message;
      setAudioError('Failed to fetch audio: ' + errorMsg);
      setDebugInfo(prev => ({
        ...prev,
        lastAudioFetch: new Date().toISOString(),
        audioStatus: 'error',
        audioError: errorMsg
      }));
    } finally {
      setLoading(false);
    }
  }, []);

  // MISSING FUNCTION: testAudioPlayback
  const testAudioPlayback = () => {
    if (audioRef.current && currentAudio) {
      console.log("🔊 Testing audio playback...");
      audioRef.current.play().catch(error => {
        console.error("❌ Play failed:", error);
        setAudioError(`Play failed: ${error.message}`);
      });
    }
  };

  // Safe audio play function
  const handleAudioPlay = async () => {
    if (!audioRef.current || !audioRef.current.src) return;
    
    try {
      if (audioRef.current.paused) {
        await audioRef.current.play();
      } else {
        audioRef.current.pause();
      }
    } catch (error) {
      console.error('❌ Play failed:', error);
      setAudioError('Play failed: ' + error.message);
    }
  };

  useEffect(() => {
    if (currentAudio && currentAudio.audio_url && audioRef.current) {
      startTimeRef.current = Date.now();
      
      const audioElement = audioRef.current;
      
      const handleError = (error) => {
        console.error('❌ Audio element error:', error);
        const audioError = audioElement.error;
        setAudioError(`Audio playback error: ${audioError ? audioError.message : 'Unknown error'}`);
      };
      
      const handleLoadStart = () => {
        console.log('🔄 Audio loading started...');
        setAudioError(null);
      };
      
      const handleCanPlay = () => {
        console.log('▶️ Audio can now play');
        setAudioError(null);
      };

      // Set up event listeners
      audioElement.addEventListener('error', handleError);
      audioElement.addEventListener('loadstart', handleLoadStart);
      audioElement.addEventListener('canplay', handleCanPlay);
      
      // Set source and load
      audioElement.src = currentAudio.audio_url;
      audioElement.load();
      
      console.log('✅ Audio source set and load initiated');
      
      // Cleanup
      return () => {
        audioElement.removeEventListener('error', handleError);
        audioElement.removeEventListener('loadstart', handleLoadStart);
        audioElement.removeEventListener('canplay', handleCanPlay);
      };
    }
  }, [currentAudio]);

  useEffect(() => {
    console.log('🎯 Initial audio fetch on component mount');
    fetchNextAudio();
  }, []);

  const submitLabels = async () => {
    if (!currentAudio || !selectedType || !selectedSeverity || !selectedAge || !selectedSex) {
      console.error('❌ Missing required data for submission');
      setSubmissionError('Missing required data for submission');
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const userData = JSON.parse(localStorage.getItem("user"));
      
      if (!userData || !userData.email) {
        throw new Error('No user data available');
      }
      
      // Match backend expected payload structure - UPDATED with age and sex
      const submissionData = {
        audioId: currentAudio.id,
        type: selectedType,
        severity: selectedSeverity,
        age: selectedAge, // NEW: Added age
        sex: selectedSex, // NEW: Added sex
        reservation_id: currentAudio.reservation_id,
        priority: currentAudio.priority,
        s3_key: currentAudio.s3_key,
        original_name: currentAudio.original_name,
        start_time: startTimeRef.current
      };

      // console.log("📤 Submitting label:", submissionData);
      
      const response = await api.post('/audio/labeled-items', 
        submissionData,
        { 
          headers: { 
            Authorization: `Bearer ${token}`,
            'user-email': userData.email
          } 
        }
      );
      
      // console.log("✅ Label submission response:", response.data);
      
      if (response.data.success) {
        setLabelCount(prev => prev + 1);
        setSubmissionError(null);
        console.log("🎉 Label submitted successfully!");
        
        fetchNextAudio();
      } else {
        throw new Error(response.data.message || 'Submission failed');
      }
    } catch (error) {
      console.error('❌ Error submitting label:', error);
      const errorMessage = error.response?.data?.error || error.message;
      setSubmissionError(`Error submitting label: ${errorMessage}`);
      
      // Handle reservation expired case
      if (error.response?.status === 409) {
        console.log('🔄 Reservation expired, fetching new audio...');
        setTimeout(() => fetchNextAudio(), 1000);
      }
    }
  };

  const handleTypeSelect = (typeKey) => {
    const normalizedKey = typeKey.toLowerCase();
    const selectedTypeValue = typeMap[normalizedKey];
    console.log(`🎯 Selected cough type: ${selectedTypeValue}`);
    setSelectedType(selectedTypeValue);
    setCurrentStep('severity');
  };

  const handleSeveritySelect = (severityKey) => {
    const normalizedKey = severityKey.toLowerCase();
    const selectedSeverityValue = severityMap[normalizedKey];
    console.log(`🎯 Selected severity: ${selectedSeverityValue}`);
    setSelectedSeverity(selectedSeverityValue);
    setCurrentStep('age');
  };

  // NEW: Age selection handler
  const handleAgeSelect = (ageKey) => {
    const normalizedKey = ageKey.toLowerCase();
    const selectedAgeValue = ageMap[normalizedKey];
    console.log(`🎯 Selected age: ${selectedAgeValue}`);
    setSelectedAge(selectedAgeValue);
    setCurrentStep('sex');
  };

  // NEW: Sex selection handler
  const handleSexSelect = (sexKey) => {
    const normalizedKey = sexKey.toLowerCase();
    const selectedSexValue = sexMap[normalizedKey];
    console.log(`🎯 Selected sex: ${selectedSexValue}`);
    setSelectedSex(selectedSexValue);
    setCurrentStep('confirm');
  };

  const handleRestart = () => {
    console.log("🔄 Restarting labeling process");
    setSelectedType(null);
    setSelectedSeverity(null);
    setSelectedAge(null);
    setSelectedSex(null);
    setCurrentStep('type');
  };

  const handleConfirm = () => {
    console.log("✅ Confirming and submitting labels");
    submitLabels();
  };

  // Keyboard handler for all steps - UPDATED with new steps
  useEffect(() => {
    const handleKeyPress = (e) => {
      // Don't trigger if user is interacting with form elements
      if (['AUDIO', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) {
        return;
      }

      if (!currentAudio) return;

      const key = e.key.toLowerCase();

      // Spacebar for play/pause (works in all steps)
      if (key === ' ') {
        e.preventDefault();
        handleAudioPlay();
        return;
      }

      // Step-specific key handlers
      switch(currentStep) {
        case 'type':
          if (typeMap[key]) {
            e.preventDefault();
            handleTypeSelect(key);
          }
          break;
        
        case 'severity':
          if (severityMap[key]) {
            e.preventDefault();
            handleSeveritySelect(key);
          }
          break;
        
        // NEW: Age step
        case 'age':
          if (ageMap[key]) {
            e.preventDefault();
            handleAgeSelect(key);
          }
          break;
        
        // NEW: Sex step
        case 'sex':
          if (sexMap[key]) {
            e.preventDefault();
            handleSexSelect(key);
          }
          break;
        
        case 'confirm':
          if (key === 'enter') {
            e.preventDefault();
            handleConfirm();
          } else if (key === 'r') {
            e.preventDefault();
            handleRestart();
          }
          break;
        
        default:
          break;
      }
    };

    document.addEventListener('keydown', handleKeyPress);
    return () => document.removeEventListener('keydown', handleKeyPress);
  }, [currentAudio, currentStep, selectedType, selectedSeverity, selectedAge, selectedSex]);

  if (loading) return <div className="loading">Loading audio...</div>;

  if (!currentAudio) 
    return (
      <div className="no-audio">
        <h3>No audio files available for labeling</h3>
        <p> No audio is currently available.</p>
        <div className="activity-info">
          <p>👥 Currently active labelers: {activeUsers}</p>
          <p>📊 Your labels today: {labelCount}</p>
        </div>
        <button onClick={fetchNextAudio} className="retry-btn">
          Check for New Audio
        </button>
        <button onClick={handleLogout} className="logout-btn">
          Logout
        </button>
      </div>
    );

  return (
    <div className="labeling-panel" tabIndex="0">
      {/* Forced Logout Checker - monitors for inactivity timeouts */}
      {user && user.email && (
        <ForcedLogoutChecker 
          userEmail={user.email} 
          onForcedLogout={handleForcedLogout} 
        />
      )}

      <div className="labeling-header">
        <div className="header-info">
          <h2>Audio Labeling Panel</h2>
          <p>Welcome, {getUserName(user)}</p>
          <div className="audio-info">
            <p><strong>Your Labels Today:</strong> {labelCount}</p>
          </div>
        </div>
        <div className="labeling-stats">
          <button onClick={handleLogout} className="logout-btn">
            Logout
          </button>
        </div>
      </div>

      {submissionError && (
        <div className="submission-error">
          <strong>Submission Error:</strong> {submissionError}
          <button onClick={() => setSubmissionError(null)} className="dismiss-btn">
            Dismiss
          </button>
        </div>
      )}

      <div className="audio-player">
        <h3>Current Audio: {audioID}</h3>
        
        {audioError && (
          <div className="audio-error">
            <strong>Audio Error:</strong> {audioError}
            <button onClick={testAudioPlayback} className="test-btn">
              Test Playback
            </button>
            <button onClick={() => setAudioError(null)} className="dismiss-btn">
              Dismiss
            </button>
          </div>
        )}
        
        <div className="audio-controls">
          <audio 
            ref={audioRef}
            controls
            controlsList="nodownload noplaybackrate" 
            className="audio-element"
            preload="auto"
          >
            Your browser does not support the audio element.
          </audio>
          
          <div className="playback-hint">
            <kbd>SPACE</kbd> to play/pause
          </div>
        </div>
      </div>

      {/* Progress Indicator - UPDATED with new steps */}
      <div className="labeling-progress">
        <div className={`progress-step ${currentStep === 'type' ? 'active' : ''} ${selectedType ? 'completed' : ''}`}>
          <span>1</span>
          <p>Cough Type</p>
          {selectedType && <div className="checkmark">✓</div>}
        </div>
        <div className={`progress-step ${currentStep === 'severity' ? 'active' : ''} ${selectedSeverity ? 'completed' : ''}`}>
          <span>2</span>
          <p>Severity</p>
          {selectedSeverity && <div className="checkmark">✓</div>}
        </div>
        <div className={`progress-step ${currentStep === 'age' ? 'active' : ''} ${selectedAge ? 'completed' : ''}`}>
          <span>3</span>
          <p>Age</p>
          {selectedAge && <div className="checkmark">✓</div>}
        </div>
        <div className={`progress-step ${currentStep === 'sex' ? 'active' : ''} ${selectedSex ? 'completed' : ''}`}>
          <span>4</span>
          <p>Sex</p>
          {selectedSex && <div className="checkmark">✓</div>}
        </div>
        <div className={`progress-step ${currentStep === 'confirm' ? 'active' : ''}`}>
          <span>5</span>
          <p>Confirm</p>
        </div>
      </div>

      {/* Step 1: Cough Type Selection */}
      {currentStep === 'type' && (
        <div className="labeling-step">
          <h3>Step 1: What type of cough is it?</h3>
          <div className="shortcut-grid">
            {Object.entries(typeMap).map(([key, label]) => (
              <div 
                key={key} 
                className="shortcut-item"
                onClick={() => handleTypeSelect(key)}
              >
                <kbd>{key.toUpperCase()}</kbd>
                <span>{label.charAt(0).toUpperCase() + label.slice(1)}</span>
              </div>
            ))}
          </div>
          <div className="step-instructions">
            <p>Press the corresponding key or click to select cough type</p>
            <p>Listen to the audio carefully before selecting</p>
          </div>
        </div>
      )}

      {/* Step 2: Severity Selection */}
      {currentStep === 'severity' && (
        <div className="labeling-step">
          <h3>Step 2: How severe is the cough?</h3>
          <div className="selected-type">
            Currently selected: <strong>{selectedType}</strong> 
            <button onClick={handleRestart} className="change-type-btn">
              Change Type
            </button>
          </div>
          <div className="shortcut-grid">
            {Object.entries(severityMap).map(([key, label]) => (
              <div 
                key={key} 
                className="shortcut-item"
                onClick={() => handleSeveritySelect(key)}
              >
                <kbd>{key.toUpperCase()}</kbd>
                <span>{label.charAt(0).toUpperCase() + label.slice(1)}</span>
              </div>
            ))}
          </div>
          <div className="step-instructions">
            <p>Press the corresponding key or click to select severity</p>
          </div>
        </div>
      )}

      {/* NEW: Step 3: Age Selection */}
      {currentStep === 'age' && (
        <div className="labeling-step">
          <h3>Step 3: What is the age of the coughing person?</h3>
          <div className="selected-info">
            Currently selected: <strong>{selectedType} {selectedSeverity}</strong> 
            <button onClick={handleRestart} className="change-type-btn">
              Restart
            </button>
          </div>
          <div className="shortcut-grid">
            {Object.entries(ageMap).map(([key, label]) => (
              <div 
                key={key} 
                className="shortcut-item"
                onClick={() => handleAgeSelect(key)}
              >
                <kbd>{key.toUpperCase()}</kbd>
                <span>
                  {key === 'i' && 'Infant (0-2 years)'}
                  {key === 'y' && 'Young Child (3-6 years)'}
                  {key === 'c' && 'Child (7-12 years)'}
                  {key === 'd' && 'Adolescent (13-17 years)'}
                  {key === 'a' && 'Adult (18-70 years)'}
                  {key === 's' && 'Senior (70+ years)'}
                  {key === 'u' && 'Unknown'}
                </span>
              </div>
            ))}
          </div>
          <div className="step-instructions">
            <p>Press the corresponding key or click to select age</p>
          </div>
        </div>
      )}

      {/* NEW: Step 4: Sex Selection */}
      {currentStep === 'sex' && (
        <div className="labeling-step">
          <h3>Step 4: What is the sex of the coughing person?</h3>
          <div className="selected-info">
            Currently selected: <strong>{selectedType} {selectedSeverity}, {selectedAge}</strong> 
            <button onClick={handleRestart} className="change-type-btn">
              Restart
            </button>
          </div>
          <div className="shortcut-grid">
            {Object.entries(sexMap).map(([key, label]) => (
              <div 
                key={key} 
                className="shortcut-item"
                onClick={() => handleSexSelect(key)}
              >
                <kbd>{key.toUpperCase()}</kbd>
                <span>
                  {key === 'm' && 'Male'}
                  {key === 'f' && 'Female'}
                  {key === 'u' && 'Unknown'}
                </span>
              </div>
            ))}
          </div>
          <div className="step-instructions">
            <p>Press the corresponding key or click to select sex</p>
          </div>
        </div>
      )}

      {/* Step 5: Confirmation - UPDATED with all fields */}
      {currentStep === 'confirm' && (
        <div className="labeling-step confirm-step">
          <h3>Step 5: Confirm Your Labels</h3>
          <div className="confirmation-details">
            <div className="label-summary">
              <h4>You selected:</h4>
              <div className="label-item">
                <span className="label-type">
                  <strong>Type:</strong> {selectedType}
                </span>
              </div>
              <div className="label-item">
                <span className="label-severity">
                  <strong>Severity:</strong> {selectedSeverity}
                </span>
              </div>
              <div className="label-item">
                <span className="label-age">
                  <strong>Age:</strong> {
                    selectedAge === 'infant' ? 'Infant (0-2 years)' :
                    selectedAge === 'young-child' ? 'Young Child (3-6 years)' :
                    selectedAge === 'child' ? 'Child (7-12 years)' :
                    selectedAge === 'adolescent' ? 'Adolescent (13-17 years)' :
                    selectedAge === 'adult' ? 'Adult (18-70 years)' :
                    selectedAge === 'senior' ? 'Senior (70+ years)' :
                    'Unknown'
                  }
                </span>
              </div>
              <div className="label-item">
                <span className="label-sex">
                  <strong>Sex:</strong> {
                    selectedSex === 'male' ? 'Male' :
                    selectedSex === 'female' ? 'Female' : 'Unknown'
                  }
                </span>
              </div>
            </div>
          </div>
          <div className="confirmation-actions">
            <div className="shortcut-grid">
              <div 
                className="shortcut-item confirm"
                onClick={handleConfirm}
              >
                <kbd>ENTER</kbd>
                <span>Confirm & Submit</span>
              </div>
              <div 
                className="shortcut-item restart"
                onClick={handleRestart}
              >
                <kbd>R</kbd>
                <span>Restart Labeling</span>
              </div>
            </div>
          </div>
          <div className="step-instructions">
            <p>Press ENTER to submit or R to restart from the beginning</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default LabelingPanel;