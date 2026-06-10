const Customer = require('../models/Customer');
const Order = require('../models/Order');
const { success, error } = require('../utils/responseHelper');
const { parseCustomersCSV } = require('../services/csvImport.service');
const { clearUserCache } = require('./agent.controller');

// @desc    Get all customers with pagination, search, filters & sorting
// @route   GET /api/customers
// @access  Private
exports.getCustomers = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const skip = (page - 1) * limit;

    // Search query (name, email, phone) scoped to user/role
    let query = req.user.role === 'admin' ? {} : { userId: req.user._id };
    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search, 'i');
      query.$or = [
        { name: searchRegex },
        { email: searchRegex },
        { phone: searchRegex }
      ];
    }

    // Filters
    if (req.query.city) {
      // support comma separated list or single string
      const cities = req.query.city.split(',').map(c => c.trim());
      query.city = { $in: cities.map(c => new RegExp(`^${c}$`, 'i')) };
    }
    
    if (req.query.gender) {
      const genders = req.query.gender.split(',').map(g => g.trim().toLowerCase());
      query.gender = { $in: genders };
    }

    if (req.query.tags) {
      const tags = req.query.tags.split(',').map(t => t.trim());
      query.tags = { $all: tags };
    }

    if (req.query.minSpend !== undefined && req.query.minSpend !== '') {
      query.totalSpend = { ...query.totalSpend, $gte: parseFloat(req.query.minSpend) };
    }
    
    if (req.query.maxSpend !== undefined && req.query.maxSpend !== '') {
      query.totalSpend = { ...query.totalSpend, $lte: parseFloat(req.query.maxSpend) };
    }

    if (req.query.minOrders !== undefined && req.query.minOrders !== '') {
      query.orderCount = { ...query.orderCount, $gte: parseInt(req.query.minOrders) };
    }

    if (req.query.daysSinceLast !== undefined && req.query.daysSinceLast !== '') {
      const days = parseInt(req.query.daysSinceLast);
      const cutOffDate = new Date();
      cutOffDate.setDate(cutOffDate.getDate() - days);
      // daysSinceLastOrder >= days means lastOrderDate <= cutOffDate
      query.lastOrderDate = { $lte: cutOffDate };
    }

    // Sort setup
    let sort = {};
    const sortBy = req.query.sortBy || 'createdAt';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    sort[sortBy] = sortOrder;

    const customers = await Customer.find(query)
      .sort(sort)
      .skip(skip)
      .limit(limit);

    const total = await Customer.countDocuments(query);
    const totalPages = Math.ceil(total / limit);

    return success(res, {
      customers,
      total,
      page,
      totalPages
    }, 'Customers fetched successfully');
  } catch (err) {
    next(err);
  }
};

// @desc    Get single customer profile with order history
// @route   GET /api/customers/:id
// @access  Private
exports.getCustomer = async (req, res, next) => {
  try {
    const query = req.user.role === 'admin' ? { _id: req.params.id } : { _id: req.params.id, userId: req.user._id };
    const customer = await Customer.findOne(query);
    if (!customer) {
      return error(res, 'Customer not found', 404);
    }

    // Fetch last 10 orders
    const orderQuery = req.user.role === 'admin' ? { customerId: customer._id } : { customerId: customer._id, userId: req.user._id };
    const orders = await Order.find(orderQuery)
      .sort({ orderedAt: -1 })
      .limit(10);

    return success(res, { customer, orders }, 'Customer profile fetched successfully');
  } catch (err) {
    next(err);
  }
};

// @desc    Create a customer
// @route   POST /api/customers
// @access  Private
exports.createCustomer = async (req, res, next) => {
  try {
    const { name, email, phone, gender, city, tags } = req.body;

    if (!name) {
      return error(res, 'Name is required', 400);
    }

    // Check email uniqueness if provided
    if (email) {
      const existingCustomer = await Customer.findOne({ email: email.toLowerCase() });
      if (existingCustomer) {
        return error(res, 'A customer with this email already exists', 400);
      }
    }

    const customer = new Customer({
      userId: req.user._id,
      name,
      email: email ? email.toLowerCase() : undefined,
      phone,
      gender: gender || 'unknown',
      city,
      tags: tags || [],
      source: 'manual'
    });

    await customer.save();
    clearUserCache(req.user._id);
    return success(res, customer, 'Customer created successfully', 201);
  } catch (err) {
    next(err);
  }
};

