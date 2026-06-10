const express = require('express');
const { body } = require('express-validator');
const authController = require('../controllers/auth.controller');
const authMiddleware = require('../middleware/auth.middleware');
const { authLimiter } = require('../middleware/rateLimiter.middleware');

const router = express.Router();

// Apply auth rate limiter to register and login
router.post(
  '/register',
  authLimiter,
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('email').isEmail().withMessage('Please enter a valid email address').normalizeEmail(),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
  ],
  authController.register
);

router.post(
  '/login',
  authLimiter,
  [
    body('email').isEmail().withMessage('Please enter a valid email address').normalizeEmail(),
    body('password').notEmpty().withMessage('Password is required')
  ],
  authController.login
);

// Google OAuth — no express-validator needed, credential is verified server-side
router.post('/google', authLimiter, authController.googleLogin);

router.get('/me', authMiddleware, authController.getMe);

module.exports = router;
