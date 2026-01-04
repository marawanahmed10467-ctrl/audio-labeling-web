import React, { useState } from 'react';
import api from '../api/axios';
import './AdminPage.css';
import LabelingPanel from './LabelingPage';

const AdminPanel = ({ user, onLogout }) => {
  const [activeTab, setActiveTab] = useState('management');

  return (
    <div className="admin-panel">
      <header className="admin-header">
        <div className="header-content">
          <h1>Admin Dashboard</h1>
          <div className="user-info">
            <span>Welcome, {user.name} ({user.role})</span>
            <button onClick={onLogout} className="logout-btn">
              Logout
            </button>
          </div>
        </div>

        <nav className="admin-nav">
          <button
            className={`nav-btn ${activeTab === 'management' ? 'active' : ''}`}
            onClick={() => setActiveTab('management')}
          >
            🛠️ User & Audio Management
          </button>

          <button
            className={`nav-btn ${activeTab === 'labelCount' ? 'active' : ''}`}
            onClick={() => setActiveTab('labelCount')}
          >
            ➕ Set target labels
          </button>

          <button
            className={`nav-btn ${activeTab === 'labeling' ? 'active' : ''}`}
            onClick={() => setActiveTab('labeling')}
          >
            🎧 Labeling Panel
          </button>
        </nav>
      </header>

      <main className="admin-content">
        {activeTab === 'management' && <ManagementTab />}
        {activeTab === 'labelCount' && <LabelCountIncrementTab />}
        {activeTab === 'labeling' && <LabelingPanel user={user} />}
      </main>
    </div>
  );
};

