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
    const AILearningPattern = require('../src/models/AILearningPattern');
    const Activity = require('../src/models/Activity');

    await User.deleteMany({});
    await Customer.deleteMany({});
    await Order.deleteMany({});
    await Segment.deleteMany({});
    await Campaign.deleteMany({});
    await CommunicationLog.deleteMany({});
    await CampaignStats.deleteMany({});
    await AILearningPattern.deleteMany({});
    await Activity.deleteMany({});

    console.log('Seeding fallback AI learning patterns...');
    const patterns = [
      {
        prompt: "target customers with daysSinceLastOrder >= 60 and orderCount > 2",
        keywords: ["at-risk", "loyalists", "dayssincelastorder", "ordercount", "churn"],
        segmentRules: {
          logic: "AND",
          conditions: [
            { field: "daysSinceLastOrder", operator: "gte", value: 60 },
            { field: "orderCount", operator: "gt", value: 2 }
          ]
        },
        segmentName: "At-Risk Loyalists",
        segmentDesc: "Loyal customers who haven't made a purchase in 60+ days",
        campaignName: "Lumière Re-engagement Winback",
        messageTemplate: "Hi {{firstName}}, we miss you at Lumière! Here is a special 20% off voucher: WELCOMEBACK20. Re-discover your favorite styles today at lumi.re/missyou",
        channel: "whatsapp"
      },
      {
        prompt: "target customers with totalSpend > 10000 and daysSinceLastOrder >= 45",
        keywords: ["vip", "spent", "inactive", "days", "dormant"],
        segmentRules: {
          logic: "AND",
          conditions: [
            { field: "totalSpend", operator: "gt", value: 10000 },
            { field: "daysSinceLastOrder", operator: "gte", value: 45 }
          ]
        },
        segmentName: "Dormant VIPs",
        segmentDesc: "High spenders (spent > 10k) inactive for 45+ days",
        campaignName: "Lumière VIP Concierge Collection",
        messageTemplate: "Hi {{firstName}}, as one of our VIP customers, we miss you! Here is a special 20% off coupon just for you: VIPBACK20. Re-discover the luxury today at lumi.re/vip",
        channel: "whatsapp"
      },
      {
        prompt: "target customers with daysSinceRegistration <= 7",
        keywords: ["registered", "new", "onboarding", "discoverers"],
        segmentRules: {
          logic: "AND",
          conditions: [
            { field: "daysSinceRegistration", operator: "lte", value: 7 }
          ]
        },
        segmentName: "New Discoverers - Welcome Series",
        segmentDesc: "Registered within the last 7 days",
        campaignName: "Lumière Welcome Onboarding Series",
        messageTemplate: "Hi {{firstName}}, welcome to Lumière! Elevate your style. Get an exclusive 15% welcome discount with code WELCOME15. Shop now: welcome.lumi.re",
        channel: "whatsapp"
      },
      {
        prompt: "target customers with orderCount >= 5 and daysSinceLastOrder <= 30",
        keywords: ["loyal", "active", "buyers", "ordercount", "rewards"],
        segmentRules: {
          logic: "AND",
          conditions: [
            { field: "orderCount", operator: "gte", value: 5 },
            { field: "daysSinceLastOrder", operator: "lte", value: 30 }
          ]
        },
        segmentName: "Active Brand Loyalists",
        segmentDesc: "Customers with 5+ orders who made a purchase in the last 30 days",
        campaignName: "Lumière Loyalists Early Summer Access",
        messageTemplate: "Hey {{firstName}}, thank you for placing {{orderCount}} orders with us! Get exclusive early access to our new drops at 10% off. Code: LOYAL10. Shop: loyalty.lumi.re",
        channel: "whatsapp"
      },
      {
        prompt: "target customers with orderCount == 1",
        keywords: ["one-time", "buyers", "ordercount"],
        segmentRules: {
          logic: "AND",
          conditions: [
            { field: "orderCount", operator: "eq", value: 1 }
          ]
        },
        segmentName: "One-Time Buyers",
        segmentDesc: "Customers who have made exactly one purchase",
        campaignName: "Lumière Repeat Purchase Promotion",
        messageTemplate: "Hi {{firstName}}, thank you for your first order at Lumière! We hope you loved it. Take 15% off your second order with code NEXT15: second.lumi.re",
        channel: "whatsapp"
      }
    ];

    await AILearningPattern.insertMany(patterns);
    console.log('Seeded fallback AI patterns successfully.');

    console.log('Seeding default admin user...');
    const admin = new User({
      name: 'Lumière Administrator',
      email: 'admin@lumiere.com',
      password: 'admin123456', // Hashed automatically via pre-save hook
      role: 'admin'
    });
    await admin.save();
    console.log('Admin profile seeded: admin@lumiere.com / admin123456');

    // Seed Default Workspace for Admin
    const Workspace = require('../src/models/Workspace');
    await Workspace.deleteMany({});
    const defaultWorkspace = new Workspace({
      name: 'Lumière Boutique',
      userId: admin._id,
      description: 'Default fashion workspace'
    });
    await defaultWorkspace.save();
    console.log('Default workspace seeded:', defaultWorkspace.name);

    // 1. Seed Customers
    const customers = await seedCustomers(admin._id, defaultWorkspace._id);

    // 2. Seed Orders
    await seedOrders(customers, admin._id, defaultWorkspace._id);

    // 3. Seed Campaigns
    await seedCampaigns(customers, admin._id, defaultWorkspace._id);

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
