const Campaign = require('../models/Campaign');
const Segment = require('../models/Segment');
const Customer = require('../models/Customer');
const CommunicationLog = require('../models/CommunicationLog');
const Activity = require('../models/Activity');
const Workspace = require('../models/Workspace');
const { success, error } = require('../utils/responseHelper');

/**
 * @desc    Get paginated activity logs for workspace timeline
 * @route   GET /api/workspace
 * @access  Private
 */
exports.getActivities = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = 20;
    const skip = (page - 1) * limit;

    // Filter by active workspace
    const query = { workspaceId: req.workspaceId };

    if (req.query.type) {
      query.type = req.query.type;
    }

    const total = await Activity.countDocuments(query);
    const activities = await Activity.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const pages = Math.ceil(total / limit);

    return res.status(200).json({
      success: true,
      data: activities,
      pagination: {
        page,
        pages,
        total
      }
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Get summary counts and recent workspace entities
 * @route   GET /api/workspace/summary
 * @access  Private
 */
exports.getSummary = async (req, res, next) => {
  try {
    const query = { workspaceId: req.workspaceId };

    // Fetch counts in parallel
    const [
      campaignCount,
      segmentCount,
      customerCount,
      messageCount
    ] = await Promise.all([
      Campaign.countDocuments(query),
      Segment.countDocuments(query),
      Customer.countDocuments(query),
      CommunicationLog.countDocuments(query)
    ]);

    // Fetch 5 most recent of each entity in parallel
    const [
      recentCampaigns,
      recentSegments,
      recentCustomers
    ] = await Promise.all([
      Campaign.find(query)
        .populate('segmentId', 'name')
        .sort({ createdAt: -1 })
        .limit(5),
      Segment.find(query)
        .select('-audienceIds')
        .sort({ createdAt: -1 })
        .limit(5),
      Customer.find(query)
        .sort({ createdAt: -1 })
        .limit(5)
    ]);

    return success(res, {
      counts: {
        campaigns: campaignCount,
        segments: segmentCount,
        customers: customerCount,
        messages: messageCount
      },
      recentCampaigns,
      recentSegments,
      recentCustomers
    }, 'Workspace summary fetched successfully');
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Get all workspaces for the logged in user
 * @route   GET /api/workspace/list
 * @access  Private
 */
exports.getWorkspaces = async (req, res, next) => {
  try {
    let workspaces = await Workspace.find({ userId: req.user._id }).sort({ createdAt: 1 });
    if (workspaces.length === 0) {
      const defaultWorkspace = new Workspace({
        name: 'Default Workspace',
        description: 'Your primary workspace',
        userId: req.user._id
      });
      await defaultWorkspace.save();
      workspaces = [defaultWorkspace];
    }
    return success(res, workspaces, 'Workspaces fetched successfully');
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Create a new workspace
 * @route   POST /api/workspace
 * @access  Private
 */
exports.createWorkspace = async (req, res, next) => {
  try {
    const { name, description } = req.body;
    if (!name) {
      return error(res, 'Workspace name is required', 400);
    }
    const workspace = new Workspace({
      name,
      description: description || '',
      userId: req.user._id
    });
    await workspace.save();
    return success(res, workspace, 'Workspace created successfully', 201);
  } catch (err) {
    next(err);
  }
};
