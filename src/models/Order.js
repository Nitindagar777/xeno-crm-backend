const mongoose = require('mongoose');

const OrderSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  workspaceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workspace',
    required: true,
    index: true
  },
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: [true, 'Customer ID is required'],
    index: true
  },
  orderId: {
    type: String,
    unique: true,
    sparse: true
  },
  amount: {
    type: Number,
    required: [true, 'Order amount is required']
  },
  items: [{
    name: { type: String, required: true },
    quantity: { type: Number, required: true, default: 1 },
    price: { type: Number, required: true }
  }],
  channel: {
    type: String,
    enum: ['online', 'offline', 'app'],
    default: 'online'
  },
  status: {
    type: String,
    enum: ['completed', 'returned', 'cancelled'],
    default: 'completed'
  },
  orderedAt: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Order', OrderSchema);
