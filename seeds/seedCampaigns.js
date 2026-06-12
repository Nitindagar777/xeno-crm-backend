const Segment = require('../src/models/Segment');
const Campaign = require('../src/models/Campaign');
const CommunicationLog = require('../src/models/CommunicationLog');
const CampaignStats = require('../src/models/CampaignStats');
const Customer = require('../src/models/Customer');

const seedCampaigns = async (customers, userId, workspaceId) => {
  console.log('Seeding campaigns collection...');
  await Segment.deleteMany({ createdBy: 'manual' });
  await Campaign.deleteMany({});
  await CommunicationLog.deleteMany({});
  await CampaignStats.deleteMany({});
 
  // Fetch subsets of customers for segment definitions
  const vipCustomers = customers.filter(c => c.tags.includes('vip'));
  const regularCustomers = customers.filter(c => c.tags.includes('active') && !c.tags.includes('vip')).slice(0, 40);
  const churnRiskCustomers = customers.filter(c => c.tags.includes('churn-risk')).slice(0, 30);
 
  // 1. Create Segments
  const segment1 = new Segment({
    userId,
    workspaceId,
    name: 'Seeded VIP Shoppers',
    description: 'High value customers with over 5 orders',
    rules: { logic: 'AND', conditions: [{ field: 'totalSpend', operator: 'gte', value: 15000 }] },
    audienceIds: vipCustomers.map(c => c._id),
    audienceCount: vipCustomers.length,
    createdBy: 'manual'
  });
  await segment1.save();
 
  const segment2 = new Segment({
    userId,
    workspaceId,
    name: 'Active Shoppers Segment',
    description: 'Regular active purchasers in the database',
    rules: { logic: 'AND', conditions: [{ field: 'orderCount', operator: 'gte', value: 3 }] },
    audienceIds: regularCustomers.map(c => c._id),
    audienceCount: regularCustomers.length,
    createdBy: 'manual'
  });
  await segment2.save();
 
  const segment3 = new Segment({
    userId,
    workspaceId,
    name: 'At-Risk Cohort',
    description: 'VIPs at risk of churn',
    rules: { logic: 'AND', conditions: [{ field: 'daysSinceLastOrder', operator: 'gte', value: 60 }] },
    audienceIds: churnRiskCustomers.map(c => c._id),
    audienceCount: churnRiskCustomers.length,
    createdBy: 'manual'
  });
  await segment3.save();
 
  // 2. Create Campaigns
  const campaign1 = new Campaign({
    userId,
    workspaceId,
    name: 'Summer Glow Welcomer',
    segmentId: segment1._id,
    messageTemplate: 'Hi {{firstName}}, we have curated early-access rose gold highlights for our VIPs in {{city}}! Get yours before public launch.',
    channel: 'whatsapp',
    status: 'completed',
    startedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
    completedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000 + 3600000), // 3 days ago + 1 hour
    createdBy: 'ai',
    aiContext: 'VIP targeted drop'
  });
  await campaign1.save();
 
  const campaign2 = new Campaign({
    userId,
    workspaceId,
    name: 'VIP Loyalty Catalog Drop',
    segmentId: segment2._id,
    messageTemplate: 'Hi {{name}}, view our new Lumière Premium Kurta catalog! You have purchased {{orderCount}} items with us, enjoy 15% off.',
    channel: 'email',
    status: 'completed',
    startedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
    completedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000 + 5400000), // 5 days ago + 1.5 hrs
    createdBy: 'manual'
  });
  await campaign2.save();
 
  const campaign3 = new Campaign({
    userId,
    workspaceId,
    name: 'At-Risk VIP Re-Engagement',
    segmentId: segment3._id,
    messageTemplate: 'Hi {{firstName}}, we miss you! Use code MISSYOU for 25% off on our Glow Serum.',
    channel: 'sms',
    status: 'completed',
    startedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
    completedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000 + 4000000),
    createdBy: 'ai',
    aiContext: 'Churn recovery discount promotion'
  });
  await campaign3.save();
 
  // 3. Generate logs and stats helper
  const createLogsAndStats = async (campaign, segmentCustomers, deliveryProb, openProb, clickProb, failProb) => {
    const logs = [];
    let queued = 0, sent = 0, delivered = 0, failed = 0, opened = 0, read = 0, clicked = 0;
 
    segmentCustomers.forEach((cust) => {
      const personalizedMessage = campaign.messageTemplate
        .replace('{{name}}', cust.name)
        .replace('{{firstName}}', cust.name.split(' ')[0])
        .replace('{{city}}', cust.city || 'Mumbai')
        .replace('{{orderCount}}', cust.orderCount);
 
      const rand = Math.random();
      let status = 'sent';
      const history = [{ status: 'queued', timestamp: campaign.startedAt }];
 
      if (rand < failProb) {
        status = 'failed';
        failed++;
        history.push({ status: 'failed', timestamp: new Date(campaign.startedAt.getTime() + 10000) });
      } else {
        sent++;
        history.push({ status: 'sent', timestamp: new Date(campaign.startedAt.getTime() + 1000) });
        
        if (Math.random() < deliveryProb) {
          status = 'delivered';
          delivered++;
          history.push({ status: 'delivered', timestamp: new Date(campaign.startedAt.getTime() + 5000) });
          
          if (campaign.channel !== 'sms' && Math.random() < openProb) {
            status = 'opened';
            opened++;
            history.push({ status: 'opened', timestamp: new Date(campaign.startedAt.getTime() + 60000) });
            
            if (Math.random() < 0.8) {
              status = 'read';
              read++;
              history.push({ status: 'read', timestamp: new Date(campaign.startedAt.getTime() + 120000) });
            }
 
            if (Math.random() < clickProb) {
              status = 'clicked';
              clicked++;
              history.push({ status: 'clicked', timestamp: new Date(campaign.startedAt.getTime() + 300000) });
            }
          }
        } else {
          status = 'sent'; // stayed at sent
        }
      }
 
      logs.push({
        userId: campaign.userId,
        workspaceId,
        campaignId: campaign._id,
        customerId: cust._id,
        personalizedMessage,
        channel: campaign.channel,
        vendorMessageId: `ch_seeded_${Math.random().toString(36).substring(7)}`,
        status,
        statusHistory: history,
        failureReason: status === 'failed' ? 'Simulated network timeout' : undefined,
        createdAt: campaign.startedAt,
        updatedAt: campaign.completedAt
      });
    });
 
    await CommunicationLog.insertMany(logs);
 
    const total = segmentCustomers.length;
    const statsObj = new CampaignStats({
      userId: campaign.userId,
      workspaceId,
      campaignId: campaign._id,
      total,
      queued,
      sent,
      delivered,
      failed,
      opened,
      read,
      clicked,
      converted: 0,
      deliveryRate: total > 0 ? parseFloat(((delivered / total) * 100).toFixed(2)) : 0,
      openRate: delivered > 0 ? parseFloat(((opened / delivered) * 100).toFixed(2)) : 0,
      clickRate: opened > 0 ? parseFloat(((clicked / opened) * 100).toFixed(2)) : 0
    });
    await statsObj.save();
  };
 
  // Run generation for the 3 campaigns
  await createLogsAndStats(campaign1, vipCustomers, 0.95, 0.85, 0.45, 0.02);
  await createLogsAndStats(campaign2, regularCustomers, 0.90, 0.60, 0.20, 0.05);
  await createLogsAndStats(campaign3, churnRiskCustomers, 0.88, 0.70, 0.35, 0.08);
 
  console.log('Campaigns seeding complete.');
};

module.exports = seedCampaigns;
