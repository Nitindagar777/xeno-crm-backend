const mongoose = require('mongoose');
const axios = require('axios');
const Campaign = require('../models/Campaign');
const Segment = require('../models/Segment');
const Customer = require('../models/Customer');
const CommunicationLog = require('../models/CommunicationLog');
const CampaignStats = require('../models/CampaignStats');
const env = require('../config/env');
const { success, error } = require('../utils/responseHelper');
const { personalizeMessage } = require('../utils/messagePersonalizer');
const { updateCampaignStats } = require('../services/stats.service');
const { generateWithFallback } = require('../services/geminiAgent.service');
const { logActivity } = require('../services/activity.service');

const getCallbackUrl = (clientUrl) => {
  if (clientUrl.includes('localhost') || clientUrl.includes('127.0.0.1')) {
    return 'http://localhost:5000/api/campaigns/receipt';
  }
  if (clientUrl.includes('frontend.')) {
    return clientUrl.replace('frontend.', 'api.') + '/api/campaigns/receipt';
  }
  try {
    const urlObj = new URL(clientUrl);
    urlObj.hostname = `api.${urlObj.hostname}`;
    return urlObj.origin + '/api/campaigns/receipt';
  } catch (e) {
    return 'http://localhost:5000/api/campaigns/receipt';
  }
};


// @desc    Get all campaigns
// @route   GET /api/campaigns
// @access  Private
exports.getCampaigns = async (req, res, next) => {
  try {
    const statusFilter = req.query.status;
    let query = { workspaceId: req.workspaceId };
    if (statusFilter) {
      query.status = statusFilter;
    }

    const campaigns = await Campaign.find(query)
      .populate('segmentId', 'name audienceCount')
      .sort({ createdAt: -1 });

    // Attach statistics summary if available
    const campaignList = await Promise.all(campaigns.map(async (c) => {
      const stats = await CampaignStats.findOne({ campaignId: c._id });
      return {
        ...c.toObject(),
        stats: stats || null
      };
    }));

    return success(res, campaignList, 'Campaigns fetched successfully');
  } catch (err) {
    next(err);
  }
};

// @desc    Get single campaign with stats
// @route   GET /api/campaigns/:id
// @access  Private
exports.getCampaign = async (req, res, next) => {
  try {
    const query = { _id: req.params.id, workspaceId: req.workspaceId };
    const campaign = await Campaign.findOne(query).populate('segmentId');
    if (!campaign) {
      return error(res, 'Campaign not found', 404);
    }

    const stats = await CampaignStats.findOne({ campaignId: campaign._id });

    return success(res, { campaign, stats }, 'Campaign fetched successfully');
  } catch (err) {
    next(err);
  }
};

// @desc    Create campaign (draft status)
// @route   POST /api/campaigns
// @access  Private
exports.createCampaign = async (req, res, next) => {
  try {
    const { name, segmentId, messageTemplate, channel, createdBy, aiContext } = req.body;

    if (!name || !segmentId || !messageTemplate || !channel) {
      return error(res, 'Please provide all required fields: name, segmentId, messageTemplate, channel', 400);
    }

    // Verify segment exists and belongs to active workspace
    const segment = await Segment.findOne({ _id: segmentId, workspaceId: req.workspaceId });
    if (!segment) {
      return error(res, 'Segment not found', 404);
    }

    const campaign = new Campaign({
      userId: req.user._id,
      workspaceId: req.workspaceId,
      name,
      segmentId,
      messageTemplate,
      channel,
      status: 'draft',
      createdBy: createdBy || 'manual',
      aiContext
    });

    await campaign.save();

    logActivity({
      userId: req.user._id,
      workspaceId: req.workspaceId,
      type: 'campaign_created',
      title: `Created campaign: ${campaign.name}`,
      description: `Channel: ${campaign.channel}`,
      resourceType: 'campaign',
      resourceId: campaign._id,
      meta: { channel: campaign.channel }
    });

    return success(res, campaign, 'Campaign draft created successfully', 201);
  } catch (err) {
    next(err);
  }
};

