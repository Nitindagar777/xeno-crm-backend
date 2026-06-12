const Customer = require('../models/Customer');
const Campaign = require('../models/Campaign');
const CampaignStats = require('../models/CampaignStats');
const { success } = require('../utils/responseHelper');

// @desc    Get dashboard metrics and campaign history
// @route   GET /api/stats/overview
// @access  Private
exports.getOverview = async (req, res, next) => {
  try {
    const totalCustomers = await Customer.countDocuments({ workspaceId: req.workspaceId });
    const totalCampaigns = await Campaign.countDocuments({ workspaceId: req.workspaceId });

    // Fetch workspace campaigns first to scope statistics averages
    const workspaceCampaigns = await Campaign.find({ workspaceId: req.workspaceId }).select('_id');
    const campaignIds = workspaceCampaigns.map(c => c._id);

    // Calculate averages across CampaignStats scoped to active workspace campaigns
    const avgStats = await CampaignStats.aggregate([
      {
        $match: { campaignId: { $in: campaignIds } }
      },
      {
        $group: {
          _id: null,
          avgDelivery: { $avg: '$deliveryRate' },
          avgOpen: { $avg: '$openRate' },
          avgClick: { $avg: '$clickRate' }
        }
      }
    ]);

    const statsSummary = avgStats[0] || { avgDelivery: 0, avgOpen: 0, avgClick: 0 };

    // Fetch last 7 campaigns with stats scoped to active workspace
    const recentCampaignsRaw = await Campaign.find({ workspaceId: req.workspaceId })
      .populate('segmentId', 'name audienceCount')
      .sort({ createdAt: -1 })
      .limit(7);

    const recentCampaigns = await Promise.all(recentCampaignsRaw.map(async (c) => {
      const stats = await CampaignStats.findOne({ campaignId: c._id });
      return {
        ...c.toObject(),
        stats: stats || null
      };
    }));

    return success(res, {
      totalCustomers,
      totalCampaigns,
      avgDeliveryRate: parseFloat((statsSummary.avgDelivery || 0).toFixed(2)),
      avgOpenRate: parseFloat((statsSummary.avgOpen || 0).toFixed(2)),
      avgClickRate: parseFloat((statsSummary.avgClick || 0).toFixed(2)),
      recentCampaigns
    }, 'Overview metrics fetched successfully');
  } catch (err) {
    next(err);
  }
};
