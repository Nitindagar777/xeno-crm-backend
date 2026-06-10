const express = require('express');
const segmentController = require('../controllers/segment.controller');
const authMiddleware = require('../middleware/auth.middleware');

const router = express.Router();

router.use(authMiddleware);

router.get('/', segmentController.getSegments);
router.post('/', segmentController.createSegment);
router.post('/preview', segmentController.previewSegment);
router.get('/:id', segmentController.getSegment);
router.put('/:id', segmentController.updateSegment);
router.delete('/:id', segmentController.deleteSegment);
router.post('/:id/refresh', segmentController.refreshSegment);

module.exports = router;
