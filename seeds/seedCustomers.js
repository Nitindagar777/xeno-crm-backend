const mongoose = require('mongoose');
const Customer = require('../src/models/Customer');

const indianNames = {
  female: [
    'Priya Sharma', 'Ananya Patel', 'Divya Nair', 'Aishwarya Sen', 'Riya Gupta',
    'Neha Verma', 'Deepika Rao', 'Pooja Joshi', 'Aditi Kulkarni', 'Sneha Deshmukh',
    'Shreya Banerjee', 'Kavita Reddy', 'Meera Krishnan', 'Swati Mishra', 'Preeti Bhat',
    'Kiran Choudhury', 'Nisha Saxena', 'Ritu Singh', 'Geeta Johar', 'Sonam Kapoor',
    'Esha Deol', 'Niharika Roy', 'Tanvi Shah', 'Amrita Rao', 'Shruti Hassan',
    'Roshni Patel', 'Kriti Sanon', 'Kiara Advani', 'Alia Bhatt', 'Janhavi Kapoor'
  ],
  male: [
    'Aarav Mehta', 'Rahul Dravid', 'Vikram Seth', 'Amitabh Bachchan', 'Sachin Tendulkar',
    'Rohit Sharma', 'Virat Kohli', 'Abhishek Singh', 'Sanjay Dutt', 'Arjun Rampal',
    'Aditya Roy', 'Varun Dhawan', 'Siddharth Malhotra', 'Ranbir Kapoor', 'Ranveer Singh',
    'Kartik Aaryan', 'Rajkummar Rao', 'Ayushmann Khurrana', 'Vicky Kaushal', 'Ishaan Khatter',
    'Anil Kapoor', 'Sunil Shetty', 'Hrithik Roshan', 'Akshay Kumar', 'Salman Khan',
    'Shah Rukh Khan', 'Aamir Khan', 'Dev Patel', 'Rajat Gupta', 'Nandan Nilekani'
  ],
  other: [
    'Sufi Sen', 'Sunny Nair', 'Bobby Gill', 'Kim Roy', 'Kiran Shah',
    'Robin Singh', 'Joy Das', 'Kalyan Bose', 'Rumi Kulkarni', 'Indu Mishra'
  ]
};

const cities = [
  ...Array(30).fill('Mumbai'),
  ...Array(35).fill('Delhi'),
  ...Array(40).fill('Bangalore'),
  ...Array(25).fill('Hyderabad'),
  ...Array(20).fill('Chennai'),
  ...Array(15).fill('Pune'),
  ...Array(35).fill('Kolkata')
];

const tags = ['loyal', 'vip', 'churn-risk', 'new-buyer', 'discount-lover', 'beauty-enthusiast', 'fashion-forward', 'active', 'dormant'];

const getRandomElement = (arr) => arr[Math.floor(Math.random() * arr.length)];
const getRandomRange = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const getRandomDate = (startDaysAgo, endDaysAgo) => {
  const date = new Date();
  const daysAgo = getRandomRange(startDaysAgo, endDaysAgo);
  date.setDate(date.getDate() - daysAgo);
  return date;
};

const generateCustomers = (userId, workspaceId) => {
  const customers = [];

  const addCustomer = (type, minSpend, maxSpend, minOrders, maxOrders, minDaysAgo, maxDaysAgo, tagList, createdAtDaysAgo = null) => {
    // Determine gender
    const rand = Math.random();
    let gender = 'female';
    let nameList = indianNames.female;
    if (rand > 0.6 && rand <= 0.9) {
      gender = 'male';
      nameList = indianNames.male;
    } else if (rand > 0.9) {
      gender = 'other';
      nameList = indianNames.other;
    }

    const name = getRandomElement(nameList);
    const firstName = name.split(' ')[0].toLowerCase();
    const email = `${firstName}.${getRandomRange(10, 999)}@gmail.com`;
    const phone = `+9198${getRandomRange(10000000, 99999999)}`;
    const city = getRandomElement(cities);
    const totalSpend = getRandomRange(minSpend, maxSpend);
    const orderCount = getRandomRange(minOrders, maxOrders);
    const avgOrderValue = parseFloat((totalSpend / orderCount).toFixed(2));

    // Dates
    const lastOrderDate = minDaysAgo !== null ? getRandomDate(minDaysAgo, maxDaysAgo) : undefined;
    
    // First order date is older than last order date
    let firstOrderDate = undefined;
    if (lastOrderDate) {
      const firstOrderDaysAgo = getRandomRange(maxDaysAgo + 10, maxDaysAgo + 200);
      firstOrderDate = new Date(lastOrderDate);
      firstOrderDate.setDate(firstOrderDate.getDate() - firstOrderDaysAgo);
    }

    let customerCreatedAt = new Date();
    if (createdAtDaysAgo) {
      customerCreatedAt.setDate(customerCreatedAt.getDate() - getRandomRange(createdAtDaysAgo.min, createdAtDaysAgo.max));
    } else if (firstOrderDate) {
      customerCreatedAt = new Date(firstOrderDate);
      customerCreatedAt.setDate(customerCreatedAt.getDate() - getRandomRange(1, 10));
    }

    customers.push({
      userId,
      workspaceId,
      name,
      email,
      phone,
      gender,
      city,
      tags: tagList,
      totalSpend,
      orderCount,
      avgOrderValue,
      firstOrderDate,
      lastOrderDate,
      source: 'csv', // Seeded as csv import to represent bulk
      createdAt: customerCreatedAt,
      updatedAt: lastOrderDate || customerCreatedAt
    });
  };

  // 1. 30 High-value loyalists (spend 20k-80k, 8-25 orders, recent 1-30 days)
  for (let i = 0; i < 30; i++) {
    addCustomer('loyalist', 20000, 80000, 8, 25, 1, 30, ['vip', 'loyal', 'active']);
  }

  // 2. 40 At-risk high-value (spend 15k-50k, last order 60-120 days ago)
  for (let i = 0; i < 40; i++) {
    addCustomer('at-risk-vip', 15000, 50000, 5, 15, 60, 120, ['vip', 'churn-risk']);
  }

  // 3. 50 Regular buyers (spend 3k-15k, 3-8 orders, active last 1-60 days)
  for (let i = 0; i < 50; i++) {
    addCustomer('regular', 3000, 15000, 3, 8, 5, 60, ['active', 'fashion-forward']);
  }

  // 4. 40 New customers (created within 30 days, 1-2 orders, recent last 1-25 days)
  for (let i = 0; i < 40; i++) {
    addCustomer('new', 700, 3500, 1, 2, 1, 25, ['new-buyer', 'beauty-enthusiast'], { min: 25, max: 30 });
  }

  // 5. 25 One-time buyers (1 order, spend 500-10000, last order 30-150 days)
  for (let i = 0; i < 25; i++) {
    addCustomer('one-time', 500, 10000, 1, 1, 30, 150, ['discount-lover']);
  }

  // 6. 15 Dormant (last order > 120 days, spend 1000-10000, orders 1-4)
  for (let i = 0; i < 15; i++) {
    addCustomer('dormant', 1000, 10000, 1, 4, 121, 250, ['dormant']);
  }

  return customers;
};

const seedCustomers = async (userId, workspaceId) => {
  console.log('Seeding customers collection...');
  await Customer.deleteMany({});
  const customers = generateCustomers(userId, workspaceId);
  const seeded = await Customer.insertMany(customers);
  console.log(`Seeded ${seeded.length} customers successfully.`);
  return seeded;
};

module.exports = seedCustomers;
