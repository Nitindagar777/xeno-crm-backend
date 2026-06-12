const Order = require('../models/Order');
const Customer = require('../models/Customer');
const CommunicationLog = require('../models/CommunicationLog');
const CampaignStats = require('../models/CampaignStats');
const { success, error } = require('../utils/responseHelper');
const { clearUserCache } = require('./agent.controller');

// Helper to recalculate customer metrics
const updateCustomerStats = async (customerId, workspaceId) => {
  const customer = await Customer.findOne({ _id: customerId, workspaceId });
  if (!customer) return;

  const orderQuery = { customerId, workspaceId, status: 'completed' };
  const completedOrders = await Order.find(orderQuery).sort({ orderedAt: 1 });

  if (completedOrders.length === 0) {
    customer.orderCount = 0;
    customer.totalSpend = 0;
    customer.avgOrderValue = 0;
    customer.firstOrderDate = undefined;
    customer.lastOrderDate = undefined;
  } else {
    customer.orderCount = completedOrders.length;
    customer.totalSpend = completedOrders.reduce((sum, order) => sum + order.amount, 0);
    customer.avgOrderValue = parseFloat((customer.totalSpend / customer.orderCount).toFixed(2));
    customer.firstOrderDate = completedOrders[0].orderedAt;
    customer.lastOrderDate = completedOrders[completedOrders.length - 1].orderedAt;
  }

  await customer.save();
};

// @desc    Get all orders
// @route   GET /api/orders
// @access  Private
exports.getOrders = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const skip = (page - 1) * limit;

    let query = { workspaceId: req.workspaceId };
    if (req.query.status) {
      query.status = req.query.status;
    }
    if (req.query.channel) {
      query.channel = req.query.channel;
    }

    const orders = await Order.find(query)
      .populate('customerId', 'name email')
      .sort({ orderedAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Order.countDocuments(query);
    const totalPages = Math.ceil(total / limit);

    return success(res, { orders, total, page, totalPages }, 'Orders fetched successfully');
  } catch (err) {
    next(err);
  }
};

// @desc    Get single order details
// @route   GET /api/orders/:id
// @access  Private
exports.getOrder = async (req, res, next) => {
  try {
    const query = { _id: req.params.id, workspaceId: req.workspaceId };
    const order = await Order.findOne(query).populate('customerId', 'name email phone city');
    if (!order) {
      return error(res, 'Order not found', 404);
    }
    return success(res, order, 'Order fetched successfully');
  } catch (err) {
    next(err);
  }
};

// @desc    Create a new order & update customer stats
// @route   POST /api/orders
// @access  Private
exports.createOrder = async (req, res, next) => {
  try {
    const { customerId, orderId, amount, items, channel, status, orderedAt } = req.body;

    if (!customerId || !amount) {
      return error(res, 'Customer ID and Order Amount are required', 400);
    }

    // Verify customer exists and belongs to active workspace
    const customer = await Customer.findOne({ _id: customerId, workspaceId: req.workspaceId });
    if (!customer) {
      return error(res, 'Customer not found', 404);
    }

    const order = new Order({
      userId: req.user._id,
      workspaceId: req.workspaceId,
      customerId,
      orderId,
      amount,
      items: items || [],
      channel: channel || 'online',
      status: status || 'completed',
      orderedAt: orderedAt || new Date()
    });

    await order.save();

    // Recalculate stats for the customer
    await updateCustomerStats(customerId, req.workspaceId);
    clearUserCache(req.user._id);

    // Conversion attribution: mark recent campaign communications as converted
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const recentLogs = await CommunicationLog.find({
        customerId,
        workspaceId: req.workspaceId,
        status: { $in: ['delivered', 'opened', 'read', 'clicked'] },
        createdAt: { $gte: sevenDaysAgo },
        converted: false
      });

      if (recentLogs.length > 0) {
        // Mark all matching logs as converted
        await CommunicationLog.updateMany(
          {
            _id: { $in: recentLogs.map(l => l._id) }
          },
          {
            $set: {
              converted: true,
              convertedAt: new Date(),
              conversionValue: order.amount
            }
          }
        );

        // Increment converted count for each unique campaign
        const uniqueCampaignIds = [...new Set(recentLogs.map(l => l.campaignId.toString()))];
        for (const campId of uniqueCampaignIds) {
          await CampaignStats.findOneAndUpdate(
            { campaignId: campId },
            { $inc: { converted: 1 } }
          );
        }
      }
    } catch (conversionErr) {
      console.error('[Conversion Attribution] Error:', conversionErr.message);
    }

    return success(res, order, 'Order created successfully and customer statistics updated', 201);
  } catch (err) {
    next(err);
  }
};

// @desc    Get all orders for a customer
// @route   GET /api/orders/customer/:customerId
// @access  Private
exports.getCustomerOrders = async (req, res, next) => {
  try {
    // Check if the customer belongs to the active workspace first
    const customer = await Customer.findOne({ _id: req.params.customerId, workspaceId: req.workspaceId });
    if (!customer) {
      return error(res, 'Customer not found', 404);
    }

    const orderQuery = { customerId: req.params.customerId, workspaceId: req.workspaceId };
    const orders = await Order.find(orderQuery).sort({ orderedAt: -1 });
    return success(res, orders, 'Customer orders fetched successfully');
  } catch (err) {
    next(err);
  }
};
