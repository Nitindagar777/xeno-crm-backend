const { GoogleGenerativeAI } = require('@google/generative-ai');
const Customer = require('../models/Customer');
const Segment = require('../models/Segment');
const Campaign = require('../models/Campaign');
const CampaignStats = require('../models/CampaignStats');
const { resolveSegment } = require('../services/segmentEngine.service');
const { processAgentMessage, retryWithBackoff, generateWithFallback } = require('../services/geminiAgent.service');
const campaignController = require('./campaign.controller');
const env = require('../config/env');
const { success, error } = require('../utils/responseHelper');

// In-memory cache for suggestions and insights scoped by user ID
const cache = {
  suggestions: new Map(), // key: userId -> { data, timestamp }
  insights: new Map()     // key: userId -> { data, timestamp }
};

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache TTL

// Helper to clear AI suggestions and insights cache for a user
const clearUserCache = (userId) => {
  if (!userId) return;
  const key = userId.toString();
  cache.suggestions.delete(key);
  cache.insights.delete(key);
  console.log(`[AI Cache Invalidated] User: ${key}`);
};
exports.clearUserCache = clearUserCache;

// Helper to compile DB context for Gemini scoped to user/role
const getDbContext = async (userId, role) => {
  const query = role === 'admin' ? {} : { userId };
  const totalCustomers = await Customer.countDocuments(query);
  
  // Calculate average spend, order counts, and top cities
  const statsAggregate = await Customer.aggregate([
    { $match: query },
    {
      $group: {
        _id: null,
        avgSpend: { $avg: '$totalSpend' },
        avgOrders: { $avg: '$orderCount' }
      }
    }
  ]);

  const topCities = await Customer.aggregate([
    { $match: query },
    { $group: { _id: '$city', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 3 }
  ]);

  // Fetch all unique tags and cities for this user/role to expose to Gemini schema visibility
  const allTags = await Customer.distinct('tags', query);
  const allCities = await Customer.distinct('city', query);

  // Fetch unique custom fields keys from a sample of recent customers (robust and safe)
  const sampleCustomers = await Customer.find({ ...query, customFields: { $exists: true } }).limit(100).select('customFields');
  const customFieldKeys = Array.from(new Set(sampleCustomers.flatMap(c => c.customFields ? Object.keys(c.customFields) : [])));

  // Query specific cohort metrics for AI proactive segments
  const cutOff60 = new Date();
  cutOff60.setDate(cutOff60.getDate() - 60);
  const churnRiskCount = await Customer.countDocuments({
    ...query,
    lastOrderDate: { $lte: cutOff60 },
    orderCount: { $gt: 1 }
  });

  const cutOff45 = new Date();
  cutOff45.setDate(cutOff45.getDate() - 45);
  const highValueInactiveCount = await Customer.countDocuments({
    ...query,
    totalSpend: { $gt: 10000 },
    lastOrderDate: { $lte: cutOff45 }
  });

  const cutOff7 = new Date();
  cutOff7.setDate(cutOff7.getDate() - 7);
  const newThisWeekCount = await Customer.countDocuments({
    ...query,
    createdAt: { $gte: cutOff7 }
  });

  const oneTimeBuyersCount = await Customer.countDocuments({
    ...query,
    orderCount: 1
  });

  const customerStats = {
    avgSpend: statsAggregate[0] ? parseFloat(statsAggregate[0].avgSpend.toFixed(2)) : 0,
    avgOrderCount: statsAggregate[0] ? parseFloat(statsAggregate[0].avgOrders.toFixed(2)) : 0,
    topCities: topCities.map(c => c._id).filter(Boolean),
    allTags,
    allCities,
    customFieldKeys,
    churnRiskCount,
    highValueInactiveCount,
    newThisWeekCount,
    oneTimeBuyersCount
  };

  const topSegments = await Segment.find(query).select('name audienceCount').limit(3);
  
  const recentCampaignsRaw = await Campaign.find(query).sort({ createdAt: -1 }).limit(5);
  const recentCampaigns = [];
  for (const c of recentCampaignsRaw) {
    const statsQuery = role === 'admin' ? { campaignId: c._id } : { campaignId: c._id, userId };
    const stats = await CampaignStats.findOne(statsQuery);
    recentCampaigns.push({
      name: c.name,
      channel: c.channel,
      status: c.status,
      audienceCount: stats ? stats.total : 0,
      deliveryRate: stats ? stats.deliveryRate : 0
    });
  }

  return {
    totalCustomers,
    customerStats,
    topSegments,
    recentCampaigns
  };
};

// @desc    Post message to AI Agent
// @route   POST /api/agent/message
// @access  Private
exports.sendMessage = async (req, res, next) => {
  const { message, agentContext } = req.body;

  if (!message) {
    return error(res, 'Message is required', 400);
  }

  const defaultContext = {
    intent: null,
    segmentPlan: null,
    messagePlan: null,
    channelPlan: null,
    approvals: { segment: false, message: false, channel: false },
    resolvedAudienceCount: 0,
    campaignCreated: false,
    currentStep: 'UNDERSTAND_INTENT'
  };

  const activeContext = agentContext || defaultContext;

  try {
    const dbContext = await getDbContext(req.user._id, req.user.role);
    
    // Call Gemini Agent service
    const agentResult = await processAgentMessage(message, activeContext, dbContext);

    // If segment plan is extracted/changed, resolve its size using Segment Engine
    if (agentResult.agentContext.segmentPlan) {
      try {
        const resolveUserId = req.user.role === 'admin' ? undefined : req.user._id;
        const { audienceCount } = await resolveSegment(agentResult.agentContext.segmentPlan, resolveUserId);
        agentResult.agentContext.resolvedAudienceCount = audienceCount;
      } catch (segErr) {
        console.error('AI generated segment rules fail resolution:', segErr.message);
      }
    }

    // Handle Campaign Creation & Launch Action
    if (agentResult.action === 'LAUNCH') {
      try {
        // Create Segment Document
        const segment = new Segment({
          userId: req.user._id,
          name: agentResult.agentContext.segmentName || `Segment: AI Campaign (${new Date().toLocaleDateString('en-IN')})`,
          description: agentResult.agentContext.segmentDesc || `Automatically created by AI for intent: "${agentResult.agentContext.intent}"`,
          rules: agentResult.agentContext.segmentPlan,
          createdBy: 'ai',
          aiPrompt: agentResult.agentContext.intent
        });
        
        const resolveUserId = req.user.role === 'admin' ? undefined : req.user._id;
        const { audienceIds, audienceCount } = await resolveSegment(agentResult.agentContext.segmentPlan, resolveUserId);
        segment.audienceIds = audienceIds;
        segment.audienceCount = audienceCount;
        await segment.save();

        // Create Campaign Document
        const campaign = new Campaign({
          userId: req.user._id,
          name: agentResult.agentContext.campaignName || `Campaign: AI - ${segment.name.replace('Segment: ', '')}`,
          segmentId: segment._id,
          messageTemplate: agentResult.agentContext.messagePlan,
          channel: agentResult.agentContext.channelPlan,
          status: 'draft',
          createdBy: 'ai',
          aiContext: `Prompt Intent: ${agentResult.agentContext.intent}`
        });
        await campaign.save();
        clearUserCache(req.user._id);

        agentResult.agentContext.campaignCreated = true;
        agentResult.agentContext.campaignId = campaign._id;
        agentResult.agentContext.currentStep = 'EXECUTING';

        // Initiate campaign send asynchronously using sendCampaign mock req
        const mockReq = { 
          params: { id: campaign._id.toString() },
          user: { _id: req.user._id, role: req.user.role }
        };
        const mockRes = {
          status: () => ({ json: () => {} }) // Stub response
        };
        
        // Trigger campaign execution
        campaignController.sendCampaign(mockReq, mockRes, (err) => {
          if (err) console.error('Asynchronous campaign trigger fail:', err);
        });

        agentResult.reply += `\n\n🚀 **Campaign successfully launched!**\n- Campaign ID: [${campaign.name}](file:///campaigns/${campaign._id})\n- Target Segment: ${segment.name} (${audienceCount} customers)\n- Channel: ${campaign.channel.toUpperCase()}`;
        
      } catch (launchErr) {
        console.error('AI Campaign Launch failed:', launchErr);
        agentResult.reply += `\n\n❌ Failed to launch campaign automatically: ${launchErr.message}`;
      }
    }

    return success(res, agentResult, 'Agent response generated successfully');
  } catch (err) {
    next(err);
  }
};

// @desc    Approve a conversation step
// @route   POST /api/agent/approve
// @access  Private
exports.approveStep = async (req, res, next) => {
  const { step, agentContext, editedData } = req.body;

  if (!step || !agentContext) {
    return error(res, 'Step and agentContext are required', 400);
  }

  try {
    const updatedContext = { ...agentContext };

    // Support fast 1-click launch flow
    if (step === 'campaign') {
      try {
        // Create Segment Document
        const segment = new Segment({
          userId: req.user._id,
          name: updatedContext.segmentName || `Segment: AI Campaign (${new Date().toLocaleDateString('en-IN')})`,
          description: updatedContext.segmentDesc || `Automatically created by AI for intent: "${updatedContext.intent || 'Campaign'}"`,
          rules: updatedContext.segmentPlan,
          createdBy: 'ai',
          aiPrompt: updatedContext.intent
        });
        
        const resolveUserId = req.user.role === 'admin' ? undefined : req.user._id;
        const { audienceIds, audienceCount } = await resolveSegment(updatedContext.segmentPlan, resolveUserId);
        segment.audienceIds = audienceIds;
        segment.audienceCount = audienceCount;
        await segment.save();

        // Create Campaign Document
        const campaign = new Campaign({
          userId: req.user._id,
          name: updatedContext.campaignName || `Campaign: AI - ${segment.name.replace('Segment: ', '')}`,
          segmentId: segment._id,
          messageTemplate: updatedContext.messagePlan,
          channel: updatedContext.channelPlan,
          status: 'draft',
          createdBy: 'ai',
          aiContext: `Prompt Intent: ${updatedContext.intent}`
        });
        await campaign.save();
        clearUserCache(req.user._id);

        updatedContext.campaignCreated = true;
        updatedContext.campaignId = campaign._id;
        updatedContext.currentStep = 'EXECUTING';
        updatedContext.approvals = { segment: true, message: true, channel: true };

        // Initiate campaign send asynchronously using sendCampaign mock req
        const mockReq = { 
          params: { id: campaign._id.toString() },
          user: { _id: req.user._id, role: req.user.role }
        };
        const mockRes = {
          status: () => ({ json: () => {} }) // Stub response
        };
        
        // Trigger campaign execution
        campaignController.sendCampaign(mockReq, mockRes, (err) => {
          if (err) console.error('Asynchronous campaign trigger fail:', err);
        });

        const replyText = `🚀 **Campaign successfully launched!**\n- Campaign ID: [${campaign.name}](file:///campaigns/${campaign._id})\n- Target Segment: ${segment.name} (${audienceCount} customers)\n- Channel: ${campaign.channel.toUpperCase()}`;

        return success(res, { 
          agentContext: updatedContext,
          reply: replyText
        }, 'Campaign launched successfully');
      } catch (launchErr) {
        console.error('AI Campaign Launch failed:', launchErr);
        return error(res, `Failed to launch campaign: ${launchErr.message}`, 500);
      }
    }

    if (step === 'segment') {
      updatedContext.approvals.segment = true;
      if (editedData) {
        updatedContext.segmentPlan = editedData;
      }
      
      const resolveUserId = req.user.role === 'admin' ? undefined : req.user._id;
      const { audienceIds, audienceCount } = await resolveSegment(updatedContext.segmentPlan, resolveUserId);
      updatedContext.resolvedAudienceCount = audienceCount;

      // Segment-only request (if no message plan or channel plan are drafted)
      if (!updatedContext.messagePlan && !updatedContext.channelPlan) {
        try {
          const segment = new Segment({
            userId: req.user._id,
            name: updatedContext.segmentName || `Segment: AI Generated (${new Date().toLocaleDateString('en-IN')})`,
            description: updatedContext.segmentDesc || `Automatically created by AI for intent: "${updatedContext.intent || 'Segment'}"`,
            rules: updatedContext.segmentPlan,
            createdBy: 'ai',
            aiPrompt: updatedContext.intent,
            audienceIds,
            audienceCount
          });
          await segment.save();
          clearUserCache(req.user._id);

          updatedContext.currentStep = 'COMPLETED';
          
          const replyText = `✅ **Segment created successfully!**\n- Segment: [${segment.name}](file:///segments)\n- Audience Count: ${audienceCount} customers`;

          return success(res, {
            agentContext: updatedContext,
            segmentId: segment._id,
            reply: replyText
          }, 'Segment created successfully');
        } catch (segErr) {
          console.error('AI Segment Save failed:', segErr);
          return error(res, `Failed to save segment: ${segErr.message}`, 500);
        }
      } else {
        updatedContext.currentStep = 'PROPOSE_MESSAGE';
      }
    } else if (step === 'message') {
      updatedContext.approvals.message = true;
      if (editedData) {
        updatedContext.messagePlan = editedData;
      }
      updatedContext.currentStep = 'PROPOSE_CHANNEL';
    } else if (step === 'channel') {
      updatedContext.approvals.channel = true;
      if (editedData) {
        updatedContext.channelPlan = editedData.toLowerCase();
      }
      updatedContext.currentStep = 'CONFIRM_LAUNCH';
    }

    return success(res, { agentContext: updatedContext }, `Step ${step} approved successfully`);
  } catch (err) {
    next(err);
  }
};

// @desc    Get AI campaign suggestions
// @route   GET /api/agent/suggestions
// @access  Private
exports.getSuggestions = async (req, res, next) => {
  const cacheKey = req.user._id.toString();
  const cached = cache.suggestions.get(cacheKey);
  const now = Date.now();

  if (cached && (now - cached.timestamp < CACHE_TTL)) {
    console.log(`[Suggestions Cache Hit] User: ${cacheKey}`);
    return success(res, cached.data, 'Campaign suggestions fetched from cache');
  }

  try {
    const dbContext = await getDbContext(req.user._id, req.user.role);
    let suggestions = [];

    // Attempt to fetch from Gemini if API key exists
    if (env.GEMINI_API_KEY) {
      try {
        const prompt = `
Based on this customer data summary, suggest 3 targeted CRM marketing campaign prompts.
DATA CONTEXT:
- Total Customers: ${dbContext.totalCustomers}
- Avg Spend: ₹${dbContext.customerStats.avgSpend}
- Avg Order Count: ${dbContext.customerStats.avgOrderCount}
- Top Cities: ${dbContext.customerStats.topCities.join(', ')}

Output exactly 3 suggestions in a clean JSON format. Each suggestion must contain:
1. "title": Short catchy title.
2. "prompt": The text prompt the user should type to launch this campaign.

Respond with ONLY the JSON array, no other text or markup.
`;

        const result = await generateWithFallback(prompt);
        let responseText = result.response.text().trim();
        responseText = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();
        suggestions = JSON.parse(responseText);
      } catch (apiErr) {
        console.warn('Gemini API call failed for suggestions, using fallback. Error:', apiErr.message);
      }
    }

    // Default Fallback Suggestions
    if (!suggestions || suggestions.length === 0) {
      suggestions = [
        { title: "Win back inactive high-spenders", prompt: "Target VIP customers who spent over ₹15,000 but haven't bought in 60 days" },
        { title: "Welcome new customers", prompt: "Send a special greeting with coupon to customers who registered this week" },
        { title: "Local promo in top cities", prompt: "Run an exclusive local offer for our customers based in Mumbai and Delhi" }
      ];
    }

    // Cache results to prevent rate limiting
    cache.suggestions.set(cacheKey, { data: suggestions, timestamp: now });

    return success(res, suggestions, 'Campaign suggestions fetched successfully');
  } catch (err) {
    next(err);
  }
};

// @desc    Get proactive AI-powered insights
// @route   GET /api/agent/insights
// @access  Private
exports.getInsights = async (req, res, next) => {
  const cacheKey = req.user._id.toString();
  const cached = cache.insights.get(cacheKey);
  const now = Date.now();

  if (cached && (now - cached.timestamp < CACHE_TTL)) {
    console.log(`[Insights Cache Hit] User: ${cacheKey}`);
    return success(res, cached.data, 'Insights fetched from cache');
  }

  try {
    const matchQuery = req.user.role === 'admin' ? {} : { userId: req.user._id };
    
    // 1. Churn risk (lastOrderDate > 60 days ago and orderCount > 2)
    const cutOff60 = new Date();
    cutOff60.setDate(cutOff60.getDate() - 60);
    const churnRiskCount = await Customer.countDocuments({
      ...matchQuery,
      lastOrderDate: { $lte: cutOff60 },
      orderCount: { $gt: 2 }
    });

    // 2. High-value inactive (spend > 10000, lastOrderDate > 45 days)
    const cutOff45 = new Date();
    cutOff45.setDate(cutOff45.getDate() - 45);
    const highValueInactive = await Customer.countDocuments({
      ...matchQuery,
      totalSpend: { $gt: 10000 },
      lastOrderDate: { $lte: cutOff45 }
    });

    // 3. New customers (createdAt in last 7 days)
    const cutOff7 = new Date();
    cutOff7.setDate(cutOff7.getDate() - 7);
    const newCustomers = await Customer.countDocuments({
      ...matchQuery,
      createdAt: { $gte: cutOff7 }
    });

    // 4. Frequent buyers (orderCount >= 5, lastOrderDate within 30 days)
    const cutOff30 = new Date();
    cutOff30.setDate(cutOff30.getDate() - 30);
    const frequentBuyers = await Customer.countDocuments({
      ...matchQuery,
      orderCount: { $gte: 5 },
      lastOrderDate: { $gte: cutOff30 }
    });

    // 5. One-time buyers
    const oneTimeBuyers = await Customer.countDocuments({
      ...matchQuery,
      orderCount: 1
    });

    let insights = [];

    // Attempt to fetch from Gemini if API key exists
    if (env.GEMINI_API_KEY) {
      try {
        const prompt = `
Generate 5 AI-powered CRM insights for a D2C fashion brand based on these exact customer metrics:
- Churn Risk Customers (Spenders who haven't ordered in 60+ days): ${churnRiskCount}
- High-Value Inactive Customers (Spent > ₹10k, inactive 45+ days): ${highValueInactive}
- New customers this week: ${newCustomers}
- Active frequent buyers: ${frequentBuyers}
- One-time buyers: ${oneTimeBuyers}

Format the response as a valid JSON array of 5 objects. Each object must have:
- "title": string (e.g. "VIP Churn Alert")
- "description": string (e.g. "We have 24 VIP customers who haven't made a purchase in 45 days. They are at risk of churning.")
- "audienceSize": number (matching the corresponding metric value)
- "urgency": "high" | "medium" | "low"
- "suggestedAction": string (description of recommendation)
- "prebuiltPrompt": string (the command/prompt a user can click to launch this campaign, e.g. "Target VIP customers spent > 10000 inactive > 45 days")

Respond with ONLY the JSON array. No extra text.
`;

        const result = await generateWithFallback(prompt);
        let responseText = result.response.text().trim();
        responseText = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();
        insights = JSON.parse(responseText);
      } catch (apiErr) {
        console.warn('Gemini API call failed for insights (after retries), using fallback. Error:', apiErr.message);
      }
    }

    // Default Fallback Insights
    if (!insights || insights.length === 0) {
      insights = [
        {
          title: "At-Risk Loyalists",
          description: `We detected ${churnRiskCount} regular shoppers who haven't bought anything in the last 60 days.`,
          audienceSize: churnRiskCount,
          urgency: "high",
          suggestedAction: "Run a re-engagement coupon campaign via WhatsApp.",
          prebuiltPrompt: "Target active customer churn risk"
        },
        {
          title: "Dormant VIPs",
          description: `${highValueInactive} high-spending customers have been inactive for over 45 days.`,
          audienceSize: highValueInactive,
          urgency: "high",
          suggestedAction: "Send a personalized concierge catalog or 20% discount offer.",
          prebuiltPrompt: "Target high value inactive customers"
        },
        {
          title: "New Customer Onboarding",
          description: `${newCustomers} new shoppers registered in the past 7 days and need welcoming.`,
          audienceSize: newCustomers,
          urgency: "medium",
          suggestedAction: "Trigger an automated Email series with a 10% welcome coupon.",
          prebuiltPrompt: "Target customers registered in the last 7 days"
        },
        {
          title: "VIP Reward Opportunity",
          description: `There are ${frequentBuyers} frequent buyers who made purchases in the last 30 days.`,
          audienceSize: frequentBuyers,
          urgency: "low",
          suggestedAction: "Offer early access to the upcoming collection drop.",
          prebuiltPrompt: "Target loyal active buyers"
        },
        {
          title: "Convert One-Time Buyers",
          description: `We have ${oneTimeBuyers} shoppers who only bought once.`,
          audienceSize: oneTimeBuyers,
          urgency: "medium",
          suggestedAction: "Recommend complementary products based on their initial order.",
          prebuiltPrompt: "Target one time buyers and recommend products"
        }
      ];
    }

    // Cache insights to prevent rate limits
    cache.insights.set(cacheKey, { data: insights, timestamp: now });

    return success(res, insights, 'Insights fetched successfully');
  } catch (err) {
    next(err);
  }
};
