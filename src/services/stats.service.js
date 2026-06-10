const mongoose = require('mongoose');
const CommunicationLog = require('../models/CommunicationLog');
const CampaignStats = require('../models/CampaignStats');
const Campaign = require('../models/Campaign');

/**
 * Recomputes aggregated statistics for a campaign based on its CommunicationLogs.
 * @param {string|mongoose.Types.ObjectId} campaignId Campaign ID
 * @returns {Promise<Object>} Aggregated campaign statistics
 */
const updateCampaignStats = async (campaignId) => {
  const campaignIdObj = new mongoose.Types.ObjectId(campaignId);

  // Run MongoDB aggregation pipeline
  const stats = await CommunicationLog.aggregate([
    { $match: { campaignId: campaignIdObj } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        queued: { $sum: { $cond: [{ $eq: ['$status', 'queued'] }, 1, 0] } },
        sent: { $sum: { $cond: [{ $in: ['$status', ['sent', 'delivered', 'opened', 'read', 'clicked', 'failed']] }, 1, 0] } },
        delivered: { $sum: { $cond: [{ $in: ['$status', ['delivered', 'opened', 'read', 'clicked']] }, 1, 0] } },
        failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
        opened: { $sum: { $cond: [{ $in: ['$status', ['opened', 'read', 'clicked']] }, 1, 0] } },
        read: { $sum: { $cond: [{ $in: ['$status', ['read', 'clicked']] }, 1, 0] } },
        clicked: { $sum: { $cond: [{ $eq: ['$status', 'clicked'] }, 1, 0] } },
        converted: { $sum: { $cond: [{ $eq: ['$converted', true] }, 1, 0] } },
        active: { $sum: { $cond: [{ $in: ['$status', ['queued', 'sent']] }, 1, 0] } }
      }
    }
  ]);

  const campaign = await Campaign.findById(campaignIdObj);
  const userId = campaign ? campaign.userId : null;

  const defaultStats = {
    campaignId: campaignIdObj,
    userId,
    total: 0,
    queued: 0,
    sent: 0,
    delivered: 0,
    failed: 0,
    opened: 0,
    read: 0,
    clicked: 0,
    converted: 0,
    active: 0
  };

  const aggregated = stats.length > 0 ? { campaignId: campaignIdObj, userId, ...stats[0] } : defaultStats;
  delete aggregated._id;

  // Find and update or insert CampaignStats
  let campaignStats = await CampaignStats.findOne({ campaignId: campaignIdObj });
  if (!campaignStats) {
    campaignStats = new CampaignStats(aggregated);
  } else {
    Object.assign(campaignStats, aggregated);
  }

  await campaignStats.save();

  // If all messages are in terminal state (delivered, failed, clicked, read, opened),
  // we mark the campaign as completed.
  const activeCount = aggregated.active;
  
  if (aggregated.total > 0 && activeCount === 0) {
    if (campaign && campaign.status === 'running') {
      campaign.status = 'completed';
      campaign.completedAt = new Date();
      await campaign.save();
      console.log(`[Stats Service] Campaign ${campaignId} marked as completed.`);
    }
  }

  return campaignStats;
};

module.exports = { updateCampaignStats };
