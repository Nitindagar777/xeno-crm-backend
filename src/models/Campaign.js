const mongoose = require('mongoose');

const CampaignSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: [true, 'Campaign name is required'],
    trim: true
  },
  segmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Segment',
    required: [true, 'Segment ID is required']
  },
  messageTemplate: {
    type: String,
    required: [true, 'Message template is required']
  },
  channel: {
    type: String,
    enum: ['whatsapp', 'sms', 'email', 'rcs'],
    required: [true, 'Channel is required']
  },
  status: {
    type: String,
    enum: ['draft', 'running', 'completed', 'failed', 'scheduled'],
    default: 'draft'
  },
  scheduledAt: {
    type: Date
  },
  startedAt: {
    type: Date
  },
  completedAt: {
    type: Date
  },
  createdBy: {
    type: String,
    enum: ['manual', 'ai'],
    default: 'manual'
  },
  aiContext: {
    type: String
  },
  aiAnalysis: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Campaign', CampaignSchema);
