const { GetCommand, PutCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb"); // Add ScanCommand here
const { docClient } = require("../utils/dynamodb");
const { uploadFile } = require("../utils/s3");
const bcrypt = require('bcryptjs');

const usersTable = process.env.USERS_TABLE;
const labelsTable = process.env.LABELS_TABLE;

exports.createLabeler = async (req, res) => {
  const { name, email, password } = req.body;

  // Validation
  if (!name || !email || !password) {
    return res.status(400).json({ 
      success: false,
      message: "Name, email, and password are required" 
    });
  }

  try {
    // Check if user exists
    const existing = await docClient.send(new GetCommand({
      TableName: usersTable,
      Key: { email },
    }));

    if (existing.Item) {
      return res.status(400).json({ 
        success: false,
        message: "User already exists with this email" 
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create new labeler user
    const userItem = {
      email,
      name,
      password: hashedPassword,
      role: "labeler",
      createdAt: new Date().toISOString(),
      isActive: true
    };

    await docClient.send(new PutCommand({
      TableName: usersTable,
      Item: userItem
    }));

    // Remove password from response
    const { password: _, ...userResponse } = userItem;

    res.status(201).json({
      success: true,
      message: "Labeler created successfully",
      user: userResponse
    });

  } catch (err) {
    console.error("Create labeler error:", err);
    res.status(500).json({ 
      success: false,
      message: "Server error while creating labeler" 
    });
  }
};


// Get all labelers for admin management
exports.getLabelers = async (req, res) => {
  try {
    // Note: This is a simplified approach. In production, you might want to use GSI for role-based queries
    const result = await docClient.send(new ScanCommand({
      TableName: usersTable,
      FilterExpression: "role = :role",
      ExpressionAttributeValues: {
        ":role": "labeler"
      }
    }));

    const labelers = result.Items.map(user => {
      const { password, ...userWithoutPassword } = user;
      return userWithoutPassword;
    });

    res.json({
      success: true,
      labelers: labelers
    });

  } catch (err) {
    console.error("Get labelers error:", err);
    res.status(500).json({ 
      success: false,
      message: "Server error while fetching labelers" 
    });
  }
};