// @desc    Update campaign draft
// @route   PUT /api/campaigns/:id
// @access  Private
exports.updateCampaign = async (req, res, next) => {
  try {
    const { name, segmentId, messageTemplate, channel } = req.body;

    const query = { _id: req.params.id, workspaceId: req.workspaceId };
    let campaign = await Campaign.findOne(query);
    if (!campaign) {
      return error(res, 'Campaign not found', 404);
    }

    if (campaign.status !== 'draft') {
      return error(res, 'Only draft campaigns can be updated', 400);
    }

    if (name) campaign.name = name;
    if (messageTemplate) campaign.messageTemplate = messageTemplate;
    if (channel) campaign.channel = channel;
    
    if (segmentId) {
      const segment = await Segment.findOne({ _id: segmentId, workspaceId: req.workspaceId });
      if (!segment) {
        return error(res, 'Segment not found', 404);
      }
      campaign.segmentId = segmentId;
    }

    await campaign.save();
    return success(res, campaign, 'Campaign updated successfully');
  } catch (err) {
    next(err);
  }
};

// @desc    Delete campaign draft
// @route   DELETE /api/campaigns/:id
// @access  Private
exports.deleteCampaign = async (req, res, next) => {
  try {
    const query = { _id: req.params.id, workspaceId: req.workspaceId };
    const campaign = await Campaign.findOne(query);
    if (!campaign) {
      return error(res, 'Campaign not found', 404);
    }

    if (campaign.status !== 'draft') {
      return error(res, 'Only draft campaigns can be deleted', 400);
    }

    await CampaignStats.deleteOne({ campaignId: campaign._id });
    await CommunicationLog.deleteMany({ campaignId: campaign._id });
    
    await campaign.deleteOne();

    return success(res, null, 'Campaign draft deleted successfully');
  } catch (err) {
    next(err);
  }
};

