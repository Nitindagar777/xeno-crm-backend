const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    index: true
  },
  password: {
    type: String,
    minlength: [6, 'Password must be at least 6 characters'],
    // Not required globally — Google users won't have a password
    required: function () {
      return this.authProvider === 'local';
    }
  },
  role: {
    type: String,
    enum: ['admin', 'marketer'],
    default: 'marketer'
  },
  // Google OAuth fields
  googleId: {
    type: String,
    unique: true,
    sparse: true // allows multiple null values
  },
  avatar: {
    type: String,
    default: null
  },
  authProvider: {
    type: String,
    enum: ['local', 'google'],
    default: 'local'
  }
}, {
  timestamps: true
});

// Pre-save hook to hash password (only for local auth)
UserSchema.pre('save', async function(next) {
  if (!this.isModified('password') || !this.password) {
    return next();
  }
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

// Instance method to compare password
UserSchema.methods.comparePassword = async function(candidatePassword) {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', UserSchema);
