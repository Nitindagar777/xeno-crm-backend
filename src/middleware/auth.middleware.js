const jwt = require('jsonwebtoken');
const env = require('../config/env');
const User = require('../models/User');

module.exports = async (req, res, next) => {
  // Get token from header
  const authHeader = req.header('Authorization');
  if (!authHeader) {
    return res.status(401).json({ success: false, error: 'Authorization header missing', message: 'No token, authorization denied' });
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({ success: false, error: 'Token format invalid', message: 'Token must be Bearer <token>' });
  }

  const token = parts[1];

  try {
    // Verify token
    const decoded = jwt.verify(token, env.JWT_SECRET);
    
    // Check if user still exists
    const user = await User.findById(decoded.userId).select('-password');
    if (!user) {
      return res.status(401).json({ success: false, error: 'User no longer exists', message: 'Authorization denied' });
    }

    req.user = user;
    next();
  } catch (err) {
    console.error('JWT verification failed:', err.message);
    return res.status(401).json({ success: false, error: 'Token invalid or expired', message: 'Token is not valid' });
  }
};