// @desc    Orchestrate and start sending a campaign
// @route   POST /api/campaigns/:id/send
// @access  Private
exports.sendCampaign = async (req, res, next) => {
  try {
    const query = { _id: req.params.id, workspaceId: req.workspaceId };
    const campaign = await Campaign.findOne(query);
    if (!campaign) {
      return error(res, 'Campaign not found', 404);
    }

    if (campaign.status !== 'draft' && campaign.status !== 'scheduled') {
      return error(res, 'Campaign has already been started or completed', 400);
    }

    // Check for scheduling
    if (req.body.scheduledAt) {
      const scheduledTime = new Date(req.body.scheduledAt);
      if (scheduledTime > new Date()) {
        campaign.scheduledAt = scheduledTime;
        campaign.status = 'scheduled';
        await campaign.save();

        const delay = scheduledTime.getTime() - Date.now();
        setTimeout(async () => {
          try {
            const freshCampaign = await Campaign.findById(campaign._id);
            if (freshCampaign && freshCampaign.status === 'scheduled') {
              const seg = await Segment.findOne({ _id: freshCampaign.segmentId, workspaceId: freshCampaign.workspaceId });
              if (!seg || seg.audienceIds.length === 0) {
                console.error('[Scheduled Campaign] Segment empty or not found for campaign', freshCampaign._id);
                return;
              }
              const custs = await Customer.find({ _id: { $in: seg.audienceIds }, workspaceId: freshCampaign.workspaceId });
              freshCampaign.status = 'running';
              freshCampaign.startedAt = new Date();
              await freshCampaign.save();

              const initialStats = new CampaignStats({
                userId: freshCampaign.userId,
                campaignId: freshCampaign._id,
                total: custs.length,
                queued: custs.length
              });
              await initialStats.save();

              // Background send
              const batchSize = 50;
              const delayBetweenBatches = 100;
              const actualCallbackUrl = getCallbackUrl(env.CLIENT_URL);

              for (let i = 0; i < custs.length; i += batchSize) {
                const batch = custs.slice(i, i + batchSize);
                const promises = batch.map(async (customer) => {
                  const personalizedMessage = personalizeMessage(freshCampaign.messageTemplate, customer);
                  const log = new CommunicationLog({
                    userId: freshCampaign.userId,
                    workspaceId: freshCampaign.workspaceId,
                    campaignId: freshCampaign._id,
                    customerId: customer._id,
                    personalizedMessage,
                    channel: freshCampaign.channel,
                    status: 'queued',
                    statusHistory: [{ status: 'queued', timestamp: new Date() }]
                  });
                  await log.save();
                  try {
                    const sendResponse = await axios.post(`${env.CHANNEL_SERVICE_URL}/api/channel/send`, {
                      campaignId: freshCampaign._id.toString(),
                      campaignName: freshCampaign.name,
                      customerId: customer._id.toString(),
                      userId: freshCampaign.userId.toString(),
                      message: personalizedMessage,
                      channel: freshCampaign.channel,
                      recipientPhone: customer.phone,
                      recipientEmail: customer.email,
                      callbackUrl: actualCallbackUrl
                    }, { headers: { 'Content-Type': 'application/json' }, timeout: 5000 });
                    if (sendResponse.data && sendResponse.data.success) {
                      log.vendorMessageId = sendResponse.data.vendorMessageId;
                      log.status = 'sent';
                      log.statusHistory.push({ status: 'sent', timestamp: new Date() });
                      await log.save();
                    } else {
                      throw new Error('Channel service failed to acknowledge');
                    }
                  } catch (sendErr) {
                    log.status = 'failed';
                    log.failureReason = sendErr.message;
                    log.statusHistory.push({ status: 'failed', timestamp: new Date(), meta: { error: sendErr.message } });
                    await log.save();
                  }
                });
                await Promise.allSettled(promises);
                await updateCampaignStats(freshCampaign._id);
                if (i + batchSize < custs.length) {
                  await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
                }
              }
            }
          } catch (err) {
            console.error('[Scheduled Campaign] Error executing scheduled campaign:', err);
          }
        }, delay);

        return success(res, { scheduledAt: scheduledTime }, `Campaign scheduled for ${scheduledTime.toISOString()}`, 200);
      }
    }

    // Load segment and populated audience scoped to active workspace
    const segment = await Segment.findOne({ _id: campaign.segmentId, workspaceId: req.workspaceId });
    if (!segment || segment.audienceIds.length === 0) {
      return error(res, 'Segment does not exist or has 0 customers', 400);
    }

    const customers = await Customer.find({ _id: { $in: segment.audienceIds }, workspaceId: req.workspaceId });

    // Update campaign status to running
    campaign.status = 'running';
    campaign.startedAt = new Date();
    await campaign.save();

    // Initialize CampaignStats
    const initialStats = new CampaignStats({
      userId: req.user._id,
      campaignId: campaign._id,
      total: customers.length,
      queued: customers.length
    });
    await initialStats.save();

    logActivity({
      userId: req.user._id,
      workspaceId: req.workspaceId,
      type: 'campaign_sent',
      title: `Sent campaign: ${campaign.name}`,
      description: `Targeted ${customers.length} customers via ${campaign.channel}`,
      resourceType: 'campaign',
      resourceId: campaign._id,
      meta: { channel: campaign.channel, audienceCount: customers.length }
    });

    // Respond immediately to prevent HTTP timeouts
    success(res, { totalQueued: customers.length }, 'Campaign execution initiated', 200);

    // Run async batching process in background
    (async () => {
      const batchSize = 50;
      const delayBetweenBatches = 100; // 100ms
      const actualCallbackUrl = getCallbackUrl(env.CLIENT_URL);

      for (let i = 0; i < customers.length; i += batchSize) {
        const batch = customers.slice(i, i + batchSize);
        
        const promises = batch.map(async (customer) => {
          const personalizedMessage = personalizeMessage(campaign.messageTemplate, customer);
          
          const log = new CommunicationLog({
            userId: req.user._id,
            workspaceId: req.workspaceId,
            campaignId: campaign._id,
            customerId: customer._id,
            personalizedMessage,
            channel: campaign.channel,
            status: 'queued',
            statusHistory: [{ status: 'queued', timestamp: new Date() }]
          });
          await log.save();

          try {
            const sendResponse = await axios.post(`${env.CHANNEL_SERVICE_URL}/api/channel/send`, {
              campaignId: campaign._id.toString(),
              campaignName: campaign.name,
              customerId: customer._id.toString(),
              userId: req.user._id.toString(),
              message: personalizedMessage,
              channel: campaign.channel,
              recipientPhone: customer.phone,
              recipientEmail: customer.email,
              callbackUrl: actualCallbackUrl
            }, {
              headers: {
                'Content-Type': 'application/json'
              },
              timeout: 5000
            });

            if (sendResponse.data && sendResponse.data.success) {
              log.vendorMessageId = sendResponse.data.vendorMessageId;
              log.status = 'sent';
              log.statusHistory.push({ status: 'sent', timestamp: new Date() });
              await log.save();
            } else {
              throw new Error('Channel service failed to acknowledge');
            }
          } catch (sendErr) {
            console.error(`[Campaign Send] Error sending message to customer ${customer._id}:`, sendErr.message);
            log.status = 'failed';
            log.failureReason = sendErr.message;
            log.statusHistory.push({
              status: 'failed',
              timestamp: new Date(),
              meta: { error: sendErr.message }
            });
            await log.save();
          }
        });

        await Promise.allSettled(promises);
        await updateCampaignStats(campaign._id);

        if (i + batchSize < customers.length) {
          await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
        }
      }
    })().catch(err => {
      console.error('[Campaign Background Send Crash]:', err);
    });

  } catch (err) {
    next(err);
  }
};

