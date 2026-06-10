const Customer = require('../models/Customer');

/**
 * Converts a segment rule condition to a MongoDB query selector
 * @param {Object} condition Rule condition { field, operator, value }
 * @returns {Object} MongoDB query selector
 */
const buildConditionQuery = (condition) => {
  const { field, operator, value } = condition;
  const query = {};

  // Special handling for daysSinceLastOrder or lastOrderDate converted to days ago
  if (field === 'daysSinceLastOrder' || field === 'lastOrderDate') {
    // If the rule specifies daysSinceLastOrder, it means "X days ago"
    // e.g. daysSinceLastOrder >= 30 means lastOrderDate <= (today - 30 days)
    const days = parseInt(value, 10);
    const dateLimit = new Date();
    dateLimit.setDate(dateLimit.getDate() - days);

    // Set time to start/end of day for accuracy
    if (operator === 'gte' || operator === 'gt') {
      // More than X days ago means they ordered BEFORE or ON the dateLimit
      return { lastOrderDate: { [operator === 'gte' ? '$lte' : '$lt']: dateLimit } };
    } else if (operator === 'lte' || operator === 'lt') {
      // Less than X days ago means they ordered AFTER or ON the dateLimit
      return { lastOrderDate: { [operator === 'lte' ? '$gte' : '$gt']: dateLimit } };
    } else if (operator === 'eq') {
      // Equal to X days ago (roughly on that day)
      const startOfDay = new Date(dateLimit.setHours(0, 0, 0, 0));
      const endOfDay = new Date(dateLimit.setHours(23, 59, 59, 999));
      return { lastOrderDate: { $gte: startOfDay, $lte: endOfDay } };
    } else if (operator === 'neq') {
      const startOfDay = new Date(dateLimit.setHours(0, 0, 0, 0));
      const endOfDay = new Date(dateLimit.setHours(23, 59, 59, 999));
      return { $or: [{ lastOrderDate: { $lt: startOfDay } }, { lastOrderDate: { $gt: endOfDay } }] };
    }
  }

  // General field mapping
  let dbField = field;

  // Map operator to MongoDB operators
  switch (operator) {
    case 'gt':
      query[dbField] = { $gt: value };
      break;
    case 'lt':
      query[dbField] = { $lt: value };
      break;
    case 'gte':
      query[dbField] = { $gte: value };
      break;
    case 'lte':
      query[dbField] = { $lte: value };
      break;
    case 'eq':
      query[dbField] = value;
      break;
    case 'neq':
      query[dbField] = { $ne: value };
      break;
    case 'in':
      // Ensure value is an array, handle single value wrapped
      const inVal = Array.isArray(value) ? value : [value];
      // Perform case-insensitive matching if values are strings
      if (inVal.length > 0 && typeof inVal[0] === 'string') {
        query[dbField] = { $in: inVal.map(val => new RegExp(`^${val}$`, 'i')) };
      } else {
        query[dbField] = { $in: inVal };
      }
      break;
    case 'nin':
      const ninVal = Array.isArray(value) ? value : [value];
      if (ninVal.length > 0 && typeof ninVal[0] === 'string') {
        query[dbField] = { $nin: ninVal.map(val => new RegExp(`^${val}$`, 'i')) };
      } else {
        query[dbField] = { $nin: ninVal };
      }
      break;
    case 'contains':
      // Used for tags array
      if (Array.isArray(value)) {
        query[dbField] = { $all: value };
      } else {
        query[dbField] = value; // simple containment in array
      }
      break;
    default:
      query[dbField] = value;
  }

  return query;
};

/**
 * Resolves a segment rule set into Customer IDs and audience count.
 * @param {Object} rules Rule set { conditions: Array, logic: 'AND'|'OR' }
 * @param {string|mongoose.Types.ObjectId} userId User ID for scoping
 * @returns {Promise<Object>} { audienceIds, audienceCount }
 */
const resolveSegment = async (rules, userId) => {
  if (!rules || !rules.conditions || rules.conditions.length === 0) {
    return { audienceIds: [], audienceCount: 0 };
  }

  const { conditions, logic = 'AND' } = rules;
  const conditionQueries = conditions.map(buildConditionQuery);

  let finalQuery = {};
  if (userId) {
    if (logic === 'OR') {
      finalQuery = { userId, $or: conditionQueries };
    } else {
      // Default to AND
      finalQuery = { userId, $and: conditionQueries };
    }
  } else {
    if (logic === 'OR') {
      finalQuery = { $or: conditionQueries };
    } else {
      finalQuery = { $and: conditionQueries };
    }
  }

  try {
    const customers = await Customer.find(finalQuery).select('_id');
    const audienceIds = customers.map(c => c._id);
    return {
      audienceIds,
      audienceCount: audienceIds.length
    };
  } catch (err) {
    console.error('[Segment Engine Error]:', err);
    throw new Error('Failed to resolve segment rules: ' + err.message);
  }
};

module.exports = { resolveSegment };
