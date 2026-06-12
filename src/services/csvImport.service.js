const { parse } = require('csv-parse');
const XLSX = require('xlsx');

/**
 * Helper to parse a file buffer into raw records array based on extension.
 */
const getRecordsFromBuffer = (buffer, filename) => {
  return new Promise((resolve, reject) => {
    const ext = filename.split('.').pop().toLowerCase();
    if (ext === 'json') {
      try {
        const text = buffer.toString('utf8');
        const data = JSON.parse(text);
        if (!Array.isArray(data)) {
          return reject(new Error('JSON file must contain an array of customer records'));
        }
        resolve(data);
      } catch (err) {
        reject(new Error('Invalid JSON formatting: ' + err.message));
      }
    } else if (ext === 'xlsx' || ext === 'xls') {
      try {
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const records = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        resolve(records);
      } catch (err) {
        reject(new Error('Invalid Excel formatting: ' + err.message));
      }
    } else {
      // Default to CSV
      parse(
        buffer,
        {
          columns: true, // Treat first row as header
          skip_empty_lines: true,
          trim: true
        },
        (err, records) => {
          if (err) {
            return reject(new Error('Invalid CSV formatting: ' + err.message));
          }
          resolve(records);
        }
      );
    }
  });
};

/**
 * Auto-detects standard CRM fields from raw column headers using keyword heuristics.
 * @param {Object} firstRecord First record to scan headers from
 * @returns {Object} Detected mapping object
 */
const autoDetectMapping = (firstRecord) => {
  const mapping = {};
  Object.keys(firstRecord).forEach(rawKey => {
    if (!rawKey) return;
    const key = rawKey.toLowerCase().trim();
    if (['name', 'customer name', 'customername', 'full name', 'fullname', 'shopper name', 'shoppername', 'first name', 'firstname'].includes(key)) {
      mapping[rawKey] = 'name';
    } else if (['email', 'email address', 'emailaddress', 'mail'].includes(key)) {
      mapping[rawKey] = 'email';
    } else if (['phone', 'phone number', 'phonenumber', 'mobile', 'mobile number', 'mobilenumber', 'contact', 'contact number'].includes(key)) {
      mapping[rawKey] = 'phone';
    } else if (['city', 'location', 'town', 'address'].includes(key)) {
      mapping[rawKey] = 'city';
    } else if (['gender', 'sex'].includes(key)) {
      mapping[rawKey] = 'gender';
    } else if (['tags', 'tag', 'customer tags', 'customertags'].includes(key)) {
      mapping[rawKey] = 'tags';
    } else if (['total spend', 'totalspend', 'spend', 'amount', 'total_spend', 'totalspendamount', 'price', 'revenue'].includes(key)) {
      mapping[rawKey] = 'totalSpend';
    } else if (['orders', 'ordercount', 'order count', 'total orders', 'totalorders', 'order_count'].includes(key)) {
      mapping[rawKey] = 'orderCount';
    } else if (['last active', 'lastactive', 'last order date', 'lastorderdate', 'last_order_date', 'lastactiveactive'].includes(key)) {
      mapping[rawKey] = 'lastOrderDate';
    } else {
      mapping[rawKey] = 'custom';
    }
  });
  return mapping;
};

/**
 * Parses a buffer (CSV, Excel, or JSON) and extracts customer records using a column mapping.
 * @param {Buffer} buffer The file buffer
 * @param {string} filename The name of the file for extension checking
 * @param {Object} [mapping] Optional custom header-to-field mapping object
 * @returns {Promise<Object>} Parsed customers list, headers, and active mapping
 */
const parseCustomersCSV = async (buffer, filename = 'customers.csv', mapping = null) => {
  const records = await getRecordsFromBuffer(buffer, filename);
  const cleanedCustomers = [];

  const resolvedMapping = mapping || autoDetectMapping(records[0] || {});

  for (const row of records) {
    let name = '';
    let email = '';
    let phoneVal = '';
    let cityVal = '';
    let genderVal = 'unknown';
    let rawTags = '';
    let totalSpendVal = 0;
    let orderCountVal = 0;
    let lastActiveVal = null;
    const customFields = {};

    Object.keys(row).forEach(key => {
      const target = resolvedMapping[key];
      const val = row[key];
      if (val === undefined || val === null || val === '') return;

      if (target === 'name') {
        name = val;
      } else if (target === 'email') {
        email = val;
      } else if (target === 'phone') {
        phoneVal = val;
      } else if (target === 'city') {
        cityVal = val;
      } else if (target === 'gender') {
        genderVal = val;
      } else if (target === 'tags') {
        rawTags = val;
      } else if (target === 'totalSpend') {
        totalSpendVal = val;
      } else if (target === 'orderCount') {
        orderCountVal = val;
      } else if (target === 'lastOrderDate') {
        lastActiveVal = val;
      } else {
        customFields[key] = typeof val === 'object' ? JSON.stringify(val) : val;
      }
    });

    if (!name) {
      continue; // Skip rows without name
    }

    const phone = String(phoneVal).trim();
    const city = String(cityVal).trim();
    const gender = String(genderVal).toLowerCase().trim();

    // Parse tags split by semicolon
    const tags = rawTags
      ? String(rawTags).split(';').map(t => t.trim()).filter(Boolean)
      : [];

    // Standardize gender
    let parsedGender = 'unknown';
    if (['male', 'female', 'other'].includes(gender)) {
      parsedGender = gender;
    }

    // Parse spend, orders count, and last active date
    const totalSpend = parseFloat(totalSpendVal) || 0;
    const orderCount = parseInt(orderCountVal, 10) || 0;

    let lastOrderDate = undefined;
    if (lastActiveVal) {
      const parsedDate = new Date(lastActiveVal);
      if (!isNaN(parsedDate.getTime())) {
        lastOrderDate = parsedDate;
      }
    }
    
    const avgOrderValue = orderCount > 0 ? parseFloat((totalSpend / orderCount).toFixed(2)) : 0;

    const customerObj = {
      name: String(name).trim(),
      phone,
      city,
      gender: parsedGender,
      tags,
      totalSpend,
      orderCount,
      lastOrderDate,
      avgOrderValue,
      customFields,
      source: filename.split('.').pop().toLowerCase() === 'json' ? 'json' : (filename.split('.').pop().toLowerCase().startsWith('xls') ? 'excel' : 'csv')
    };

    // Only add email if it's a non-empty string and looks valid
    if (email && String(email).includes('@')) {
      customerObj.email = String(email).toLowerCase().trim();
    }

    cleanedCustomers.push(customerObj);
  }

  const headers = Object.keys(resolvedMapping);
  return { cleanedCustomers, headers, mapping: resolvedMapping };
};

module.exports = { parseCustomersCSV };