// @desc    Callback webhook called by channel service
// @route   POST /api/campaigns/receipt
// @access  Public (Validated by webhook secret)
exports.receiveReceipt = async (req, res, next) => {
  const channelSecret = req.headers['x-channel-secret'];
  if (channelSecret !== env.CHANNEL_SECRET) {
    return res.status(401).json({ success: false, error: 'Unauthorized webhook call' });
  }

  const { vendorMessageId, status, timestamp, meta } = req.body;

  if (!vendorMessageId || !status) {
    return res.status(400).json({ success: false, error: 'Missing vendorMessageId or status' });
  }

  try {
    const log = await CommunicationLog.findOne({ vendorMessageId });
    if (!log) {
      return res.status(404).json({ success: false, error: 'Communication log not found' });
    }

    const statusOrder = {
      'queued': 1,
      'sent': 2,
      'delivered': 3,
      'failed': 3,
      'opened': 4,
      'read': 5,
      'clicked': 6
    };

    const currentPrecedence = statusOrder[log.status] || 0;
    const newPrecedence = statusOrder[status] || 0;

    if (newPrecedence > currentPrecedence || status === 'failed') {
      log.status = status;
      log.statusHistory.push({
        status,
        timestamp: timestamp ? new Date(timestamp) : new Date(),
        meta
      });
      
      if (status === 'failed' && meta && meta.reason) {
        log.failureReason = meta.reason;
      }
      
      await log.save();
      await updateCampaignStats(log.campaignId);
    }

    return res.status(200).json({ success: true, message: 'Receipt processed successfully' });
  } catch (err) {
    next(err);
  }
};

// @desc    Get communication logs for a campaign (paginated)
// @route   GET /api/campaigns/:id/logs
// @access  Private
exports.getCampaignLogs = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;
    const skip = (page - 1) * limit;
    const statusFilter = req.query.status;

    const query = { _id: req.params.id, workspaceId: req.workspaceId };
    const campaign = await Campaign.findOne(query);
    if (!campaign) {
      return error(res, 'Campaign not found', 404);
    }

    let logQuery = { campaignId: new mongoose.Types.ObjectId(req.params.id), workspaceId: req.workspaceId };
    if (statusFilter) {
      logQuery.status = statusFilter;
    }

    const logs = await CommunicationLog.find(logQuery)
      .populate('customerId', 'name email phone')
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await CommunicationLog.countDocuments(logQuery);

    return success(res, {
      logs,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    }, 'Campaign communication logs fetched successfully');
  } catch (err) {
    next(err);
  }
};

// @desc    Get aggregated campaign stats
// @route   GET /api/campaigns/:id/stats
// @access  Private
exports.getCampaignStats = async (req, res, next) => {
  try {
    const query = { _id: req.params.id, workspaceId: req.workspaceId };
    const campaign = await Campaign.findOne(query);
    if (!campaign) {
      return error(res, 'Campaign not found', 404);
    }

    let stats = await CampaignStats.findOne({ campaignId: req.params.id });
    
    if (!stats) {
      stats = await updateCampaignStats(req.params.id);
    }

    return success(res, stats, 'Campaign statistics fetched successfully');
  } catch (err) {
    next(err);
  }
};

