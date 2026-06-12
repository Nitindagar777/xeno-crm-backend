const express = require('express');
const statsController = require('../controllers/stats.controller');
const authMiddleware = require('../middleware/auth.middleware');
const workspaceMiddleware = require('../middleware/workspace.middleware');

const router = express.Router();

router.use(authMiddleware);
router.use(workspaceMiddleware);

router.get('/overview', statsController.getOverview);

module.exports = router;
