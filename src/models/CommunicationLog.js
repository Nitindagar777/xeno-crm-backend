const mongoose = require('mongoose');

const CommunicationLogSchema = new mongoose.Schema({
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
  campaignId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Campaign',
    required: [true, 'Campaign ID is required'],
    index: true
  },
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: [true, 'Customer ID is required'],
    index: true
  },
  personalizedMessage: {
    type: String
  },
  channel: {
    type: String,
    enum: ['whatsapp', 'sms', 'email', 'rcs'],
    required: true
  },
  vendorMessageId: {
    type: String,
    index: true
  },
  status: {
    type: String,
    enum: ['queued', 'sent', 'delivered', 'failed', 'opened', 'read', 'clicked'],
    default: 'queued'
  },
  statusHistory: [{
    status: {
      type: String,
      required: true
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    meta: {
      type: mongoose.Schema.Types.Mixed
    }
  }],
  converted: {
    type: Boolean,
    default: false
  },
  convertedAt: {
    type: Date
  },
  conversionValue: {
    type: Number,
    default: 0
  },
  failureReason: {
    type: String
  }
}, {
  timestamps: true
});

// Compound index for aggregation and querying
CommunicationLogSchema.index({ campaignId: 1, status: 1 });

module.exports = mongoose.model('CommunicationLog', CommunicationLogSchema);
