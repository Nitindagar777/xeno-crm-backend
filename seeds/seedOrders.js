const Order = require('../src/models/Order');

const products = [
  { name: 'Lumière Glow Serum', price: 1299 },
  { name: 'Velvet Matte Lipstick', price: 699 },
  { name: 'Hydra-Boost Face Cream', price: 1899 },
  { name: 'Rose Gold Highlighter', price: 899 },
  { name: 'Silk Hair Serum', price: 999 },
  { name: 'Exfoliating Face Scrub', price: 649 },
  { name: 'Lumière Premium Kurta', price: 2499 },
  { name: 'Embroidered Dupatta', price: 1199 },
  { name: 'Cotton Blend Lehenga', price: 5999 },
  { name: 'Designer Palazzo Set', price: 3299 }
];

const getRandomProduct = () => products[Math.floor(Math.random() * products.length)];
const getRandomRange = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

const seedOrders = async (customers, userId) => {
  console.log('Seeding orders collection...');
  await Order.deleteMany({});
  
  const orders = [];
  const channels = ['online', 'app', 'offline'];
 
  for (const customer of customers) {
    const totalOrdersCount = customer.orderCount;
    let remainingSpend = customer.totalSpend;
 
    if (totalOrdersCount === 0) continue;
 
    // Distribute remainingSpend across orders
    for (let i = 0; i < totalOrdersCount; i++) {
      let orderAmount = 0;
      
      if (i === totalOrdersCount - 1) {
        // Last order gets the remainder of the budget
        orderAmount = remainingSpend;
      } else {
        // Random amount, leaving at least 500 per subsequent order
        const maxSpend = remainingSpend - (totalOrdersCount - i - 1) * 500;
        orderAmount = getRandomRange(500, Math.max(500, Math.floor(maxSpend * 0.7)));
        remainingSpend -= orderAmount;
      }
 
      // Populate items that roughly sum up to orderAmount
      const items = [];
      let itemsSum = 0;
      let limit = 0;
      
      while (itemsSum < orderAmount * 0.8 && limit < 5) {
        const prod = getRandomProduct();
        const quantity = 1;
        
        items.push({
          name: prod.name,
          quantity,
          price: prod.price
        });
        
        itemsSum += prod.price;
        limit++;
      }
 
      // Add a filler item or adjust price of last item to match exactly
      if (items.length === 0) {
        items.push({
          name: 'Lumière Beauty Kit',
          quantity: 1,
          price: orderAmount
        });
      } else {
        // Adjust the last item price so items sum matches orderAmount exactly
        const diff = orderAmount - itemsSum;
        items[items.length - 1].price = Math.max(10, items[items.length - 1].price + diff);
      }
 
      // Calculate order date
      let orderedAt = customer.lastOrderDate;
      if (i < totalOrdersCount - 1) {
        // Distribute dates between firstOrderDate and lastOrderDate
        const firstTime = customer.firstOrderDate.getTime();
        const lastTime = customer.lastOrderDate.getTime();
        const randTime = getRandomRange(firstTime, lastTime);
        orderedAt = new Date(randTime);
      }
 
      orders.push({
        userId,
        customerId: customer._id,
        orderId: `ORD${getRandomRange(100000, 999999)}`,
        amount: orderAmount,
        items,
        channel: channels[Math.floor(Math.random() * channels.length)],
        status: 'completed',
        orderedAt
      });
    }
  }
 
  const seeded = await Order.insertMany(orders);
  console.log(`Seeded ${seeded.length} orders successfully.`);
  return seeded;
};
 
module.exports = seedOrders;
