const express = require('express');
const { getActivities, getSummary, getWorkspaces, createWorkspace } = require('../controllers/workspace.controller');
const authMiddleware = require('../middleware/auth.middleware');
const workspaceMiddleware = require('../middleware/workspace.middleware');

const router = express.Router();

// Protect all workspace routes with auth
router.use(authMiddleware);

// List workspaces and create a workspace
router.get('/list', getWorkspaces);
router.post('/', createWorkspace);

// Other summary/timeline queries require active workspace context
router.use(workspaceMiddleware);

router.get('/', getActivities);
router.get('/summary', getSummary);

module.exports = router;
