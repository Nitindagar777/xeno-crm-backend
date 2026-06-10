const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const env = require('../config/env');
const { success, error } = require('../utils/responseHelper');
const { validationResult } = require('express-validator');

const googleClient = new OAuth2Client(env.GOOGLE_CLIENT_ID);

// @desc    Register a new user
// @route   POST /api/auth/register
// @access  Public
exports.register = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return error(res, errors.array().map(e => e.msg).join(', '), 400);
  }

  const { name, email, password, role } = req.body;

  try {
    // Check if user already exists
    let user = await User.findOne({ email });
    if (user) {
      return error(res, 'A user with this email already exists', 400);
    }

    // Create user
    user = new User({
      name,
      email,
      password,
      role: role || 'marketer',
      authProvider: 'local'
    });

    await user.save();

    // Generate JWT
    const token = jwt.sign(
      { userId: user._id, email: user.email, role: user.role },
      env.JWT_SECRET,
      { expiresIn: env.JWT_EXPIRES_IN }
    );

    const userResponse = {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
      authProvider: user.authProvider,
      createdAt: user.createdAt
    };

    return success(res, { token, user: userResponse }, 'Registration successful', 201);
  } catch (err) {
    next(err);
  }
};

// @desc    Authenticate user & get token
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return error(res, errors.array().map(e => e.msg).join(', '), 400);
  }

  const { email, password } = req.body;

  try {
    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      return error(res, 'Invalid credentials', 401);
    }

    // If user signed up with Google, tell them to use Google login
    if (user.authProvider === 'google' && !user.password) {
      return error(res, 'This account uses Google Sign-In. Please use the Google button to log in.', 400);
    }

    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return error(res, 'Invalid credentials', 401);
    }

    // Generate JWT
    const token = jwt.sign(
      { userId: user._id, email: user.email, role: user.role },
      env.JWT_SECRET,
      { expiresIn: env.JWT_EXPIRES_IN }
    );

    const userResponse = {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
      authProvider: user.authProvider
    };

    return success(res, { token, user: userResponse }, 'Login successful');
  } catch (err) {
    next(err);
  }
};

// @desc    Google OAuth login/register
// @route   POST /api/auth/google
// @access  Public
exports.googleLogin = async (req, res, next) => {
  const { credential } = req.body;

  if (!credential) {
    return error(res, 'Google credential token is required', 400);
  }

  try {
    // Verify the Google ID token
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture } = payload;

    if (!email) {
      return error(res, 'Unable to retrieve email from Google account', 400);
    }

    // Check if user exists by googleId or email
    let user = await User.findOne({
      $or: [{ googleId }, { email }]
    });

    if (user) {
      // User exists — link Google if not already linked
      if (!user.googleId) {
        user.googleId = googleId;
        user.authProvider = 'google';
        if (picture && !user.avatar) user.avatar = picture;
        await user.save();
      }
    } else {
      // Brand new user — create account
      user = new User({
        name,
        email,
        googleId,
        avatar: picture || null,
        authProvider: 'google',
        role: 'marketer'
      });
      await user.save();
    }

    // Generate JWT
    const token = jwt.sign(
      { userId: user._id, email: user.email, role: user.role },
      env.JWT_SECRET,
      { expiresIn: env.JWT_EXPIRES_IN }
    );

    const userResponse = {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
      authProvider: user.authProvider
    };

    return success(res, { token, user: userResponse }, 'Google authentication successful');
  } catch (err) {
    console.error('[Google Auth Error]:', err.message);

    // Handle specific Google verification errors
    if (err.message.includes('Token used too late') || err.message.includes('Invalid token')) {
      return error(res, 'Google token expired or invalid. Please try again.', 401);
    }

    next(err);
  }
};

// @desc    Get current user profile
// @route   GET /api/auth/me
// @access  Private
exports.getMe = async (req, res, next) => {
  try {
    // req.user is already attached by auth middleware
    return success(res, req.user, 'User profile fetched successfully');
  } catch (err) {
    next(err);
  }
};