// @desc    Update customer profile
// @route   PUT /api/customers/:id
// @access  Private
exports.updateCustomer = async (req, res, next) => {
  try {
    const { name, email, phone, gender, city, tags } = req.body;

    const query = req.user.role === 'admin' ? { _id: req.params.id } : { _id: req.params.id, userId: req.user._id };
    let customer = await Customer.findOne(query);
    if (!customer) {
      return error(res, 'Customer not found', 404);
    }

    // Validate email uniqueness if changing email
    if (email && email.toLowerCase() !== customer.email) {
      const existingCustomer = await Customer.findOne({ email: email.toLowerCase() });
      if (existingCustomer) {
        return error(res, 'A customer with this email already exists', 400);
      }
      customer.email = email.toLowerCase();
    }

    if (name) customer.name = name;
    if (phone !== undefined) customer.phone = phone;
    if (gender) customer.gender = gender;
    if (city !== undefined) customer.city = city;
    if (tags) customer.tags = tags;

    await customer.save();
    clearUserCache(req.user._id);
    return success(res, customer, 'Customer updated successfully');
  } catch (err) {
    next(err);
  }
};

// @desc    Delete a customer
// @route   DELETE /api/customers/:id
// @access  Private
exports.deleteCustomer = async (req, res, next) => {
  try {
    const query = req.user.role === 'admin' ? { _id: req.params.id } : { _id: req.params.id, userId: req.user._id };
    const customer = await Customer.findOne(query);
    if (!customer) {
      return error(res, 'Customer not found', 404);
    }

    // Cascade delete customer orders
    const orderQuery = req.user.role === 'admin' ? { customerId: customer._id } : { customerId: customer._id, userId: req.user._id };
    await Order.deleteMany(orderQuery);
    await customer.deleteOne();
    clearUserCache(req.user._id);
    return success(res, null, 'Customer and all associated orders deleted successfully');
  } catch (err) {
    next(err);
  }
};

// @desc    Bulk import customers from CSV file
// @route   POST /api/customers/import
// @access  Private
exports.importCSV = async (req, res, next) => {
  try {
    if (!req.file) {
      return error(res, 'Please upload a CSV file', 400);
    }

    const customersData = await parseCustomersCSV(req.file.buffer);
    if (customersData.length === 0) {
      return error(res, 'No valid customers found in CSV file', 400);
    }

    const prependedData = customersData.map(c => ({ ...c, userId: req.user._id }));

    let imported = 0;
    let skipped = 0;
    const errors = [];

    // Let's run a bulk insert or loops. Bulk insertMany with ordered: false lets us insert
    // duplicates and throw them into errors.
    try {
      const result = await Customer.insertMany(prependedData, { ordered: false });
      imported = result.length;
    } catch (bulkErr) {
      // insertMany ordered: false will return the successfully inserted docs in bulkErr.insertedDocs
      imported = bulkErr.insertedDocs ? bulkErr.insertedDocs.length : 0;
      
      // Parse write errors
      if (bulkErr.writeErrors) {
        skipped = bulkErr.writeErrors.length;
        bulkErr.writeErrors.forEach(err => {
          errors.push({
            row: err.index + 1,
            email: prependedData[err.index].email,
            reason: err.code === 11000 ? 'Email address already exists' : err.errmsg
          });
        });
      } else {
        errors.push({ reason: bulkErr.message });
      }
    }

    // Clear the cache since new data has been imported
    clearUserCache(req.user._id);

    return success(res, {
      imported,
      skipped,
      errors
    }, `Bulk import finished: ${imported} customers imported, ${skipped} skipped.`);
  } catch (err) {
    next(err);
  }
};

// @desc    Get unique tags, cities, and custom field keys for metadata
// @route   GET /api/customers/metadata
// @access  Private
exports.getMetadata = async (req, res, next) => {
  try {
    const query = req.user.role === 'admin' ? {} : { userId: req.user._id };
    
    // Unique tags
    const allTags = await Customer.distinct('tags', query);
    
    // Unique cities
    const allCities = await Customer.distinct('city', query);
    
    // Unique custom field keys from sample
    const sampleCustomers = await Customer.find({ ...query, customFields: { $exists: true } }).limit(100).select('customFields');
    const customFieldKeys = Array.from(new Set(sampleCustomers.flatMap(c => c.customFields ? Object.keys(c.customFields) : [])));

    return res.status(200).json({
      success: true,
      data: {
        tags: allTags.filter(Boolean),
        cities: allCities.filter(Boolean),
        customFieldKeys
      }
    });
  } catch (err) {
    next(err);
  }
};
