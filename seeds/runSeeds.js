require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/models/User');
const seedCustomers = require('./seedCustomers');
const seedOrders = require('./seedOrders');
const seedCampaigns = require('./seedCampaigns');

const runSeeds = async () => {
  const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/xenocrm';
  
  console.log(`Connecting to database: ${MONGODB_URI}`);
  try {
    await mongoose.connect(MONGODB_URI, { autoIndex: true });
    console.log('Database connected successfully for seeding.');

    // 0. Seed Default Admin User
    console.log('Clearing existing collections...');
    const Customer = require('../src/models/Customer');
    const Order = require('../src/models/Order');
    const Segment = require('../src/models/Segment');
    const Campaign = require('../src/models/Campaign');
    const CommunicationLog = require('../src/models/CommunicationLog');
    const CampaignStats = require('../src/models/CampaignStats');

    await User.deleteMany({});
    await Customer.deleteMany({});
    await Order.deleteMany({});
    await Segment.deleteMany({});
    await Campaign.deleteMany({});
    await CommunicationLog.deleteMany({});
    await CampaignStats.deleteMany({});

    console.log('Seeding default admin user...');
    const admin = new User({
      name: 'Lumière Administrator',
      email: 'admin@lumiere.com',
      password: 'admin123456', // Hashed automatically via pre-save hook
      role: 'admin'
    });
    await admin.save();
    console.log('Admin profile seeded: admin@lumiere.com / admin123456');

    // 1. Seed Customers
    const customers = await seedCustomers(admin._id);

    // 2. Seed Orders
    await seedOrders(customers, admin._id);

    // 3. Seed Campaigns
    await seedCampaigns(customers, admin._id);

    console.log('🚀 All seeds executed successfully.');
  } catch (err) {
    console.error('❌ Seeding process encountered a fatal error:', err);
  } finally {
    await mongoose.connection.close();
    console.log('Database connection closed.');
    process.exit(0);
  }
};

runSeeds();
