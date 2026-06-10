const mongoose = require('mongoose');

const SegmentSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: [true, 'Segment name is required'],
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  rules: {
    conditions: [{
      field: {
        type: String,
        required: true
      },
      operator: {
        type: String,
        required: true,
        enum: ['gt', 'lt', 'gte', 'lte', 'eq', 'neq', 'in', 'nin', 'contains']
      },
      value: {
        type: mongoose.Schema.Types.Mixed,
        required: true
      }
    }],
    logic: {
      type: String,
      enum: ['AND', 'OR'],
      default: 'AND'
    }
  },
  audienceIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer'
  }],
  audienceCount: {
    type: Number,
    default: 0
  },
  createdBy: {
    type: String,
    enum: ['manual', 'ai'],
    default: 'manual'
  },
  aiPrompt: {
    type: String
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Segment', SegmentSchema);
