const CommunicationLog = require('../models/CommunicationLog');
const { success, error } = require('../utils/responseHelper');

/**
 * @desc    Get paginated message history with filters
 * @route   GET /api/history/messages
 * @access  Private
 */
exports.getMessageHistory = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const skip = (page - 1) * limit;

    // Scope to active workspace
    const query = { workspaceId: req.workspaceId };

    // Apply status filter if present and not 'all'
    if (req.query.status && req.query.status !== 'all') {
      query.status = req.query.status.toLowerCase();
    }

    // Apply channel filter if present and not 'all'
    if (req.query.channel && req.query.channel !== 'all') {
      query.channel = req.query.channel.toLowerCase();
    }

    // Apply campaign filter if present
    if (req.query.campaignId) {
      query.campaignId = req.query.campaignId;
    }

    const total = await CommunicationLog.countDocuments(query);
    const logs = await CommunicationLog.find(query)
      .populate('campaignId', 'name')
      .populate('customerId', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const totalPages = Math.ceil(total / limit);

    return res.status(200).json({
      success: true,
      data: logs,
      pagination: {
        page,
        pages: totalPages,
        total
      }
    });
  } catch (err) {
    next(err);
  }
};
