const express = require('express');
const orderController = require('../controllers/order.controller');
const authMiddleware = require('../middleware/auth.middleware');

const router = express.Router();

router.use(authMiddleware);

router.get('/', orderController.getOrders);
router.post('/', orderController.createOrder);
router.get('/:id', orderController.getOrder);
router.get('/customer/:customerId', orderController.getCustomerOrders);

module.exports = router;
