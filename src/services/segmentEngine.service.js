const Customer = require('../models/Customer');

/**
 * Normalizes input field names into standard database schema keys
 */
const normalizeSegmentField = (field) => {
  if (!field) return '';
  const f = field.toLowerCase().trim();
  
  if (['ordercount', 'orders', 'order count', 'total orders', 'totalorders', 'order_count'].includes(f)) {
    return 'orderCount';
  }
  if (['totalspend', 'total spend', 'spend', 'amount', 'total_spend', 'price', 'revenue', 'spend amount', 'total spend (₹)', 'total spend (rs)'].includes(f)) {
    return 'totalSpend';
  }
  if (['avgordervalue', 'avg order value', 'average order value', 'averageordervalue', 'aov'].includes(f)) {
    return 'avgOrderValue';
  }
  if (['dayssincelastorder', 'days since last order', 'days since last', 'dayssincelast', 'dayssincelastpurchase', 'days since purchase'].includes(f)) {
    return 'daysSinceLastOrder';
  }
  if (['dayssinceregistration', 'days since registration', 'days since signup', 'days since join', 'dayssinceregn', 'dayssinceregt'].includes(f)) {
    return 'daysSinceRegistration';
  }
  if (['city', 'location', 'town', 'address'].includes(f)) {
    return 'city';
  }
  if (['gender', 'sex'].includes(f)) {
    return 'gender';
  }
  if (['tags', 'tag'].includes(f)) {
    return 'tags';
  }
  if (['name', 'fullname', 'full name', 'customer name'].includes(f)) {
    return 'name';
  }
  if (['email', 'email address', 'mail'].includes(f)) {
    return 'email';
  }
  if (['phone', 'phone number', 'phonenumber', 'mobile', 'mobile number'].includes(f)) {
    return 'phone';
  }
  if (['createdat', 'created at', 'registration date', 'registrationdate'].includes(f)) {
    return 'createdAt';
  }
  
  return field; // return raw if custom column
};

/**
 * Converts a segment rule condition to a MongoDB query selector
 * @param {Object} condition Rule condition { field, operator, value }
 * @returns {Object} MongoDB query selector
 */
