const Segment = require('../models/Segment');
const { resolveSegment } = require('../services/segmentEngine.service');
const { success, error } = require('../utils/responseHelper');
const { logActivity } = require('../services/activity.service');

// @desc    Get all segments
// @route   GET /api/segments
// @access  Private
exports.getSegments = async (req, res, next) => {
  try {
    const query = { workspaceId: req.workspaceId };
    const segments = await Segment.find(query).select('-audienceIds').sort({ createdAt: -1 });
    return success(res, segments, 'Segments fetched successfully');
  } catch (err) {
    next(err);
  }
};

// @desc    Get single segment with resolved audience details
// @route   GET /api/segments/:id
// @access  Private
exports.getSegment = async (req, res, next) => {
  try {
    const query = { _id: req.params.id, workspaceId: req.workspaceId };
    const segment = await Segment.findOne(query);
    if (!segment) {
      return error(res, 'Segment not found', 404);
    }
    return success(res, segment, 'Segment fetched successfully');
  } catch (err) {
    next(err);
  }
};

// @desc    Create segment and resolve initial audience
// @route   POST /api/segments
// @access  Private
exports.createSegment = async (req, res, next) => {
  try {
    const { name, description, rules, createdBy, aiPrompt } = req.body;

    if (!name || !rules || !rules.conditions) {
      return error(res, 'Name and rules are required', 400);
    }

    // Resolve audienceIds and audienceCount scoped to active workspace
    const { audienceIds, audienceCount } = await resolveSegment(rules, req.workspaceId);

    const segment = new Segment({
      userId: req.user._id,
      workspaceId: req.workspaceId,
      name,
      description,
      rules,
      audienceIds,
      audienceCount,
      createdBy: createdBy || 'manual',
      aiPrompt
    });

    await segment.save();

    logActivity({
      userId: req.user._id,
      workspaceId: req.workspaceId,
      type: 'segment_created',
      title: `Created segment: ${segment.name}`,
      description: `${segment.audienceCount} customers matched`,
      resourceType: 'segment',
      resourceId: segment._id,
      meta: { audienceCount: segment.audienceCount, createdBy: segment.createdBy }
    });

    return success(res, segment, 'Segment created successfully', 201);
  } catch (err) {
    next(err);
  }
};

// @desc    Update segment and re-resolve audience
// @route   PUT /api/segments/:id
// @access  Private
exports.updateSegment = async (req, res, next) => {
  try {
    const { name, description, rules } = req.body;

    const query = { _id: req.params.id, workspaceId: req.workspaceId };
    let segment = await Segment.findOne(query);
    if (!segment) {
      return error(res, 'Segment not found', 404);
    }

    if (name) segment.name = name;
    if (description !== undefined) segment.description = description;
    
    if (rules && rules.conditions) {
      segment.rules = rules;
      // Re-resolve segment rules scoped to active workspace
      const { audienceIds, audienceCount } = await resolveSegment(rules, req.workspaceId);
      segment.audienceIds = audienceIds;
      segment.audienceCount = audienceCount;
    }

    await segment.save();

    logActivity({
      userId: req.user._id,
      workspaceId: req.workspaceId,
      type: 'segment_updated',
      title: `Updated segment: ${segment.name}`,
      description: `New count: ${segment.audienceCount} customers matched`,
      resourceType: 'segment',
      resourceId: segment._id,
      meta: { audienceCount: segment.audienceCount }
    });

    return success(res, segment, 'Segment updated successfully');
  } catch (err) {
    next(err);
  }
};

// @desc    Delete segment
// @route   DELETE /api/segments/:id
// @access  Private
exports.deleteSegment = async (req, res, next) => {
  try {
    const query = { _id: req.params.id, workspaceId: req.workspaceId };
    const segment = await Segment.findOne(query);
    if (!segment) {
      return error(res, 'Segment not found', 404);
    }

    await segment.deleteOne();
    return success(res, null, 'Segment deleted successfully');
  } catch (err) {
    next(err);
  }
};

// @desc    Re-run segment engine against latest customer data
// @route   POST /api/segments/:id/refresh
// @access  Private
exports.refreshSegment = async (req, res, next) => {
  try {
    const query = { _id: req.params.id, workspaceId: req.workspaceId };
    const segment = await Segment.findOne(query);
    if (!segment) {
      return error(res, 'Segment not found', 404);
    }

    const { audienceIds, audienceCount } = await resolveSegment(segment.rules, req.workspaceId);
    
    segment.audienceIds = audienceIds;
    segment.audienceCount = audienceCount;
    await segment.save();

    logActivity({
      userId: req.user._id,
      workspaceId: req.workspaceId,
      type: 'segment_refreshed',
      title: `Refreshed segment: ${segment.name}`,
      description: `Audience refreshed to ${segment.audienceCount} customers`,
      resourceType: 'segment',
      resourceId: segment._id,
      meta: { audienceCount: segment.audienceCount }
    });

    return success(res, { audienceCount, lastRefreshed: segment.updatedAt }, 'Segment audience refreshed successfully');
  } catch (err) {
    next(err);
  }
};

// @desc    Preview segment audience size without saving
// @route   POST /api/segments/preview
// @access  Private
exports.previewSegment = async (req, res, next) => {
  try {
    const { rules } = req.body;
    if (!rules || !rules.conditions) {
      return error(res, 'Rules are required for preview', 400);
    }

    const { audienceCount } = await resolveSegment(rules, req.workspaceId);
    return success(res, { audienceCount }, 'Segment preview retrieved successfully');
  } catch (err) {
    next(err);
  }
};