// @desc    Get AI-generated campaign analysis
// @route   GET /api/campaigns/:id/analysis
// @access  Private
exports.getCampaignAnalysis = async (req, res, next) => {
  try {
    const query = { _id: req.params.id, workspaceId: req.workspaceId };
    const campaign = await Campaign.findOne(query);
    if (!campaign) {
      return error(res, 'Campaign not found', 404);
    }

    if (campaign.aiAnalysis) {
      return success(res, { analysis: campaign.aiAnalysis, cached: true }, 'Campaign analysis fetched successfully');
    }

    if (campaign.status !== 'completed') {
      return error(res, 'AI analysis is only available for completed campaigns', 400);
    }

    const stats = await CampaignStats.findOne({ campaignId: campaign._id });
    if (!stats) {
      return error(res, 'Campaign statistics not found. Cannot generate analysis.', 404);
    }

    let analysisText;

    try {
      const prompt = `You are a CRM analytics AI. Analyze this campaign performance and provide actionable insights in 3-4 sentences.
Campaign: ${campaign.name}, Channel: ${campaign.channel}
Stats: Total: ${stats.total}, Sent: ${stats.sent}, Delivered: ${stats.delivered}, Failed: ${stats.failed}, Opened: ${stats.opened}, Clicked: ${stats.clicked}, Converted: ${stats.converted}
Delivery Rate: ${stats.deliveryRate}%, Open Rate: ${stats.openRate}%, Click Rate: ${stats.clickRate}%
Provide specific recommendations for improvement.`;

      const result = await generateWithFallback(prompt);
      analysisText = result.response.text();
    } catch (aiErr) {
      console.error('[Campaign Analysis] Gemini API error:', aiErr.message);
      const issues = [];
      if (stats.deliveryRate < 90) issues.push(`Delivery rate is low at ${stats.deliveryRate}%. Consider cleaning your contact list and verifying ${campaign.channel} addresses.`);
      if (stats.openRate < 20) issues.push(`Open rate of ${stats.openRate}% is below average. Try more compelling subject lines or sending at optimal times.`);
      if (stats.clickRate < 5) issues.push(`Click rate of ${stats.clickRate}% suggests the content may not be engaging enough. Consider stronger CTAs and personalization.`);
      if (stats.converted === 0) issues.push('No conversions were attributed to this campaign. Consider retargeting engaged users with follow-up offers.');
      if (issues.length === 0) issues.push('Campaign performed well across all metrics. Consider scaling this approach to larger segments.');
      analysisText = issues.join(' ');
    }

    campaign.aiAnalysis = analysisText;
    await campaign.save();

    return success(res, { analysis: analysisText, cached: false }, 'Campaign analysis generated successfully');
  } catch (err) {
    next(err);
  }
};

// @desc    Mark a communication log as converted
// @route   POST /api/campaigns/logs/:logId/convert
// @access  Private
exports.markLogAsConverted = async (req, res, next) => {
  try {
    const { logId } = req.params;
    const { conversionValue } = req.body;
    
    const log = await CommunicationLog.findOne({ _id: logId, workspaceId: req.workspaceId });
    if (!log) {
      return error(res, 'Communication log not found', 404);
    }
    
    if (log.converted) {
      return error(res, 'This communication is already marked as converted', 400);
    }
    
    // Update log
    log.converted = true;
    log.convertedAt = new Date();
    log.conversionValue = Number(conversionValue) || 100;
    log.status = 'converted';
    log.statusHistory.push({
      status: 'converted',
      timestamp: new Date(),
      meta: { conversionValue: log.conversionValue }
    });
    
    await log.save();
    
    // Recalculate campaign statistics
    const stats = await updateCampaignStats(log.campaignId);
    
    return success(res, { log, stats }, 'Communication marked as converted successfully');
  } catch (err) {
    next(err);
  }
};
