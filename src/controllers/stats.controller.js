const Customer = require('../models/Customer');
const Campaign = require('../models/Campaign');
const CampaignStats = require('../models/CampaignStats');
const { success } = require('../utils/responseHelper');

// @desc    Get dashboard metrics and campaign history
// @route   GET /api/stats/overview
// @access  Private
exports.getOverview = async (req, res, next) => {
  try {
    const totalCustomers = await Customer.countDocuments(req.user.role === 'admin' ? {} : { userId: req.user._id });
    const totalCampaigns = await Campaign.countDocuments(req.user.role === 'admin' ? {} : { userId: req.user._id });

    // Calculate averages across CampaignStats scoped to active user
    const matchQuery = req.user.role === 'admin' ? {} : { userId: req.user._id };
    const avgStats = await CampaignStats.aggregate([
      {
        $match: matchQuery
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

    // Fetch last 7 campaigns with stats scoped to active user
    const query = req.user.role === 'admin' ? {} : { userId: req.user._id };
    const recentCampaignsRaw = await Campaign.find(query)
      .populate('segmentId', 'name audienceCount')
      .sort({ createdAt: -1 })
      .limit(7);

    const recentCampaigns = await Promise.all(recentCampaignsRaw.map(async (c) => {
      const statsQuery = req.user.role === 'admin' ? { campaignId: c._id } : { campaignId: c._id, userId: req.user._id };
      const stats = await CampaignStats.findOne(statsQuery);
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
