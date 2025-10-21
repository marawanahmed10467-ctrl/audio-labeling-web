const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const {docClient} = require('../utils/dynamodb');

// Add this debug
console.log('docClient type:', typeof docClient);
console.log('docClient has send method:', docClient && typeof docClient.send === 'function');
console.log('docClient:', docClient);

exports.login = async (req, res) => {
  const { email, password } = req.body;

  // Validation
  if (!email || !password) {
    return res.status(400).json({ 
      success: false,
      message: "Email and password are required" 
    });
  }

  try {
    // Admin check
    if (email === process.env.ADMIN_EMAIL && password === process.env.ADMIN_PASSWORD) {
      const token = jwt.sign({ email, role: "admin" }, process.env.JWT_SECRET, {
        expiresIn: "24h",
      });

      return res.json({
        success: true,
        message: "Admin login successful",
        token,
        user: {
          email,
          name: "Admin",
          role: "admin",
        },
      });
    }

    // Labeler login
    const userResult = await docClient.send(new GetCommand({
      TableName: process.env.USERS_TABLE,
      Key: { email },
    }));

    const user = userResult.Item;
    if (!user) {
      return res.status(400).json({ 
        success: false,
        message: "Invalid email or password" 
      });
    }

    // Check if user is active
    if (user.isActive === false) {
      return res.status(400).json({ 
        success: false,
        message: "Account is deactivated" 
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ 
        success: false,
        message: "Invalid email or password" 
      });
    }

    const token = jwt.sign({ email, role: user.role }, process.env.JWT_SECRET, {
      expiresIn: "24h",
    });

    // Remove password from response
    const { password: _, ...userWithoutPassword } = user;
    
    res.json({
      success: true,
      message: "Login successful",
      token,
      user: userWithoutPassword
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ 
      success: false,
      message: "Server error during login" 
    });
  }
};

// Optional: Add registration if needed
exports.register = async (req, res) => {
  const { name, email, password, role = 'labeler' } = req.body;

  try {
    // Check if user exists
    const existingUser = await docClient.send(new GetCommand({
      TableName: process.env.USERS_TABLE,
      Key: { email }
    }));

    if (existingUser.Item) {
      return res.status(400).json({ 
        success: false,
        message: 'User already exists with this email' 
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create user
    const user = {
      email,
      name,
      password: hashedPassword,
      role,
      createdAt: new Date().toISOString(),
      isActive: true
    };

    await docClient.send(new PutCommand({
      TableName: process.env.USERS_TABLE,
      Item: user
    }));

    // Create token
    const token = jwt.sign(
      { email: user.email, role: user.role }, 
      process.env.JWT_SECRET, 
      { expiresIn: '24h' }
    );

    // Remove password from response
    const { password: _, ...userWithoutPassword } = user;

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      token,
      user: userWithoutPassword
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during registration'
    });
  }
};

// Get current user profile
exports.getMe = async (req, res) => {
  try {
    const userResult = await docClient.send(new GetCommand({
      TableName: process.env.USERS_TABLE,
      Key: { email: req.user.email }
    }));

    const user = userResult.Item;
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Remove password from response
    const { password: _, ...userWithoutPassword } = user;

    res.json({
      success: true,
      user: userWithoutPassword
    });

  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};