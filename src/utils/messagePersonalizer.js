const formatCurrency = (amount) => {
  if (amount === undefined || amount === null) return '₹0';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(amount);
};

const formatDate = (date) => {
  if (!date) return '';
  try {
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[d.getMonth()];
    const year = d.getFullYear();
    return `${day} ${month} ${year}`;
  } catch (err) {
    return '';
  }
};

const personalizeMessage = (template, customer) => {
  if (!template) return '';
  if (!customer) return template;

  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    switch (key) {
      case 'name':
        return customer.name || match;
      case 'firstName':
        if (!customer.name) return match;
        return customer.name.split(' ')[0];
      case 'city':
        return customer.city || match;
      case 'totalSpend':
        return formatCurrency(customer.totalSpend);
      case 'orderCount':
        return customer.orderCount !== undefined ? customer.orderCount.toString() : match;
      case 'lastOrderDate':
        return customer.lastOrderDate ? formatDate(customer.lastOrderDate) : match;
      case 'avgOrderValue':
        return formatCurrency(customer.avgOrderValue);
      default:
        return match; // return original string if key is unknown
    }
  });
};

module.exports = { personalizeMessage, formatCurrency, formatDate };
