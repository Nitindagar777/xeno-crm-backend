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

// @desc    Get all campaigns
// @route   GET /api/campaigns
// @access  Private
exports.getCampaigns = async (req, res, next) => {
  try {
    const statusFilter = req.query.status;
    let query = req.user.role === 'admin' ? {} : { userId: req.user._id };
    if (statusFilter) {
      query.status = statusFilter;
    }

    const campaigns = await Campaign.find(query)
      .populate('segmentId', 'name audienceCount')
      .sort({ createdAt: -1 });

    // Attach statistics summary if available
    const campaignList = await Promise.all(campaigns.map(async (c) => {
      const statsQuery = req.user.role === 'admin' ? { campaignId: c._id } : { campaignId: c._id, userId: req.user._id };
      const stats = await CampaignStats.findOne(statsQuery);
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
    const query = req.user.role === 'admin' ? { _id: req.params.id } : { _id: req.params.id, userId: req.user._id };
    const campaign = await Campaign.findOne(query).populate('segmentId');
    if (!campaign) {
      return error(res, 'Campaign not found', 404);
    }

    const statsQuery = req.user.role === 'admin' ? { campaignId: campaign._id } : { campaignId: campaign._id, userId: req.user._id };
    const stats = await CampaignStats.findOne(statsQuery);

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

    // Verify segment exists and belongs to the user (bypass scoping if admin)
    const segmentQuery = req.user.role === 'admin' ? { _id: segmentId } : { _id: segmentId, userId: req.user._id };
    const segment = await Segment.findOne(segmentQuery);
    if (!segment) {
      return error(res, 'Segment not found', 404);
    }

    const campaign = new Campaign({
      userId: req.user._id,
      name,
      segmentId,
      messageTemplate,
      channel,
      status: 'draft',
      createdBy: createdBy || 'manual',
      aiContext
    });

    await campaign.save();
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

    const query = req.user.role === 'admin' ? { _id: req.params.id } : { _id: req.params.id, userId: req.user._id };
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
      const segmentQuery = req.user.role === 'admin' ? { _id: segmentId } : { _id: segmentId, userId: req.user._id };
      const segment = await Segment.findOne(segmentQuery);
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
    const query = req.user.role === 'admin' ? { _id: req.params.id } : { _id: req.params.id, userId: req.user._id };
    const campaign = await Campaign.findOne(query);
    if (!campaign) {
      return error(res, 'Campaign not found', 404);
    }

    if (campaign.status !== 'draft') {
      return error(res, 'Only draft campaigns can be deleted', 400);
    }

    const statsQuery = req.user.role === 'admin' ? { campaignId: campaign._id } : { campaignId: campaign._id, userId: req.user._id };
    await CampaignStats.deleteOne(statsQuery);

    const logQuery = req.user.role === 'admin' ? { campaignId: campaign._id } : { campaignId: campaign._id, userId: req.user._id };
    await CommunicationLog.deleteMany(logQuery);
    
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
    const query = req.user.role === 'admin' ? { _id: req.params.id } : { _id: req.params.id, userId: req.user._id };
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

        // Schedule the send for the future time
        const delay = scheduledTime.getTime() - Date.now();
        setTimeout(async () => {
          try {
            // Re-fetch the campaign to check if it's still scheduled
            const freshCampaign = await Campaign.findById(campaign._id);
            if (freshCampaign && freshCampaign.status === 'scheduled') {
              // Trigger the send by making an internal request-like call
              // We simulate the send by directly executing the send logic
              const segQuery = { _id: freshCampaign.segmentId };
              const seg = await Segment.findOne(segQuery);
              if (!seg || seg.audienceIds.length === 0) {
                console.error('[Scheduled Campaign] Segment empty or not found for campaign', freshCampaign._id);
                return;
              }
              const custs = await Customer.find({ _id: { $in: seg.audienceIds } });
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

              // Background send (same batching logic)
              const batchSize = 50;
              const delayBetweenBatches = 100;
              const callbackUrl = `${env.CLIENT_URL.replace('5173', '5000')}/api/campaigns/receipt`;
              const actualCallbackUrl = callbackUrl.includes('localhost') ? 'http://localhost:5000/api/campaigns/receipt' : callbackUrl;

              for (let i = 0; i < custs.length; i += batchSize) {
                const batch = custs.slice(i, i + batchSize);
                const promises = batch.map(async (customer) => {
                  const personalizedMessage = personalizeMessage(freshCampaign.messageTemplate, customer);
                  const log = new CommunicationLog({
                    userId: freshCampaign.userId,
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
                      customerId: customer._id.toString(),
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

    // Load segment and populated audience scoped to user/role
    const segmentQuery = req.user.role === 'admin' ? { _id: campaign.segmentId } : { _id: campaign.segmentId, userId: req.user._id };
    const segment = await Segment.findOne(segmentQuery);
    if (!segment || segment.audienceIds.length === 0) {
      return error(res, 'Segment does not exist or has 0 customers', 400);
    }

    // Load all customers in the segment scoped to user/role
    const customerQuery = req.user.role === 'admin' ? { _id: { $in: segment.audienceIds } } : { _id: { $in: segment.audienceIds }, userId: req.user._id };
    const customers = await Customer.find(customerQuery);

    // Update campaign status to running
    campaign.status = 'running';
    campaign.startedAt = new Date();
    await campaign.save();

    // Initialize CampaignStats scoped to user
    const initialStats = new CampaignStats({
      userId: req.user._id,
      campaignId: campaign._id,
      total: customers.length,
      queued: customers.length
    });
    await initialStats.save();

    // Respond immediately to prevent HTTP timeouts
    success(res, { totalQueued: customers.length }, 'Campaign execution initiated', 200);

    // Run async batching process in background
    (async () => {
      const batchSize = 50;
      const delayBetweenBatches = 100; // 100ms
      const callbackUrl = `${env.CLIENT_URL.replace('5173', '5000')}/api/campaigns/receipt`; 
      // Hardcoded fallback for localhost to guarantee it finds it
      const actualCallbackUrl = callbackUrl.includes('localhost') ? 'http://localhost:5000/api/campaigns/receipt' : callbackUrl;

      for (let i = 0; i < customers.length; i += batchSize) {
        const batch = customers.slice(i, i + batchSize);
        
        const promises = batch.map(async (customer) => {
          const personalizedMessage = personalizeMessage(campaign.messageTemplate, customer);
          
          // Create CommunicationLog scoped to user
          const log = new CommunicationLog({
            userId: req.user._id,
            campaignId: campaign._id,
            customerId: customer._id,
            personalizedMessage,
            channel: campaign.channel,
            status: 'queued',
            statusHistory: [{ status: 'queued', timestamp: new Date() }]
          });
          await log.save();

          try {
            // Send request to channel-service
            const sendResponse = await axios.post(`${env.CHANNEL_SERVICE_URL}/api/channel/send`, {
              campaignId: campaign._id.toString(),
              customerId: customer._id.toString(),
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

        // Resolve batch
        await Promise.allSettled(promises);
        
        // Update stats after batch
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

  const { vendorMessageId, campaignId, customerId, status, timestamp, meta } = req.body;

  if (!vendorMessageId || !status) {
    return res.status(400).json({ success: false, error: 'Missing vendorMessageId or status' });
  }

  try {
    const log = await CommunicationLog.findOne({ vendorMessageId });
    if (!log) {
      return res.status(404).json({ success: false, error: 'Communication log not found' });
    }

    // Status precedence order to prevent out-of-order callback regressions
    const statusOrder = {
      'queued': 1,
      'sent': 2,
      'delivered': 3,
      'failed': 3, // terminal status
      'opened': 4,
      'read': 5,
      'clicked': 6
    };

    const currentPrecedence = statusOrder[log.status] || 0;
    const newPrecedence = statusOrder[status] || 0;

    // Only update if the new status represents progress in lifecycle
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

      // Recalculate stats
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

    // Verify campaign belongs to the user (bypass scoping if admin)
    const query = req.user.role === 'admin' ? { _id: req.params.id } : { _id: req.params.id, userId: req.user._id };
    const campaign = await Campaign.findOne(query);
    if (!campaign) {
      return error(res, 'Campaign not found', 404);
    }

    let logQuery = req.user.role === 'admin' ? { campaignId: new mongoose.Types.ObjectId(req.params.id) } : { campaignId: new mongoose.Types.ObjectId(req.params.id), userId: req.user._id };
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
    // Verify campaign belongs to the user (bypass scoping if admin)
    const query = req.user.role === 'admin' ? { _id: req.params.id } : { _id: req.params.id, userId: req.user._id };
    const campaign = await Campaign.findOne(query);
    if (!campaign) {
      return error(res, 'Campaign not found', 404);
    }

    const statsQuery = req.user.role === 'admin' ? { campaignId: req.params.id } : { campaignId: req.params.id, userId: req.user._id };
    let stats = await CampaignStats.findOne(statsQuery);
    
    if (!stats) {
      // Lazy initialize stats if none exists yet
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
    const query = req.user.role === 'admin' ? { _id: req.params.id } : { _id: req.params.id, userId: req.user._id };
    const campaign = await Campaign.findOne(query);
    if (!campaign) {
      return error(res, 'Campaign not found', 404);
    }

    // Return cached analysis if available
    if (campaign.aiAnalysis) {
      return success(res, { analysis: campaign.aiAnalysis, cached: true }, 'Campaign analysis fetched successfully');
    }

    // Only allow analysis for completed campaigns
    if (campaign.status !== 'completed') {
      return error(res, 'AI analysis is only available for completed campaigns', 400);
    }

    // Fetch campaign stats
    const statsQuery = req.user.role === 'admin' ? { campaignId: campaign._id } : { campaignId: campaign._id, userId: req.user._id };
    const stats = await CampaignStats.findOne(statsQuery);

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
      // Fallback analysis based on stats
      const issues = [];
      if (stats.deliveryRate < 90) issues.push(`Delivery rate is low at ${stats.deliveryRate}%. Consider cleaning your contact list and verifying ${campaign.channel} addresses.`);
      if (stats.openRate < 20) issues.push(`Open rate of ${stats.openRate}% is below average. Try more compelling subject lines or sending at optimal times.`);
      if (stats.clickRate < 5) issues.push(`Click rate of ${stats.clickRate}% suggests the content may not be engaging enough. Consider stronger CTAs and personalization.`);
      if (stats.converted === 0) issues.push('No conversions were attributed to this campaign. Consider retargeting engaged users with follow-up offers.');
      if (issues.length === 0) issues.push('Campaign performed well across all metrics. Consider scaling this approach to larger segments.');
      analysisText = issues.join(' ');
    }

    // Cache the analysis
    campaign.aiAnalysis = analysisText;
    await campaign.save();

    return success(res, { analysis: analysisText, cached: false }, 'Campaign analysis generated successfully');
  } catch (err) {
    next(err);
  }
};
