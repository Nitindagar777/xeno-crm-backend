const mongoose = require('mongoose');
const env = require('./env');

const connectDB = async () => {
  const options = {
    autoIndex: true, // Build indexes
  };

  const connectWithRetry = () => {
    console.log('Attempting MongoDB connection...');
    mongoose.connect(env.MONGODB_URI, options)
      .then(() => {
        console.log('MongoDB successfully connected.');
      })
      .catch(err => {
        console.error('MongoDB connection error. Retrying in 5 seconds...', err.message);
        setTimeout(connectWithRetry, 5000);
      });
  };

  // Connection events
  mongoose.connection.on('disconnected', () => {
    console.warn('MongoDB connection lost. Retrying...');
  });

  mongoose.connection.on('error', (err) => {
    console.error('MongoDB connection error:', err);
  });

  connectWithRetry();
};

module.exports = connectDB;
