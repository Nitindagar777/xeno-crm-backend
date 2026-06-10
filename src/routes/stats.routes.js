const express = require('express');
const statsController = require('../controllers/stats.controller');
const authMiddleware = require('../middleware/auth.middleware');

const router = express.Router();

router.get('/overview', authMiddleware, statsController.getOverview);

module.exports = router;
