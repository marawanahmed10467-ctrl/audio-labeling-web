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

async function uploadFile(file) {
  const s3Client = createS3Client(); 
  const params = {
    Bucket: process.env.S3_BUCKET_NAME,
    Key: `${Date.now()}_${file.originalname}`,
    Body: file.buffer,
    ContentType: file.mimetype,
  };
  const command = new PutObjectCommand(params);
  await s3Client.send(command);
  return params.Key;
}

async function getPresignedUrl(fileKey) {
  const s3Client = createS3Client(); 
  const command = new GetObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME,
    Key: fileKey,
  });
  return await getSignedUrl(s3Client, command, { expiresIn: 3600 });
}

module.exports = { uploadFile, getPresignedUrl };
