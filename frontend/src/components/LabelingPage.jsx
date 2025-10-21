import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../api/axios';
import './LabelingPage.css';

const LabelingPanel = ({ user, onLogout }) => {
  const [currentAudio, setCurrentAudio] = useState(null);
  const [loading, setLoading] = useState(false);
  const [labelCount, setLabelCount] = useState(0);
  const [audioError, setAudioError] = useState(null);
  const [currentStep, setCurrentStep] = useState('type'); // type → severity → confirm
  const [selectedType, setSelectedType] = useState(null);
  const [selectedSeverity, setSelectedSeverity] = useState(null);
  const audioRef = useRef(null);

  // Simplified maps with only lowercase keys
  const typeMap = {
    "w": "wet",
    "d": "dry", 
    "r": "regular",
    "u": "unknown",
    "f": "false positive"
  };

  const severityMap = {
    "s": "severe",
    "h": "healthy", 
    "u": "unknown"
  };

  const fetchNextAudio = useCallback(async () => {
    try {
      setLoading(true);
      setAudioError(null);
      setCurrentStep('type');
      setSelectedType(null);
      setSelectedSeverity(null);
      
      const token = localStorage.getItem('token');
      const response = await api.get('/audio/label-items', {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (response.data.items.length > 0) {
        const audioData = response.data.items[0];
        setCurrentAudio(audioData);
      } else {
        setCurrentAudio(null);
      }
    } catch (error) {
      console.error('Error fetching audio:', error);
      setAudioError('Failed to fetch audio: ' + error.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (currentAudio && currentAudio.audio_url && audioRef.current) {
      audioRef.current.src = currentAudio.audio_url;
      audioRef.current.load();
    }
  }, [currentAudio]);

  useEffect(() => {
    fetchNextAudio();
  }, [fetchNextAudio]);

  const submitLabels = async () => {
    if (!currentAudio || !selectedType || !selectedSeverity) return;

    try {
      const token = localStorage.getItem('token');
      // Combine both labels into one submission
      const combinedLabel = `${selectedType}_${selectedSeverity}`;
      
      await api.post('/audio/labeled-items', 
        { 
          id: currentAudio.id, 
          label: combinedLabel,
          type: selectedType,
          severity: selectedSeverity
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      setLabelCount(prev => prev + 1);
      fetchNextAudio();
    } catch (error) {
      console.error('Error submitting label:', error);
      alert('Error submitting label. Please try again.');
    }
  };

  const handleTypeSelect = (typeKey) => {
    // Convert to lowercase to handle both cases
    const normalizedKey = typeKey.toLowerCase();
    setSelectedType(typeMap[normalizedKey]);
    setCurrentStep('severity');
  };

  const handleSeveritySelect = (severityKey) => {
    // Convert to lowercase to handle both cases
    const normalizedKey = severityKey.toLowerCase();
    setSelectedSeverity(severityMap[normalizedKey]);
    setCurrentStep('confirm');
  };

  const handleRestart = () => {
    setSelectedType(null);
    setSelectedSeverity(null);
    setCurrentStep('type');
  };

  const handleConfirm = () => {
    submitLabels();
  };

  // Keyboard handler for all steps
  useEffect(() => {
    const handleKeyPress = (e) => {
      if (['AUDIO', 'BUTTON', 'INPUT', 'TEXTAREA'].includes(e.target.tagName)) {
        return;
      }

      if (!currentAudio) return;

      const key = e.key.toLowerCase();

      // Spacebar for play/pause (works in all steps)
      if (key === ' ') {
        e.preventDefault();
        if (audioRef.current && audioRef.current.src) {
          if (audioRef.current.paused) {
            audioRef.current.play().catch(error => {
              console.error('Play failed:', error);
              setAudioError('Play failed: ' + error.message);
            });
          } else {
            audioRef.current.pause();
          }
        }
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
  }, [currentAudio, currentStep, selectedType, selectedSeverity]);

  if (loading) return <div className="loading">Loading audio...</div>;
  
  if (!currentAudio) return (
    <div className="no-audio">
      <h3>No audio files available for labeling</h3>
      <p>All audio files have been labeled at least 3 times.</p>
      <button onClick={fetchNextAudio} className="retry-btn">
        Check for New Audio
      </button>
    </div>
  );

  return (
    <div className="labeling-panel" tabIndex="0">
      <div className="labeling-header">
        <div>
          <h2>Audio Labeling Panel</h2>
          <p>Welcome, {user.name}</p>
        </div>
        <div className="labeling-stats">
          <span>Labeled today: {labelCount}</span>
        </div>
      </div>

      <div className="audio-player">
        <h3>Current Audio</h3>
        
        {audioError && (
          <div className="audio-error">
            <strong>Audio Error:</strong> {audioError}
          </div>
        )}
        
        {/* Restricted audio player without download or speed controls */}
        <audio 
          ref={audioRef}
          controls
          controlsList="nodownload noplaybackrate" 
          className="audio-element"
          preload="auto"
        >
          Your browser does not support the audio element.
        </audio>
      </div>

      <button onClick={onLogout} className="logout-btn">
        Logout
      </button>

      {/* Progress Indicator */}
      <div className="labeling-progress">
        <div className={`progress-step ${currentStep === 'type' ? 'active' : ''} ${selectedType ? 'completed' : ''}`}>
          <span>1</span>
          <p>Cough Type</p>
        </div>
        <div className={`progress-step ${currentStep === 'severity' ? 'active' : ''} ${selectedSeverity ? 'completed' : ''}`}>
          <span>2</span>
          <p>Severity</p>
        </div>
        <div className={`progress-step ${currentStep === 'confirm' ? 'active' : ''}`}>
          <span>3</span>
          <p>Confirm</p>
        </div>
      </div>

      {/* Step 1: Cough Type Selection */}
      {currentStep === 'type' && (
        <div className="labeling-step">
          <h3>What type of cough is it?</h3>
          <div className="shortcut-grid">
            {Object.entries(typeMap).map(([key, label]) => (
              <div key={key} className="shortcut-item">
                <kbd>{key.toUpperCase()}</kbd>
                <span>{label.charAt(0).toUpperCase() + label.slice(1)}</span>
              </div>
            ))}
          </div>
          <div className="step-instructions">
            <p>Press the corresponding key to select cough type</p>
          </div>
        </div>
      )}

      {/* Step 2: Severity Selection */}
      {currentStep === 'severity' && (
        <div className="labeling-step">
          <h3>How severe is the cough?</h3>
          <div className="selected-type">
            Currently selected: <strong>{selectedType}</strong> cough
          </div>
          <div className="shortcut-grid">
            {Object.entries(severityMap).map(([key, label]) => (
              <div key={key} className="shortcut-item">
                <kbd>{key.toUpperCase()}</kbd>
                <span>{label.charAt(0).toUpperCase() + label.slice(1)}</span>
              </div>
            ))}
          </div>
          <div className="step-instructions">
            <p>Press the corresponding key to select severity</p>
          </div>
        </div>
      )}

      {/* Step 3: Confirmation */}
      {currentStep === 'confirm' && (
        <div className="labeling-step confirm-step">
          <h3>Confirm Your Labels</h3>
          <div className="confirmation-details">
            <div className="label-summary">
              <div className="label-item">
                {selectedType} {selectedSeverity}
              </div>
            </div>
          </div>
          <div className="confirmation-actions">
            <div className="shortcut-grid">
              <div className="shortcut-item confirm">
                <kbd>ENTER</kbd>
                <span>Confirm & Submit</span>
              </div>
              <div className="shortcut-item restart">
                <kbd>R</kbd>
                <span>Restart Labeling</span>
              </div>
            </div>
          </div>
          <div className="step-instructions">
            <p>Press ENTER to submit or R to restart</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default LabelingPanel;