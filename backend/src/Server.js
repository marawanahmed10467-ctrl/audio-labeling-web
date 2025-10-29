const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');


const authRoutesModule = require('./src/routes/authRoutes'); // Import module
const audioRoutes = require('./src/routes/audioRoutes');

// const {initializeCleanup } = require('./utils/labelsHandlers'); 



dotenv.config();
const app = express();

app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://16.63.31.242',  
    'https://16.63.31.242',          
    'http://16.63.31.242:80',       
    'http://16.63.31.242:3000',  
    'https://16.63.31.242:80',       
    'https://16.63.31.242:3000', 
    'http://16.63.31.242:5000',
    'https://16.63.31.242:5000',  
    'https://dazzling-cactus-707f06.netlify.app',
    'https://audio-labeling-backend-env.eba-pgmcfbu2.eu-central-1.elasticbeanstalk.com',
    "https://staging.d22qs6a8e1ppd0.amplifyapp.com",
    "http://www.resmonics.net/",
    "https://www.resmonics.net/",
    "http://16.resmonics.net/",
    "https://16.resmonics.net/"
  ],
  credentials: true
}));
app.use(express.json());

const { router: authRoutes, initializeCleanup } = authRoutesModule;

// Use only the routes you have
app.use('/api/auth', authRoutes);
app.use('/api/audio', audioRoutes); // This contains all admin functions

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);

  initializeCleanup();
});