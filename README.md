# Audio Labeling Tool

## Overview

A fast, web-based labeling tool for short audio clips (e.g., coughs), designed to generate high-quality labels for training machine learning models that classify cough type and severity.

The tool streamlines the annotation workflow so that labelers can efficiently listen and tag audios using either mouse or keyboard shortcuts. It is intended for clinical or research settings where large amounts of audio data must be labeled consistently.

---

## Features

### A. Admin Panel

#### 1. User & Audio Management
- Create accounts for new labelers.
- Delete users (automatically removes all their labels).
- Upload audio files for labeling (preferably only when the audios are high priority, otherwise upload them to AWS S3 in the corresponding priority folder).

#### 2. Labeling Panel (Admin)
- Admins can label only standard audio clips.


---

### B. Labeler Panel
- Automatic audio assignment based on backend priority logic.
- Fast labeling using mouse clicks or keyboard shortcuts.
- Continuous workflow: next audio loads immediately after submission.
- Automatic session timeout: labelers are logged out after 5 minutes of inactivity.
---

## Demo / Screenshots
find Screenshots folder in the repo

---

## Tech Stack
- **Frontend:** React (JSX / JavaScript)
- **Backend:** Node.js (Express)
- **Database:** DynamoDB
- **Storage:** AWS S3 + optional local storage
- **Hosting:** AWS EC2

---

## Architecture (High-Level)

1. Admin uploads audio files to AWS S3, which triggers a Lambda function, or uploads high-priority audio files directly through the Admin Panel (stored locally).
2. Metadata for each uploaded audio file is written to the DynamoDB Audio Table.
3. When a labeler logs in, the backend selects the next audio clip based on:
-the priority defined in the Audio Table
-whether the audio has been labeled fewer times than target_label (a configurable value).
-whether the audio was labeled by this person before
-whether the audio is reserved for someone else at the moment(to avoid collision)
4. Labeler listens and submits label.
5. Label saved in DynamoDB;if Audio has been labeled target_label times, data copied to Labeled_Audios Table. backend loads next audio.

---

## Setup & Installation

### 1. Prerequisites
-Docker 
-Docker Compose
-AWS account + DynamoDB + S3 and Lambda function (optional)

### 2. Environment Variables
```
# Server Configuration
PORT=5000
NODE_ENV=development

# AWS Configuration
AWS_REGION=your-aws-region
AWS_ACCESS_KEY_ID=your-aws-access-key-id
AWS_SECRET_ACCESS_KEY=your-aws-secret-access-key
S3_BUCKET_NAME=your-s3-bucket-name
S3_REGION=your-s3-region

# Database Tables
USERS_TABLE=your-users-table-name 
LABELS_TABLE=your-labels-table-name
LABELED_ITEMS_TABLE=your-copied labels-table-name
STANDARD_TABLE=standard audios-table-name

# Admin Credentials
ADMIN_EMAIL=your-admin-email@example.com
ADMIN_PASSWORD=your-secure-admin-password

# JWT Secret
JWT_SECRET=your-super-secure-jwt-secret-key-here

# Frontend API URL
REACT_APP_API_URL=http://your-server-ip:5000/api
```

### 3. Run with Docker
```
docker-compose up --build
```

### 4. Run Manually

#### Backend
```
cd backend
npm install
npm start
```

#### Frontend
```
cd frontend
npm install
npm start
```

---

## Data Model (Conceptual)

### Users Table
email (String)
	
createdAt
	
isActive
	
lastRequest
	
name
	
password 
	
requestCount
	
role

### Audio Table / Testing_Table Table (in case of testing functionality)
id (String)
	
average_labeling_time
	
blacklisted_users
	
completed_at
	
created_at
	
file_size
	
label_confidence
	
label_count
	
label_map
	
labeling_history
	
last_labeled_at
	
mime_type
	
original_name
	
priority
	
s3_bucket
	
s3_key
	
status
	
target_labels
	
updated_at

### Labeled_Audios Table
same as Audio table
### Standard_Audios Table
same as Audio table
---

## Roadmap

