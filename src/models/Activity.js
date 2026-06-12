const mongoose = require('mongoose');

const ActivitySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  workspaceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workspace',
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: [
      'campaign_created',
      'campaign_sent',
      'campaign_completed',
      'segment_created',
      'segment_updated',
      'segment_refreshed',
      'customer_created',
      'customers_imported',
      'ai_agent_used'
    ],
    required: true
  },
  title: {
    type: String,
    required: true
  },
  description: {
    type: String
  },
  resourceType: {
    type: String,
    enum: ['campaign', 'segment', 'customer']
  },
  resourceId: {
    type: mongoose.Schema.Types.ObjectId
  },
  meta: {
    type: mongoose.Schema.Types.Mixed
  }
}, {
  timestamps: true
});

// Compound index for efficient workspace timeline queries
ActivitySchema.index({ workspaceId: 1, createdAt: -1 });

module.exports = mongoose.model('Activity', ActivitySchema);