// --------------------
// Management Tab
// --------------------
const ManagementTab = () => {
  const [createUserForm, setCreateUserForm] = useState({
    name: '',
    email: '',
    password: ''
  });
  const [deleteUserEmail, setDeleteUserEmail] = useState('');
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [message, setMessage] = useState('');

  const savedCount = parseInt(localStorage.getItem('AvailableAudiosCount'));
  const zeroCount = parseInt(localStorage.getItem('ZeroLabelCount')) || 0;

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const token = localStorage.getItem('token');
      const response = await api.post('/audio/create-labeler', createUserForm, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.data.success) {
        setMessage('Labeler created successfully!');
        setCreateUserForm({ name: '', email: '', password: '' });
      }
    } catch (error) {
      setMessage(error.response?.data?.message || 'Error creating labeler');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteUser = async (e) => {
    e.preventDefault();
    if (!deleteUserEmail) {
      setMessage('Please enter an email address');
      return;
    }

    if (!window.confirm(
      `Are you sure you want to delete user ${deleteUserEmail}? This will remove all their labeling data permanently!`
    )) {
      return;
    }

    setDeleteLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await api.delete('/audio/delete-user', {
        headers: { Authorization: `Bearer ${token}` },
        data: { email: deleteUserEmail }
      });

      if (response.data.success) {
        setMessage(`User ${deleteUserEmail} deleted successfully!`);
        setDeleteUserEmail('');
        if (response.data.details) console.log('Deletion details:', response.data.details);
      }
    } catch (error) {
      setMessage(error.response?.data?.message || 'Error deleting user');
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleUploadAudio = async (e) => {
    e.preventDefault();
    if (files.length === 0) {
      setMessage('Please select audio files to upload');
      return;
    }

    setLoading(true);

    try {
      const formData = new FormData();
      files.forEach(file => formData.append('audio', file));

      const token = localStorage.getItem('token');
      const response = await api.post('/audio/upload-audio', formData, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'multipart/form-data'
        }
      });

      if (response.data.success) {
        setMessage(`Successfully uploaded ${response.data.files.length} audio file(s)`);
        setFiles([]);
      }
    } catch (error) {
      setMessage(error.response?.data?.message || 'Error uploading audio files');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="management-tab">
      <div className="audio-count-info">
        <span className="count-text">
          {savedCount} Audios are left for labeling and {zeroCount} Audios with no Labeling at all
        </span>
      </div>

      <div className="management-grid">
        <div className="management-card">
          <h2>Create New Labeler</h2>
          <form onSubmit={handleCreateUser} className="management-form">
            <div className="form-group">
              <label>Full Name:</label>
              <input
                type="text"
                value={createUserForm.name}
                onChange={(e) => setCreateUserForm({ ...createUserForm, name: e.target.value })}
                required
                placeholder="Enter labeler's full name"
              />
            </div>

            <div className="form-group">
              <label>Email:</label>
              <input
                type="email"
                value={createUserForm.email}
                onChange={(e) => setCreateUserForm({ ...createUserForm, email: e.target.value })}
                required
                placeholder="Enter labeler's email"
              />
            </div>

            <div className="form-group">
              <label>Password:</label>
              <input
                type="password"
                value={createUserForm.password}
                onChange={(e) => setCreateUserForm({ ...createUserForm, password: e.target.value })}
                required
                placeholder="Set temporary password"
                minLength="6"
              />
            </div>

            <button type="submit" disabled={loading} className="submit-btn">
              {loading ? 'Creating...' : 'Create Labeler'}
            </button>
          </form>
        </div>

        <div className="management-card">
          <h2>Delete User</h2>
          <form onSubmit={handleDeleteUser} className="management-form">
            <div className="form-group">
              <label>User Email to Delete:</label>
              <input
                type="email"
                value={deleteUserEmail}
                onChange={(e) => setDeleteUserEmail(e.target.value)}
                required
                placeholder="Enter user's email to delete"
              />
            </div>

            <div className="warning-message">
              <strong>⚠️ Warning:</strong> This action will permanently:
              <ul>
                <li>Remove user from Users Table</li>
                <li>Reduce global label count by 1</li>
                <li>Remove user's labeling history from all audio files</li>
                <li>Remove user's label_map entries from all audio files</li>
              </ul>
              <p><strong>This action cannot be undone!</strong></p>
            </div>

            <button
              type="submit"
              disabled={deleteLoading || !deleteUserEmail}
              className="submit-btn delete-btn"
            >
              {deleteLoading ? 'Deleting...' : 'Delete User'}
            </button>
          </form>
        </div>

        <div className="management-card">
          <h2>Upload Audio Files</h2>
          <form onSubmit={handleUploadAudio} className="management-form">
            <div className="form-group">
              <label>Select Audio Files:</label>
              <input
                type="file"
                multiple
                accept="audio/*"
                onChange={(e) => setFiles(Array.from(e.target.files))}
                disabled={loading}
              />
              <small>Select multiple audio files (MP3, WAV, etc.)</small>
            </div>

            {files.length > 0 && (
              <div className="file-list">
                <h4>Selected Files ({files.length}):</h4>
                <ul>
                  {files.map((file, index) => (
                    <li key={index}>
                      {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || files.length === 0}
              className="submit-btn"
            >
              {loading ? 'Uploading...' : `Upload ${files.length} File(s)`}
            </button>
          </form>
        </div>
      </div>

      {message && (
        <div className={`message ${message.toLowerCase().includes('success') ? 'success' : ''}`}>
          {message}
        </div>
      )}
    </div>
  );
};

// --------------------
// Label Count Increment Tab 
// --------------------
const LabelCountIncrementTab = () => {
  const [selectedMode, setSelectedMode] = useState('label_map'); // label_map | blacklisted_users | priority | original_names
  const [setTo, setIncrementBy] = useState(1);

  // label_map mode for backend
  const [labelMapMode, setLabelMapMode] = useState('type'); // type|severity|age|gender|whole_label

  // blacklisted user
  const [userEmail, setUserEmail] = useState('');

  // priority
  const [priority, setPriority] = useState('');

  // original names
  const [audioNames, setAudioNames] = useState('');
  const [audioNamesList, setAudioNamesList] = useState([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [stats, setStats] = useState(null);

  const handleAudioNamesChange = (e) => {
    const value = e.target.value;
    setAudioNames(value);

    const names = value
      .split(/[\n,]/)
      .map(name => name.trim())
      .filter(name => name.length > 0);

    setAudioNamesList(names);
  };

  const validate = () => {
    const inc = Number(setTo);
    if (!Number.isFinite(inc) || inc <= 0) {
      return 'incrementBy must be a positive number';
    }

    if (selectedMode === 'blacklisted_users' && !userEmail.trim()) {
      return 'Please enter the user email';
    }

    if (selectedMode === 'priority' && !priority) {
      return 'Please select a priority';
    }

    if (selectedMode === 'original_names' && audioNamesList.length === 0) {
      return 'Please enter at least one original name';
    }

    return '';
  };

  const handleIncrement = async () => {
    setError('');
    setMessage('');
    setStats(null);

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    const inc = Number(setTo);
    const token = localStorage.getItem('token');

    const ok = window.confirm(
      `This will increment label_count by ${inc} for "${selectedMode}". Proceed?`
    );
    if (!ok) return;

    setLoading(true);

    try {
      let endpoint = '';
      let payload = {};

   
      if (selectedMode === 'label_map') {
        endpoint = '/labelCount/label-count/increment';
        payload = { mode: labelMapMode, setTo: inc };
      } else if (selectedMode === 'blacklisted_users') {
        endpoint = '/labelCount/blacklisted-users/increment-label-count';
        payload = { email: userEmail.trim(), setTo: inc };
      } else if (selectedMode === 'priority') {
        endpoint = '/labelCount/priority/increment-label-count';
        payload = { priority, setTo: inc };
      } else if (selectedMode === 'original_names') {
        endpoint = '/labelCount/original-names/increment-label-count';
        payload = { names: audioNamesList, setTo: inc };
      }

      const response = await api.post(endpoint, payload, {
        headers: { Authorization: `Bearer ${token}` }
      });

      setMessage(response.data?.message || 'Setting completed');
      setStats(response.data || null);
    } catch (err) {
      setError(err.response?.data?.error || err.response?.data?.message || 'Setting failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="advanced-filter-tab">
      <h2>Set target labels</h2>

      <div className="filter-container">
        <h3 className="filter-title">Choose Increment Type</h3>

        <div className="filter-selection">
          <label className="section-label">Set the target labels based on</label>
          <div className="filter-type-grid">
            <button
              onClick={() => setSelectedMode('label_map')}
              className={`filter-type-btn ${selectedMode === 'label_map' ? 'active' : ''}`}
            >
              Label Map (distinct)
            </button>

            <button
              onClick={() => setSelectedMode('blacklisted_users')}
              className={`filter-type-btn ${selectedMode === 'blacklisted_users' ? 'active' : ''}`}
            >
              Blacklisted User Email
            </button>

            <button
              onClick={() => setSelectedMode('priority')}
              className={`filter-type-btn ${selectedMode === 'priority' ? 'active' : ''}`}
            >
              Priority
            </button>

            <button
              onClick={() => setSelectedMode('original_names')}
              className={`filter-type-btn ${selectedMode === 'original_names' ? 'active' : ''}`}
            >
              Original Names
            </button>
          </div>
        </div>

        <div className="filter-grid">
          <div className="filter-group">
            <label className="filter-label">Set target labels to </label>
            <input
              type="number"
              min="1"
              value={setTo}
              onChange={(e) => setIncrementBy(e.target.value)}
              className="filter-input"
            />
          </div>

          {selectedMode === 'label_map' && (
            <div className="filter-group">
              <label className="filter-label">Label Map mode </label>
              <select
                value={labelMapMode}
                onChange={(e) => setLabelMapMode(e.target.value)}
                className="filter-select"
              >
                <option value="type">Different type</option>
                <option value="severity">Different severity</option>
                <option value="age">Different age</option>
                <option value="gender">Different gender</option>
                <option value="whole_label">Different whole label</option>
              </select>
              <p className="filter-hint">
                Backend increments only rows where distinct values for this mode are &gt; 1 (and label_confidence &lt; 1)
              </p>
            </div>
          )}

          {selectedMode === 'blacklisted_users' && (
            <div className="filter-group">
              <label className="filter-label">User Email</label>
              <input
                type="email"
                value={userEmail}
                onChange={(e) => setUserEmail(e.target.value)}
                placeholder="e.g. user@example.com"
                className="filter-input"
              />
              <p className="filter-hint">Matches rows where contains(blacklisted_users, email)</p>
            </div>
          )}

          {selectedMode === 'priority' && (
            <div className="filter-group">
              <label className="filter-label">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="filter-select"
              >
                <option value="">Select Priority</option>
                <option value="high">high</option>
                <option value="medium">medium</option>
                <option value="low">low</option>
                <option value="standard">standard</option>
              </select>
              <p className="filter-hint">Matches rows where priority == selected priority</p>
            </div>
          )}

          {selectedMode === 'original_names' && (
            <div className="filter-group">
              <label className="filter-label">Original Names (comma or newline separated)</label>
              <textarea
                value={audioNames}
                onChange={handleAudioNamesChange}
                placeholder="audio1.wav, audio2.wav"
                rows={4}
                className="filter-textarea"
              />
              <p className="filter-hint">
                {audioNamesList.length > 0
                  ? `Parsed ${audioNamesList.length} name(s)`
                  : 'Enter at least one name'}
              </p>
            </div>
          )}
        </div>

        <button
          onClick={handleIncrement}
          disabled={loading}
          className="filter-btn"
        >
          {loading ? 'Setting...' : 'Set target labels'}
        </button>

      
      </div>

      {error && <div className="message error">{error}</div>}
      {message && <div className="message success">{message}</div>}

      {stats && (
        <div className="filter-container">
          <h3 className="filter-title">Run Summary</h3>
          <div className="increment-summary">
            <div><b>updatedRows:</b> {stats.updatedRows ?? 'N/A'}</div>
            <div><b>matchedRows:</b> {stats.matchedRows ?? 'N/A'}</div>
            <div><b>scannedItems:</b> {stats.scannedItems ?? stats.scanned ?? 'N/A'}</div>
            {stats.mode && <div><b>mode:</b> {stats.mode}</div>}
            {stats.email && <div><b>email:</b> {stats.email}</div>}
            {stats.priority && <div><b>priority:</b> {stats.priority}</div>}
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminPanel;
