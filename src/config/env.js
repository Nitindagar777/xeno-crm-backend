require('dotenv').config();

const requiredEnvVars = [
  'PORT',
  'MONGODB_URI',
  'JWT_SECRET',
  'JWT_EXPIRES_IN',
  'GEMINI_API_KEY',
  'CHANNEL_SERVICE_URL',
  'CHANNEL_SECRET'
];

const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  console.warn(`[WARNING] Missing environment variables: ${missingEnvVars.join(', ')}`);
  console.warn('Please check your .env file to ensure all required variables are set.');
}

// Optional but recommended
if (!process.env.GOOGLE_CLIENT_ID) {
  console.warn('[INFO] GOOGLE_CLIENT_ID not set — Google OAuth login will be disabled.');
}

module.exports = {
  PORT: process.env.PORT || 5000,
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/xenocrm',
  JWT_SECRET: process.env.JWT_SECRET || 'xeno_super_secret_jwt_key_2026_d2c_brand',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite',
  CHANNEL_SERVICE_URL: process.env.CHANNEL_SERVICE_URL || 'http://localhost:5001',
  CHANNEL_SECRET: process.env.CHANNEL_SECRET || 'xeno_channel_shared_secret_2026',
  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:5173',
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || ''
};
