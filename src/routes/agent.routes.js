const express = require('express');
const agentController = require('../controllers/agent.controller');
const authMiddleware = require('../middleware/auth.middleware');

const router = express.Router();

router.use(authMiddleware);

router.post('/message', agentController.sendMessage);
router.post('/approve', agentController.approveStep);
router.get('/suggestions', agentController.getSuggestions);
router.get('/insights', agentController.getInsights);

module.exports = router;
