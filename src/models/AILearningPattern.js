const mongoose = require('mongoose');

const AILearningPatternSchema = new mongoose.Schema({
  prompt: {
    type: String,
    required: true,
    index: true,
    lowercase: true,
    trim: true
  },
  keywords: {
    type: [String],
    index: true
  },
  segmentRules: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  segmentName: String,
  segmentDesc: String,
  campaignName: String,
  messageTemplate: String,
  channel: String
}, {
  timestamps: true
});

module.exports = mongoose.model('AILearningPattern', AILearningPatternSchema);
