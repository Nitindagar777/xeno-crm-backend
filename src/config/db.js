const mongoose = require('mongoose');
const env = require('./env');

const runWorkspaceMigration = async () => {
  try {
    const User = require('../models/User');
    const Workspace = require('../models/Workspace');
    const Campaign = require('../models/Campaign');
    const Segment = require('../models/Segment');
    const Customer = require('../models/Customer');
    const CommunicationLog = require('../models/CommunicationLog');
    const Activity = require('../models/Activity');
    const Order = require('../models/Order');

    const users = await User.find({});
    console.log(`[Migration] Scanning ${users.length} users for default workspaces...`);
    
    for (const user of users) {
      let workspace = await Workspace.findOne({ userId: user._id });
      if (!workspace) {
        workspace = new Workspace({
          name: 'Default Workspace',
          description: 'Your primary workspace',
          userId: user._id
        });
        await workspace.save();
        console.log(`[Migration] Created default workspace for user: ${user.name}`);
      }

      const wsId = workspace._id;
      
      // Migrate campaigns
      const cRes = await Campaign.updateMany({ userId: user._id, workspaceId: { $exists: false } }, { $set: { workspaceId: wsId } });
      if (cRes.modifiedCount > 0) console.log(`[Migration] Migrated ${cRes.modifiedCount} campaigns to workspace ${workspace.name}`);

      // Migrate segments
      const sRes = await Segment.updateMany({ userId: user._id, workspaceId: { $exists: false } }, { $set: { workspaceId: wsId } });
      if (sRes.modifiedCount > 0) console.log(`[Migration] Migrated ${sRes.modifiedCount} segments to workspace ${workspace.name}`);

      // Migrate customers
      const custRes = await Customer.updateMany({ userId: user._id, workspaceId: { $exists: false } }, { $set: { workspaceId: wsId } });
      if (custRes.modifiedCount > 0) console.log(`[Migration] Migrated ${custRes.modifiedCount} customers to workspace ${workspace.name}`);

      // Migrate communication logs
      const logRes = await CommunicationLog.updateMany({ userId: user._id, workspaceId: { $exists: false } }, { $set: { workspaceId: wsId } });
      if (logRes.modifiedCount > 0) console.log(`[Migration] Migrated ${logRes.modifiedCount} logs to workspace ${workspace.name}`);

      // Migrate activities
      const actRes = await Activity.updateMany({ userId: user._id, workspaceId: { $exists: false } }, { $set: { workspaceId: wsId } });
      if (actRes.modifiedCount > 0) console.log(`[Migration] Migrated ${actRes.modifiedCount} activities to workspace ${workspace.name}`);

      // Migrate orders
      const ordRes = await Order.updateMany({ userId: user._id, workspaceId: { $exists: false } }, { $set: { workspaceId: wsId } });
      if (ordRes.modifiedCount > 0) console.log(`[Migration] Migrated ${ordRes.modifiedCount} orders to workspace ${workspace.name}`);
    }
    console.log('[Migration] Workspace data migration completed successfully.');
  } catch (err) {
    console.error('[Migration] Failed to run database migration:', err.message);
  }
};

const connectDB = async () => {
  const options = {
    autoIndex: true, // Build indexes
  };

  const connectWithRetry = () => {
    console.log('Attempting MongoDB connection...');
    mongoose.connect(env.MONGODB_URI, options)
      .then(async () => {
        console.log('MongoDB successfully connected.');
        await runWorkspaceMigration();
      })
      .catch(err => {
        console.error('MongoDB connection error. Retrying in 5 seconds...', err.message);
        setTimeout(connectWithRetry, 5000);
      });
  };

  // Connection events
  mongoose.connection.on('disconnected', () => {
    console.warn('MongoDB connection lost. Retrying...');
  });

  mongoose.connection.on('error', (err) => {
    console.error('MongoDB connection error:', err);
  });

  connectWithRetry();
};

module.exports = connectDB;
