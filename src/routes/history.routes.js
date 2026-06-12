const express = require('express');
const { getMessageHistory } = require('../controllers/history.controller');
const authMiddleware = require('../middleware/auth.middleware');
const workspaceMiddleware = require('../middleware/workspace.middleware');

const router = express.Router();

// Protect all history routes
router.use(authMiddleware);
router.use(workspaceMiddleware);

router.get('/messages', getMessageHistory);

module.exports = router;
