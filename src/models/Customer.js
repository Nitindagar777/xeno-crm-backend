const mongoose = require('mongoose');

const CustomerSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  workspaceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workspace',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: [true, 'Customer name is required'],
    trim: true
  },
  email: {
    type: String,
    unique: true,
    sparse: true,
    lowercase: true,
    trim: true
  },
  phone: {
    type: String,
    trim: true
  },
  gender: {
    type: String,
    enum: ['male', 'female', 'other', 'unknown'],
    default: 'unknown'
  },
  city: {
    type: String,
    trim: true,
    index: true
  },
  tags: {
    type: [String],
    default: [],
    index: true
  },
  totalSpend: {
    type: Number,
    default: 0
  },
  orderCount: {
    type: Number,
    default: 0
  },
  firstOrderDate: {
    type: Date
  },
  lastOrderDate: {
    type: Date
  },
  avgOrderValue: {
    type: Number,
    default: 0
  },
  source: {
    type: String,
    enum: ['csv', 'manual', 'api', 'excel', 'json'],
    default: 'manual'
  },
  customFields: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Compound index for segment rules queries
CustomerSchema.index({ totalSpend: 1, lastOrderDate: 1 });

// Virtual daysSinceLastOrder
CustomerSchema.virtual('daysSinceLastOrder').get(function() {
  if (!this.lastOrderDate) return null;
  const diffTime = Math.abs(new Date() - this.lastOrderDate);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
});

module.exports = mongoose.model('Customer', CustomerSchema);
