const express = require('express');
const campaignController = require('../controllers/campaign.controller');
const authMiddleware = require('../middleware/auth.middleware');
const workspaceMiddleware = require('../middleware/workspace.middleware');

const router = express.Router();

// Webhook endpoint called by channel-service (Must be public, validated internally by secret)
router.post('/receipt', campaignController.receiveReceipt);

// JWT Protect all other routes
router.use(authMiddleware);
router.use(workspaceMiddleware);

router.get('/', campaignController.getCampaigns);
router.post('/', campaignController.createCampaign);
router.get('/:id', campaignController.getCampaign);
router.put('/:id', campaignController.updateCampaign);
router.delete('/:id', campaignController.deleteCampaign);
router.post('/:id/send', campaignController.sendCampaign);
router.get('/:id/stats', campaignController.getCampaignStats);
router.get('/:id/logs', campaignController.getCampaignLogs);
router.get('/:id/analysis', campaignController.getCampaignAnalysis);
router.post('/logs/:logId/convert', campaignController.markLogAsConverted);

module.exports = router;
