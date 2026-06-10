const mongoose = require('mongoose');

const CampaignStatsSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  campaignId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Campaign',
    required: [true, 'Campaign ID is required'],
    unique: true
  },
  total: { type: Number, default: 0 },
  queued: { type: Number, default: 0 },
  sent: { type: Number, default: 0 },
  delivered: { type: Number, default: 0 },
  failed: { type: Number, default: 0 },
  opened: { type: Number, default: 0 },
  read: { type: Number, default: 0 },
  clicked: { type: Number, default: 0 },
  converted: { type: Number, default: 0 },
  deliveryRate: { type: Number, default: 0 },
  openRate: { type: Number, default: 0 },
  clickRate: { type: Number, default: 0 },
  lastUpdated: { type: Date, default: Date.now }
}, {
  timestamps: true
});

// Pre-save hook to automatically compute rates
CampaignStatsSchema.pre('save', function(next) {
  if (this.total > 0) {
    this.deliveryRate = parseFloat(((this.delivered / this.total) * 100).toFixed(2));
    this.openRate = this.delivered > 0 ? parseFloat(((this.opened / this.delivered) * 100).toFixed(2)) : 0;
    this.clickRate = this.opened > 0 ? parseFloat(((this.clicked / this.opened) * 100).toFixed(2)) : 0;
  } else {
    this.deliveryRate = 0;
    this.openRate = 0;
    this.clickRate = 0;
  }
  this.lastUpdated = new Date();
  next();
});

module.exports = mongoose.model('CampaignStats', CampaignStatsSchema);
