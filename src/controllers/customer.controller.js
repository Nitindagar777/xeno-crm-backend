const Customer = require('../models/Customer');
const Order = require('../models/Order');
const { success, error } = require('../utils/responseHelper');
const { parseCustomersCSV } = require('../services/csvImport.service');
const { clearUserCache } = require('./agent.controller');
const { logActivity } = require('../services/activity.service');

const normalizeHeader = (header) => {
  const h = header.toLowerCase().trim();
  if (h === 'name') return 'name';
  if (h === 'email') return 'email';
  if (h === 'phone') return 'phone';
  if (h === 'city') return 'city';
  if (h === 'gender') return 'gender';
  if (h === 'tags') return 'tags';
  if (['total spend', 'totalspend', 'spend'].includes(h)) return 'totalSpend';
  if (['orders', 'ordercount', 'order count'].includes(h)) return 'orderCount';
  if (['last active', 'lastactive', 'last order date', 'lastorderdate'].includes(h)) return 'lastOrderDate';
  return header.trim(); // keep case for custom columns
};

// @desc    Get all customers with pagination, search, filters & sorting
// @route   GET /api/customers
// @access  Private
exports.getCustomers = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const skip = (page - 1) * limit;

    // Search query (name, email, phone) scoped to active workspace
    let query = { workspaceId: req.workspaceId };
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
      query.orderCount = { ...query.orderCount, $gte: parseInt(req.query.minOrders, 10) };
    }

    if (req.query.daysSinceLast !== undefined && req.query.daysSinceLast !== '') {
      const days = parseInt(req.query.daysSinceLast, 10);
      const cutOffDate = new Date();
      cutOffDate.setDate(cutOffDate.getDate() - days);
      query.lastOrderDate = { $lte: cutOffDate };
    }

    // Fetch workspace uploaded fields to dynamically map query params
    const Workspace = require('../models/Workspace');
    const workspace = await Workspace.findById(req.workspaceId);
    const uploadedFields = workspace?.uploadedFields || [];
    const standardSchemaFields = ['name', 'email', 'phone', 'city', 'gender', 'tags', 'totalSpend', 'orderCount', 'lastOrderDate', 'avgOrderValue'];
    const customFieldKeys = uploadedFields.filter(f => !standardSchemaFields.includes(f));

    customFieldKeys.forEach(key => {
      if (req.query[key] !== undefined && req.query[key] !== '') {
        const val = req.query[key];
        if (!isNaN(val) && val.trim() !== '') {
          const numVal = parseFloat(val);
          query[`customFields.${key}`] = {
            $in: [numVal, new RegExp(val, 'i')]
          };
        } else {
          query[`customFields.${key}`] = new RegExp(val, 'i');
        }
      }
    });

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
    const query = { _id: req.params.id, workspaceId: req.workspaceId };
    const customer = await Customer.findOne(query);
    if (!customer) {
      return error(res, 'Customer not found', 404);
    }

    // Fetch last 10 orders
    const orderQuery = { customerId: customer._id, workspaceId: req.workspaceId };
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

    // Check email uniqueness within the workspace if provided
    if (email) {
      const existingCustomer = await Customer.findOne({ email: email.toLowerCase(), workspaceId: req.workspaceId });
      if (existingCustomer) {
        return error(res, 'A customer with this email already exists in this workspace', 400);
      }
    }

    const customer = new Customer({
      userId: req.user._id,
      workspaceId: req.workspaceId,
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

    logActivity({
      userId: req.user._id,
      workspaceId: req.workspaceId,
      type: 'customer_created',
      title: `Added customer: ${customer.name}`,
      resourceType: 'customer',
      resourceId: customer._id
    });

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

    const query = { _id: req.params.id, workspaceId: req.workspaceId };
    let customer = await Customer.findOne(query);
    if (!customer) {
      return error(res, 'Customer not found', 404);
    }

    // Validate email uniqueness within workspace if changing email
    if (email && email.toLowerCase() !== customer.email) {
      const existingCustomer = await Customer.findOne({ email: email.toLowerCase(), workspaceId: req.workspaceId });
      if (existingCustomer) {
        return error(res, 'A customer with this email already exists in this workspace', 400);
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
    const query = { _id: req.params.id, workspaceId: req.workspaceId };
    const customer = await Customer.findOne(query);
    if (!customer) {
      return error(res, 'Customer not found', 404);
    }

    // Cascade delete customer orders
    const orderQuery = { customerId: customer._id, workspaceId: req.workspaceId };
    await Order.deleteMany(orderQuery);
    await customer.deleteOne();
    clearUserCache(req.user._id);
    return success(res, null, 'Customer and all associated orders deleted successfully');
  } catch (err) {
    next(err);
  }
};

// @desc    Bulk import customers from CSV/Excel/JSON file
// @route   POST /api/customers/import
// @access  Private
exports.importCSV = async (req, res, next) => {
  try {
    if (!req.file) {
      return error(res, 'Please upload a file', 400);
    }

    const mapping = req.body.mapping ? JSON.parse(req.body.mapping) : null;
    const { cleanedCustomers, headers, mapping: resolvedMapping } = await parseCustomersCSV(req.file.buffer, req.file.originalname, mapping);
    if (cleanedCustomers.length === 0) {
      return error(res, 'No valid customers found in file', 400);
    }

    const prependedData = cleanedCustomers.map(c => ({
      ...c,
      userId: req.user._id,
      workspaceId: req.workspaceId
    }));

    let imported = 0;
    let skipped = 0;
    const errors = [];

    try {
      const result = await Customer.insertMany(prependedData, { ordered: false });
      imported = result.length;
    } catch (bulkErr) {
      imported = bulkErr.insertedDocs ? bulkErr.insertedDocs.length : 0;
      
      if (bulkErr.writeErrors) {
        skipped = bulkErr.writeErrors.length;
        bulkErr.writeErrors.forEach(err => {
          errors.push({
            row: err.index + 1,
            email: prependedData[err.index].email,
            reason: err.code === 11000 ? 'Email address already exists in workspace' : err.errmsg
          });
        });
      } else if (bulkErr.errors) {
        skipped = prependedData.length - imported;
        Object.keys(bulkErr.errors).forEach((key, idx) => {
          errors.push({
            row: idx + 1,
            reason: bulkErr.errors[key].message
          });
        });
      } else {
        skipped = prependedData.length - imported;
        errors.push({ reason: bulkErr.message });
      }
    }

    const activeFields = headers.map(header => {
      const target = resolvedMapping ? resolvedMapping[header] : null;
      if (target && target !== 'custom') {
        return target;
      }
      return header.trim();
    });

    // Save/update uploaded fields list on Workspace
    const Workspace = require('../models/Workspace');
    const uploadedFields = Array.from(new Set(activeFields.map(normalizeHeader)));
    await Workspace.findByIdAndUpdate(req.workspaceId, {
      $addToSet: { uploadedFields: { $each: uploadedFields } }
    });

    clearUserCache(req.user._id);

    const fileExt = req.file.originalname.split('.').pop().toUpperCase();
    logActivity({
      userId: req.user._id,
      workspaceId: req.workspaceId,
      type: 'customers_imported',
      title: `Imported ${imported} customers via ${fileExt}`,
      description: `${skipped} records failed or skipped`,
      resourceType: 'customer',
      meta: { successCount: imported, failedCount: skipped }
    });

    return success(res, {
      imported,
      skipped,
      errors
    }, `Bulk import finished: ${imported} customers imported, ${skipped} skipped.`);
  } catch (err) {
    next(err);
  }
};

// @desc    Parse uploaded file and return a preview
// @route   POST /api/customers/import-preview
// @access  Private
exports.importPreview = async (req, res, next) => {
  try {
    if (!req.file) {
      return error(res, 'Please upload a file', 400);
    }

    const { cleanedCustomers, headers, mapping } = await parseCustomersCSV(req.file.buffer, req.file.originalname);
    if (cleanedCustomers.length === 0) {
      return error(res, 'No valid customers found in file', 400);
    }

    const preview = cleanedCustomers.slice(0, 2);

    return success(res, {
      preview,
      headers,
      mapping
    }, 'File parsed successfully for preview');
  } catch (err) {
    next(err);
  }
};

// @desc    Get unique tags, cities, and custom field keys for metadata
// @route   GET /api/customers/metadata
// @access  Private
exports.getMetadata = async (req, res, next) => {
  try {
    const query = { workspaceId: req.workspaceId };
    
    // Unique tags
    const allTags = await Customer.distinct('tags', query);
    
    // Unique cities
    const allCities = await Customer.distinct('city', query);
    
    const Workspace = require('../models/Workspace');
    const workspace = await Workspace.findById(req.workspaceId);
    
    const uploadedFields = workspace?.uploadedFields && workspace.uploadedFields.length > 0
      ? workspace.uploadedFields
      : []; // No fallback for empty workspace

    const standardSchemaFields = ['name', 'email', 'phone', 'city', 'gender', 'tags', 'totalSpend', 'orderCount', 'lastOrderDate', 'avgOrderValue'];
    const customFieldKeys = uploadedFields.filter(f => !standardSchemaFields.includes(f));

    return res.status(200).json({
      success: true,
      data: {
        tags: allTags.filter(Boolean),
        cities: allCities.filter(Boolean),
        uploadedFields,
        customFieldKeys
      }
    });
  } catch (err) {
    next(err);
  }
};
