const { parse } = require('csv-parse');

/**
 * Parses a CSV buffer and extracts customer records.
 * @param {Buffer} buffer The file buffer containing CSV data
 * @returns {Promise<Array<Object>>} Parsed and cleaned customer objects
 */
const parseCustomersCSV = (buffer) => {
  return new Promise((resolve, reject) => {
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

        const cleanedCustomers = [];

        for (const row of records) {
          // Normalise keys to lowercase to support case-insensitive CSV headers
          const normalizedRow = {};
          Object.keys(row).forEach(key => {
            normalizedRow[key.toLowerCase().trim()] = row[key];
          });

          const name = normalizedRow.name;
          const email = normalizedRow.email;
          const phone = normalizedRow.phone || '';
          const city = normalizedRow.city || '';
          const gender = (normalizedRow.gender || 'unknown').toLowerCase();
          const rawTags = normalizedRow.tags || '';

          if (!name) {
            continue; // Skip rows without name
          }

          // Parse tags split by semicolon
          const tags = rawTags
            ? rawTags.split(';').map(t => t.trim()).filter(Boolean)
            : [];

          // Standardize gender
          let parsedGender = 'unknown';
          if (['male', 'female', 'other'].includes(gender)) {
            parsedGender = gender;
          }

          // Parse spend, orders count, and last active date
          const totalSpendVal = normalizedRow['total spend'] || normalizedRow['totalspend'] || normalizedRow['spend'] || 0;
          const totalSpend = parseFloat(totalSpendVal) || 0;

          const orderCountVal = normalizedRow['orders'] || normalizedRow['ordercount'] || normalizedRow['order count'] || 0;
          const orderCount = parseInt(orderCountVal, 10) || 0;

          const lastActiveVal = normalizedRow['last active'] || normalizedRow['lastactive'] || normalizedRow['last order date'] || normalizedRow['lastorderdate'] || null;
          let lastOrderDate = undefined;
          if (lastActiveVal) {
            const parsedDate = new Date(lastActiveVal);
            if (!isNaN(parsedDate.getTime())) {
              lastOrderDate = parsedDate;
            }
          }
          
          const avgOrderValue = orderCount > 0 ? parseFloat((totalSpend / orderCount).toFixed(2)) : 0;

          // Identify and separate any custom/extra fields
          const standardKeys = [
            'name', 'email', 'phone', 'city', 'gender', 'tags',
            'total spend', 'totalspend', 'spend',
            'orders', 'ordercount', 'order count',
            'last active', 'lastactive', 'last order date', 'lastorderdate'
          ];
          const customFields = {};
          Object.keys(normalizedRow).forEach(key => {
            if (!standardKeys.includes(key) && normalizedRow[key] !== undefined && normalizedRow[key] !== null && normalizedRow[key] !== '') {
              customFields[key] = normalizedRow[key];
            }
          });

          const customerObj = {
            name,
            phone,
            city,
            gender: parsedGender,
            tags,
            totalSpend,
            orderCount,
            lastOrderDate,
            avgOrderValue,
            customFields,
            source: 'csv'
          };

          // Only add email if it's a non-empty string and looks valid
          if (email && email.includes('@')) {
            customerObj.email = email.toLowerCase();
          }

          cleanedCustomers.push(customerObj);
        }

        resolve(cleanedCustomers);
      }
    );
  });
};

module.exports = { parseCustomersCSV };
