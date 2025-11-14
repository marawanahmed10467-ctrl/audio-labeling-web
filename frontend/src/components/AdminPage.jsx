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
            className={`nav-btn ${activeTab === 'labeling' ? 'active' : ''}`}
            onClick={() => setActiveTab('labeling')}
          >
            🎧 Labeling Panel
          </button>
        </nav>
      </header>

      <main className="admin-content">
        {activeTab === 'management' && <ManagementTab />}
        {activeTab === 'labeling' && <LabelingPanel user={user} />}
      </main>
    </div>
  );
};

// Management Tab - Create User & Upload Audio
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

  // Get the saved count from localStorage
  const savedCount = parseInt(localStorage.getItem('AvailableAudiosCount')) || 0;

  // Create Labeler
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

  // Delete User - DynamoDB version
  const handleDeleteUser = async (e) => {
    e.preventDefault();
    if (!deleteUserEmail) {
      setMessage('Please enter an email address');
      return;
    }

    // Confirm deletion
    if (!window.confirm(`Are you sure you want to delete user ${deleteUserEmail}? This will remove all their labeling data permanently!`)) {
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
        
        // Log the details of what was removed
        if (response.data.details) {
          console.log('Deletion details:', response.data.details);
        }
      }
    } catch (error) {
      setMessage(error.response?.data?.message || 'Error deleting user');
    } finally {
      setDeleteLoading(false);
    }
  };

  // Upload Audio
  const handleUploadAudio = async (e) => {
    e.preventDefault();
    if (files.length === 0) {
      setMessage('Please select audio files to upload');
      return;
    }

    setLoading(true);
    
    try {
      const formData = new FormData();
      files.forEach(file => {
        formData.append('audio', file);
      });

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
      {/* Added audio count display */}
      <div className="audio-count-info">
        <span className="count-text">{savedCount} Audios are left for labeling</span>
      </div>
      
      <div className="management-grid">
        {/* Create User Section */}
        <div className="management-card">
          <h2>Create New Labeler</h2>
          <form onSubmit={handleCreateUser} className="management-form">
            <div className="form-group">
              <label>Full Name:</label>
              <input
                type="text"
                value={createUserForm.name}
                onChange={(e) => setCreateUserForm({...createUserForm, name: e.target.value})}
                required
                placeholder="Enter labeler's full name"
              />
            </div>

            <div className="form-group">
              <label>Email:</label>
              <input
                type="email"
                value={createUserForm.email}
                onChange={(e) => setCreateUserForm({...createUserForm, email: e.target.value})}
                required
                placeholder="Enter labeler's email"
              />
            </div>

            <div className="form-group">
              <label>Password:</label>
              <input
                type="password"
                value={createUserForm.password}
                onChange={(e) => setCreateUserForm({...createUserForm, password: e.target.value})}
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

        {/* Delete User Section - DynamoDB */}
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

        {/* Upload Audio Section */}
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
                    <li key={index}>{file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)</li>
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
        <div className={`message ${message.includes('success') ? 'success' : 'error'}`}>
          {message}
        </div>
      )}
    </div>
  );
};

export default AdminPanel;