const buildConditionQuery = (condition) => {
  const { field, operator, value } = condition;
  const normalizedField = normalizeSegmentField(field);
  const query = {};

  // Special handling for daysSinceLastOrder or lastOrderDate converted to days ago
  if (normalizedField === 'daysSinceLastOrder' || normalizedField === 'lastOrderDate') {
    const days = parseInt(value, 10);
    const dateLimit = new Date();
    dateLimit.setDate(dateLimit.getDate() - days);

    if (operator === 'gte' || operator === 'gt') {
      return { lastOrderDate: { [operator === 'gte' ? '$lte' : '$lt']: dateLimit } };
    } else if (operator === 'lte' || operator === 'lt') {
      return { lastOrderDate: { [operator === 'lte' ? '$gte' : '$gt']: dateLimit } };
    } else if (operator === 'eq') {
      const startOfDay = new Date(dateLimit.setHours(0, 0, 0, 0));
      const endOfDay = new Date(dateLimit.setHours(23, 59, 59, 999));
      return { lastOrderDate: { $gte: startOfDay, $lte: endOfDay } };
    } else if (operator === 'neq') {
      const startOfDay = new Date(dateLimit.setHours(0, 0, 0, 0));
      const endOfDay = new Date(dateLimit.setHours(23, 59, 59, 999));
      return { $or: [{ lastOrderDate: { $lt: startOfDay } }, { lastOrderDate: { $gt: endOfDay } }] };
    }
  }

  // Special handling for daysSinceRegistration or registration date
  if (normalizedField === 'daysSinceRegistration') {
    const days = parseInt(value, 10);
    const dateLimit = new Date();
    dateLimit.setDate(dateLimit.getDate() - days);

    if (operator === 'gte' || operator === 'gt') {
      return { createdAt: { [operator === 'gte' ? '$lte' : '$lt']: dateLimit } };
    } else if (operator === 'lte' || operator === 'lt') {
      return { createdAt: { [operator === 'lte' ? '$gte' : '$gt']: dateLimit } };
    } else if (operator === 'eq') {
      const startOfDay = new Date(dateLimit.setHours(0, 0, 0, 0));
      const endOfDay = new Date(dateLimit.setHours(23, 59, 59, 999));
      return { createdAt: { $gte: startOfDay, $lte: endOfDay } };
    } else if (operator === 'neq') {
      const startOfDay = new Date(dateLimit.setHours(0, 0, 0, 0));
      const endOfDay = new Date(dateLimit.setHours(23, 59, 59, 999));
      return { $or: [{ createdAt: { $lt: startOfDay } }, { createdAt: { $gt: endOfDay } }] };
    }
  }

  if (normalizedField === 'createdAt') {
    let dateVal;
    if (!isNaN(value)) {
      const days = parseInt(value, 10);
      dateVal = new Date();
      dateVal.setDate(dateVal.getDate() - days);
    } else {
      dateVal = new Date(value);
    }
    
    if (operator === 'gte' || operator === 'gt') {
      return { createdAt: { [operator === 'gte' ? '$gte' : '$gt']: dateVal } };
    } else if (operator === 'lte' || operator === 'lt') {
      return { createdAt: { [operator === 'lte' ? '$lte' : '$lt']: dateVal } };
    } else if (operator === 'eq') {
      const startOfDay = new Date(dateVal.setHours(0, 0, 0, 0));
      const endOfDay = new Date(dateVal.setHours(23, 59, 59, 999));
      return { createdAt: { $gte: startOfDay, $lte: endOfDay } };
    } else if (operator === 'neq') {
      const startOfDay = new Date(dateVal.setHours(0, 0, 0, 0));
      const endOfDay = new Date(dateVal.setHours(23, 59, 59, 999));
      return { $or: [{ createdAt: { $lt: startOfDay } }, { createdAt: { $gt: endOfDay } }] };
    }
  }

  // General field mapping
  let dbField = normalizedField;
  const standardFields = ['totalSpend', 'orderCount', 'avgOrderValue', 'daysSinceLastOrder', 'lastOrderDate', 'daysSinceRegistration', 'createdAt', 'city', 'gender', 'tags', 'name', 'email', 'phone'];
  if (!standardFields.includes(normalizedField)) {
    dbField = `customFields.${field}`;
  }

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
      if (typeof value === 'string') {
        query[dbField] = new RegExp(`^${value}$`, 'i');
      } else {
        query[dbField] = value;
      }
      break;
    case 'neq':
      if (typeof value === 'string') {
        query[dbField] = { $not: new RegExp(`^${value}$`, 'i') };
      } else {
        query[dbField] = { $ne: value };
      }
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
const resolveSegment = async (rules, workspaceId) => {
  if (!rules || !rules.conditions || rules.conditions.length === 0) {
    return { audienceIds: [], audienceCount: 0 };
  }

  const { conditions, logic = 'AND' } = rules;
  const conditionQueries = conditions.map(buildConditionQuery);

  let finalQuery = {};
  if (workspaceId) {
    if (logic === 'OR') {
      finalQuery = { workspaceId, $or: conditionQueries };
    } else {
      // Default to AND
      finalQuery = { workspaceId, $and: conditionQueries };
    }
  } else {
    if (logic === 'OR') {
      finalQuery = { $or: conditionQueries };
    } else {
      finalQuery = { $and: conditionQueries };
    }
  }

  try {
    let queryBuilder = Customer.find(finalQuery).select('_id');
    if (rules && rules.limit && typeof rules.limit === 'number' && rules.limit > 0) {
      queryBuilder = queryBuilder.limit(rules.limit);
    }
    const customers = await queryBuilder;
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
