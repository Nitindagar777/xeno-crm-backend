const mongoose = require('mongoose');
const Workspace = require('../models/Workspace');

module.exports = async (req, res, next) => {
  try {
    let workspaceId = req.header('x-workspace-id');

    // If workspace ID is provided, verify it exists and belongs to the logged in user
    if (workspaceId && workspaceId !== 'null' && workspaceId !== 'undefined') {
      if (mongoose.Types.ObjectId.isValid(workspaceId)) {
        const exists = await Workspace.findOne({ _id: workspaceId, userId: req.user._id });
        if (!exists) {
          workspaceId = null;
        }
      } else {
        workspaceId = null;
      }
    }

    // If no workspace ID is provided in header, try to find a default workspace for the user
    if (!workspaceId || workspaceId === 'null' || workspaceId === 'undefined') {
      let workspace = await Workspace.findOne({ userId: req.user._id });
      if (!workspace) {
        // Auto-create a default workspace for the user
        workspace = new Workspace({
          name: 'Default Workspace',
          description: 'Your primary workspace',
          userId: req.user._id
        });
        await workspace.save();
      }
      workspaceId = workspace._id;
    }

    req.workspaceId = workspaceId;
    next();
  } catch (err) {
    console.error('[Workspace Middleware Error]:', err.message);
    next(err);
  }
};
