const express = require('express');
const { login, register, getMe } = require('../controllers/authController');

const router = express.Router();

// Public routes
router.post('/login', login);
router.post('/register', register); // Optional


module.exports = router;