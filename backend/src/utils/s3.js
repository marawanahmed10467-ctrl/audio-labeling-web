// utils/s3.js
const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

function createS3Client() {
  return new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
}

// FIX: Modified to accept custom key parameter
async function uploadFile(file, customKey = null) {
  const s3Client = createS3Client(); 
  const key = customKey || `${Date.now()}_${file.originalname}`;
  
  const params = {
    Bucket: process.env.S3_BUCKET_NAME,
    Key: key, // Use the provided key or generate default
    Body: file.buffer,
    ContentType: file.mimetype,
  };
  
  console.log(`📤 Uploading to S3: ${key}, ContentType: ${file.mimetype}`);
  const command = new PutObjectCommand(params);
  await s3Client.send(command);
  return key; // Return the actual key used
}

async function getPresignedUrl(fileKey) {
  const s3Client = createS3Client(); 
  const command = new GetObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME,
    Key: fileKey,
  });
  
  console.log(`🔗 Generating presigned URL for: ${fileKey}`);
  const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
  console.log(`✅ Presigned URL generated: ${url}`);
  return url;
}

module.exports = { uploadFile, getPresignedUrl };