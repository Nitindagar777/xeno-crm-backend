const Activity = require('../models/Activity');

/**
 * Log a user activity asynchronously (fire-and-forget)
 * @param {Object} params - The activity details
 */
async function logActivity({ userId, workspaceId, type, title, description, resourceType, resourceId, meta }) {
  try {
    const activity = new Activity({
      userId,
      workspaceId,
      type,
      title,
      description,
      resourceType,
      resourceId,
      meta
    });
    await activity.save();
  } catch (err) {
    // Silent fail in production/normal execution to not block main user flow, but log error
    console.error('[logActivity Error]:', err.message);
  }
}

module.exports = { logActivity };
