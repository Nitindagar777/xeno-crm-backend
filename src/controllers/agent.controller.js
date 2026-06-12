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
const AILearningPattern = require('../models/AILearningPattern');

// Helper to extract JSON array from text responses
const extractJsonArray = (text) => {
  if (!text) return '';
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start !== -1 && end !== -1 && end > start) {
    return text.substring(start, end + 1).trim();
  }
  return text.trim();
};

// Learning from successful Gemini output
const learnFromSuccess = async (prompt, data) => {
  try {
    if (!prompt || !data || !data.segmentRules) return;
    
    const cleanPrompt = prompt.toLowerCase().trim();
    // Check if we already have a direct match to prevent duplicates
    const existing = await AILearningPattern.findOne({ prompt: cleanPrompt });
    if (existing) return;

    // Helper to get keywords
    const keywords = cleanPrompt
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2 && !['the', 'and', 'for', 'who', 'with', 'from', 'than', 'target', 'segment', 'campaign'].includes(w));

    const pattern = new AILearningPattern({
      prompt: cleanPrompt,
      keywords,
      segmentRules: data.segmentRules,
      segmentName: data.segmentName || 'VIP Segment',
      segmentDesc: data.segmentDesc || 'VIP Segment description',
      campaignName: data.campaignName || 'Campaign Promotion',
      messageTemplate: data.messageTemplate || 'Hi {{firstName}}!',
      channel: data.channel || 'whatsapp'
    });
    
    await pattern.save();
    console.log(`[AI Fallback Learning] Learned new pattern for: "${cleanPrompt}"`);
  } catch (err) {
    console.error('[AI Fallback Learning Error]:', err.message);
  }
};

// Database matching lookup for fallback
const matchLearnedFallback = async (userMessage) => {
  try {
    const cleanPrompt = userMessage.toLowerCase().trim();
    
    // 1. Direct match
    const directMatch = await AILearningPattern.findOne({ prompt: cleanPrompt });
    if (directMatch) {
      console.log(`[AI Fallback Match] Exact match found for: "${cleanPrompt}"`);
      return {
        segmentRules: directMatch.segmentRules,
        segmentName: directMatch.segmentName,
        segmentDesc: directMatch.segmentDesc,
        campaignName: directMatch.campaignName,
        messageTemplate: directMatch.messageTemplate,
        channel: directMatch.channel
      };
    }

    // 2. Keyword overlap match
    const inputKeywords = cleanPrompt
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2 && !['the', 'and', 'for', 'who', 'with', 'from', 'than', 'target', 'segment', 'campaign'].includes(w));

    if (inputKeywords.length === 0) return null;

    // Fetch all patterns to find overlap
    const allPatterns = await AILearningPattern.find({});
    let bestMatch = null;
    let maxOverlap = 0;

    for (const pattern of allPatterns) {
      const overlap = pattern.keywords.filter(k => inputKeywords.includes(k)).length;
      if (overlap > maxOverlap) {
        maxOverlap = overlap;
        bestMatch = pattern;
      }
    }

    // If we have at least 50% keyword overlap, use it!
    if (bestMatch && (maxOverlap / Math.max(bestMatch.keywords.length, 1)) >= 0.5) {
      console.log(`[AI Fallback Match] Keyword overlap match found (${maxOverlap} keys) for: "${cleanPrompt}"`);
      return {
        segmentRules: bestMatch.segmentRules,
        segmentName: bestMatch.segmentName,
        segmentDesc: bestMatch.segmentDesc,
        campaignName: bestMatch.campaignName,
        messageTemplate: bestMatch.messageTemplate,
        channel: bestMatch.channel
      };
    }
  } catch (err) {
    console.error('[AI Fallback Match Error]:', err.message);
  }
  return null;
};

// Procedural keyword parser fallback
const generateProceduralFallback = (userMessage, dbContext) => {
  const messageLower = userMessage.toLowerCase();
  const conditions = [];

  // 0. Email matching (highest priority for specific user targeting)
  const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i;
  const emailMatch = userMessage.match(emailRegex);
  if (emailMatch) {
    conditions.push({ field: "email", operator: "eq", value: emailMatch[1].toLowerCase().trim() });
  }

  // Name matching (secondary priority)
  let cleanName = "";
  const nameMatch = userMessage.match(/name\s+([a-zA-Z\s]+?)(?:\s+and|\s+with|\s+spent|\s+located|\s*\(|\s*$)/i) || 
                    userMessage.match(/target\s+([a-zA-Z\s]+?)(?:\s+with|\s+spent|\s+located|\s+[\w.-]+@|\s*$)/i);
  if (nameMatch) {
    cleanName = nameMatch[1].trim();
    const cleanNameLower = cleanName.toLowerCase();
    if (!emailMatch && !['customer', 'user', 'shopper', 'segment', 'campaign'].includes(cleanNameLower)) {
      conditions.push({ field: "name", operator: "eq", value: cleanName });
    }
  }

  // Extract target limit (e.g., target 5 users, limit to 10 customers)
  let limitValue = undefined;
  const limitMatch = userMessage.match(/(?:limit(?:\s+to)?|target)\s+(\d+)\s+(?:users|shoppers|customers|people)/i) ||
                     userMessage.match(/(?:only)\s+(\d+)\s+(?:users|shoppers|customers|people)/i) ||
                     userMessage.match(/(\d+)\s+(?:users|shoppers|customers|people)/i);
  if (limitMatch) {
    limitValue = parseInt(limitMatch[1], 10);
  }

  // 1. Tag matching
  const allTags = dbContext.customerStats.allTags || [];
  allTags.forEach(tag => {
    if (messageLower.includes(tag.toLowerCase())) {
      conditions.push({ field: "tags", operator: "contains", value: tag });
    }
  });

  // 2. City matching
  const allCities = dbContext.customerStats.allCities || [];
  const matchedCities = [];
  allCities.forEach(city => {
    if (messageLower.includes(city.toLowerCase())) {
      matchedCities.push(city);
    }
  });
  if (matchedCities.length > 0) {
    conditions.push({ field: "city", operator: "in", value: matchedCities });
  }

  // 3. Gender matching
  if (messageLower.includes("female") || messageLower.includes("women") || messageLower.includes("girls")) {
    conditions.push({ field: "gender", operator: "eq", value: "female" });
  } else if (messageLower.includes("male") || messageLower.includes("men") || messageLower.includes("boys")) {
    conditions.push({ field: "gender", operator: "eq", value: "male" });
  }

  // 4. Spend, orders, and days parsing
  const numberMatches = [...messageLower.matchAll(/\d+/g)].map(m => parseInt(m[0], 10));
  
  if (messageLower.includes("spend") || messageLower.includes("bought") || messageLower.includes("spent") || messageLower.includes("value") || messageLower.includes("rs") || messageLower.includes("inr") || messageLower.includes("₹")) {
    const spendVal = numberMatches.find(n => n >= 100);
    if (spendVal) {
      let op = "gte";
      if (messageLower.includes("under") || messageLower.includes("less") || messageLower.includes("below") || messageLower.includes("<")) {
        op = "lte";
      }
      conditions.push({ field: "totalSpend", operator: op, value: spendVal });
    }
  }

  if (messageLower.includes("order") || messageLower.includes("purchase") || messageLower.includes("bought") || messageLower.includes("transaction")) {
    const orderVal = numberMatches.find(n => n > 0 && n < 50);
    if (orderVal) {
      let op = "gte";
      if (messageLower.includes("under") || messageLower.includes("less") || messageLower.includes("below") || messageLower.includes("<") || messageLower.includes("only") || messageLower.includes("one")) {
        op = "lte";
      }
      if (messageLower.includes("equal") || messageLower.includes("exactly") || messageLower.includes("only")) {
        op = "eq";
      }
      conditions.push({ field: "orderCount", operator: op, value: orderVal });
    }
  }

  if (messageLower.includes("days") || messageLower.includes("inactive") || messageLower.includes("ago") || messageLower.includes("month") || messageLower.includes("week") || messageLower.includes("last order") || messageLower.includes("register") || messageLower.includes("join") || messageLower.includes("signup") || messageLower.includes("new")) {
    let daysVal = numberMatches.find(n => n > 0 && n < 366);
    if (messageLower.includes("month")) {
      const monthMatches = [...messageLower.matchAll(/(\d+)\s*month/g)];
      if (monthMatches.length > 0) {
        daysVal = parseInt(monthMatches[0][1], 10) * 30;
      } else if (messageLower.includes("a month") || messageLower.includes("one month")) {
        daysVal = 30;
      }
    } else if (messageLower.includes("week")) {
      const weekMatches = [...messageLower.matchAll(/(\d+)\s*week/g)];
      if (weekMatches.length > 0) {
        daysVal = parseInt(weekMatches[0][1], 10) * 7;
      } else if (messageLower.includes("a week") || messageLower.includes("one week")) {
        daysVal = 7;
      }
    }

    if (daysVal) {
      let op = "gte";
      if (messageLower.includes("within") || messageLower.includes("recent") || messageLower.includes("less") || messageLower.includes("under") || messageLower.includes("last")) {
        op = "lte";
      }
      const isRegistration = messageLower.includes("register") || messageLower.includes("join") || messageLower.includes("signup") || messageLower.includes("new");
      conditions.push({ 
        field: isRegistration ? "daysSinceRegistration" : "daysSinceLastOrder", 
        operator: op, 
        value: daysVal 
      });
    }
  }

  // If we couldn't detect anything, let's create a generic cohort
  if (conditions.length === 0) {
    conditions.push({ field: "orderCount", operator: "gte", value: 1 });
  }

  const segmentRules = { logic: "AND", conditions };
  if (limitValue !== undefined && !isNaN(limitValue)) {
    segmentRules.limit = limitValue;
  }

  let segmentName = `Segment: Dynamic Fallback (${new Date().toLocaleDateString('en-IN')})`;
  let segmentDesc = `Procedural segment generated for query: "${userMessage}"`;
  
  if (emailMatch && cleanName) {
    segmentName = `Target: ${cleanName}`;
    segmentDesc = `Targeting specific customer ${cleanName} (${emailMatch[1].toLowerCase().trim()})`;
  } else if (emailMatch) {
    segmentName = `Target: ${emailMatch[1].toLowerCase().trim()}`;
    segmentDesc = `Targeting customer with email ${emailMatch[1].toLowerCase().trim()}`;
  } else if (cleanName) {
    segmentName = `Target: ${cleanName}`;
    segmentDesc = `Targeting customer with name ${cleanName}`;
  } else if (limitValue) {
    segmentName = `Cohort: Limit ${limitValue} Users`;
    segmentDesc = `Segment limited to ${limitValue} users matching conditions: ${JSON.stringify(conditions)}`;
  }
  
  const campaignName = `Campaign: Lumière Promo - ${segmentName.replace('Segment: ', '').replace('Target: ', '')}`;
  
  // Extract offer details dynamically
  let offerPercent = "15%";
  const percentMatch = userMessage.match(/(\d+)\s*(?:%|percent)/i);
  if (percentMatch) {
    offerPercent = `${percentMatch[1]}%`;
  }
  
  let durationText = "";
  const durationMatch = userMessage.match(/(\d+)\s*(?:hr|hour|day)/i);
  if (durationMatch) {
    const val = durationMatch[1];
    const unit = durationMatch[0].includes('day') ? 'days' : (durationMatch[0].includes('hour') || durationMatch[0].includes('hr') ? 'hours' : durationMatch[0].trim());
    durationText = ` for the next ${val} ${unit}`;
  }

  let messageTemplate = `Hi {{firstName}}, elevate your style with Lumière! Enjoy an exclusive ${offerPercent} off our premium collection${durationText}. Use code LUMI${offerPercent.replace('%', '')}. Shop now: lumi.re/store`;
  
  if (emailMatch || cleanName) {
    const displayName = cleanName || (emailMatch ? emailMatch[1].split('@')[0] : 'there');
    messageTemplate = `Hi ${displayName}, exclusive treat just for you! Enjoy an exclusive ${offerPercent} off your next purchase at Lumière${durationText}. Use code LUMI${offerPercent.replace('%', '')} at checkout. Shop now: lumi.re/exclusive`;
  } else if (matchedCities.length > 0) {
    messageTemplate = `Hi {{firstName}}, exclusive treat for our friends in {{city}}! Get an extra ${offerPercent} off on our latest Lumière collection${durationText}. Use code LUMI${matchedCities[0].toUpperCase().slice(0, 4)}. Shop now: lumi.re/local`;
  } else if (messageLower.includes("inactive") || messageLower.includes("miss") || messageLower.includes("winback")) {
    messageTemplate = `Hi {{firstName}}, we miss you at Lumière! Here is a special ${offerPercent} off voucher${durationText}: WELCOMEBACK${offerPercent.replace('%', '')}. Re-discover your favorite styles today at lumi.re/missyou`;
  } else if (messageLower.includes("vip") || messageLower.includes("loyal") || messageLower.includes("high spender")) {
    messageTemplate = `Hi {{firstName}}, as a VIP member, you get early access to Lumière's exclusive summer drop. Enjoy ${offerPercent} off${durationText}! Explore now: lumi.re/vip`;
  }

  return {
    segmentRules,
    segmentName,
    segmentDesc,
    campaignName,
    messageTemplate,
    channel: "whatsapp"
  };
};

// In-memory cache for suggestions and insights scoped by user ID
const cache = {
  suggestions: new Map(), // key: userId -> { data, timestamp }
  insights: new Map()     // key: userId -> { data, timestamp }
};

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache TTL

// Helper to clear AI suggestions and insights cache for a user
const clearUserCache = (userId) => {
  if (!userId) return;
  const prefix = `${userId.toString()}_`;
  
  // Clear suggestions cache
  for (const key of cache.suggestions.keys()) {
    if (key.startsWith(prefix) || key === userId.toString()) {
      cache.suggestions.delete(key);
    }
  }
  
  // Clear insights cache
  for (const key of cache.insights.keys()) {
    if (key.startsWith(prefix) || key === userId.toString()) {
      cache.insights.delete(key);
    }
  }
  
  console.log(`[AI Cache Invalidated] User: ${userId}`);
};
exports.clearUserCache = clearUserCache;

// Helper to compile DB context for Gemini scoped to user/role
const getDbContext = async (userId, role, workspaceId) => {
  const query = role === 'admin' ? { workspaceId } : { userId, workspaceId };

  const cutOff60 = new Date();
  cutOff60.setDate(cutOff60.getDate() - 60);

  const cutOff45 = new Date();
  cutOff45.setDate(cutOff45.getDate() - 45);

  const cutOff7 = new Date();
  cutOff7.setDate(cutOff7.getDate() - 7);

  // Execute all basic aggregations and queries in parallel
  const [
    totalCustomers,
    statsAggregate,
    topCitiesAggregate,
    allTags,
    allCities,
    sampleCustomers,
    churnRiskCount,
    highValueInactiveCount,
    newThisWeekCount,
    oneTimeBuyersCount,
    topSegments,
    recentCampaignsRaw,
    genderAggregate,
    tagCountsAggregate
  ] = await Promise.all([
    Customer.countDocuments(query),
    Customer.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          avgSpend: { $avg: '$totalSpend' },
          avgOrders: { $avg: '$orderCount' },
          totalSpendSum: { $sum: '$totalSpend' },
          totalOrdersSum: { $sum: '$orderCount' }
        }
      }
    ]),
    Customer.aggregate([
      { $match: query },
      { $group: { _id: '$city', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]),
    Customer.distinct('tags', query),
    Customer.distinct('city', query),
    Customer.find({ ...query, customFields: { $exists: true } }).limit(100).select('customFields'),
    Customer.countDocuments({
      ...query,
      lastOrderDate: { $lte: cutOff60 },
      orderCount: { $gt: 1 }
    }),
    Customer.countDocuments({
      ...query,
      totalSpend: { $gt: 10000 },
      lastOrderDate: { $lte: cutOff45 }
    }),
    Customer.countDocuments({
      ...query,
      createdAt: { $gte: cutOff7 }
    }),
    Customer.countDocuments({
      ...query,
      orderCount: 1
    }),
    Segment.find(query).select('name audienceCount').limit(3),
    Campaign.find(query).sort({ createdAt: -1 }).limit(5),
    Customer.aggregate([
      { $match: query },
      { $group: { _id: '$gender', count: { $sum: 1 } } }
    ]),
    Customer.aggregate([
      { $match: query },
      { $unwind: '$tags' },
      { $group: { _id: '$tags', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 15 }
    ])
  ]);

  // Format gender counts map
  const genderCounts = {};
  if (genderAggregate) {
    genderAggregate.forEach(g => {
      const key = g._id || 'unknown';
      genderCounts[key] = g.count;
    });
  }

  // Format tag counts map
  const tagCounts = {};
  if (tagCountsAggregate) {
    tagCountsAggregate.forEach(t => {
      if (t._id) {
        tagCounts[t._id] = t.count;
      }
    });
  }

  // Format city counts map
  const cityCounts = {};
  const topCitiesList = [];
  if (topCitiesAggregate) {
    topCitiesAggregate.forEach(c => {
      if (c._id) {
        cityCounts[c._id] = c.count;
        topCitiesList.push(c._id);
      }
    });
  }

  const customFieldKeys = Array.from(new Set(sampleCustomers.flatMap(c => c.customFields ? Object.keys(c.customFields) : [])));

  const customerStats = {
    avgSpend: statsAggregate[0] ? parseFloat(statsAggregate[0].avgSpend.toFixed(2)) : 0,
    avgOrderCount: statsAggregate[0] ? parseFloat(statsAggregate[0].avgOrders.toFixed(2)) : 0,
    totalSpendSum: statsAggregate[0] ? parseFloat(statsAggregate[0].totalSpendSum.toFixed(2)) : 0,
    totalOrdersSum: statsAggregate[0] ? statsAggregate[0].totalOrdersSum : 0,
    topCities: topCitiesList,
    cityCounts,
    genderCounts,
    tagCounts,
    allTags,
    allCities,
    customFieldKeys,
    churnRiskCount,
    highValueInactiveCount,
    newThisWeekCount,
    oneTimeBuyersCount
  };

  // Resolve campaign stats in parallel as well
  const recentCampaigns = await Promise.all(recentCampaignsRaw.map(async (c) => {
    const statsQuery = role === 'admin' ? { campaignId: c._id } : { campaignId: c._id, userId };
    const stats = await CampaignStats.findOne(statsQuery);
    return {
      name: c.name,
      channel: c.channel,
      status: c.status,
      audienceCount: stats ? stats.total : 0,
      deliveryRate: stats ? stats.deliveryRate : 0
    };
  }));

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
    const dbContext = await getDbContext(req.user._id, req.user.role, req.workspaceId);
    
    // Call Gemini Agent service
    let agentResult;
    try {
      agentResult = await processAgentMessage(message, activeContext, dbContext);
    } catch (geminiErr) {
      console.error('[Gemini Service Throw] Fallback active:', geminiErr.message);
      agentResult = {
        reply: 'AI Agent Connection Error',
        agentContext: activeContext,
        structuredData: null,
        action: 'NONE'
      };
    }

    // Determine if the API failed or was missing
    const isApiError = !agentResult || 
                       (agentResult.reply && (
                         agentResult.reply.includes('Gemini API key is missing') || 
                         agentResult.reply.includes('AI Agent Connection Error') || 
                         agentResult.reply.includes('AI Service Temporarily Busy')
                       ));

    if (isApiError) {
      console.log('[AI Agent Fallback] Executing local learning/procedural fallback...');
      
      // 1. Try matching learned database patterns
      let matchedData = await matchLearnedFallback(message);
      
      // 2. If no database match, run advanced procedural rule builder
      if (!matchedData) {
        matchedData = generateProceduralFallback(message, dbContext);
      }

      // Construct mock agent response following the XML-like structure
      const reply = `⚠️ **Local Fallback Mode Active** (AI service temporarily unavailable).\n\nI have generated the campaign assets based on your prompt using locally learned patterns:\n- **Segment**: ${matchedData.segmentName}\n- **Target Rule**: ${JSON.stringify(matchedData.segmentRules.conditions)}\n- **Message template**: "${matchedData.messageTemplate}"\n- **Channel**: ${matchedData.channel.toUpperCase()}\n\nPlease review, edit, or approve this proposal to proceed.`;
      
      const fallbackContext = { ...activeContext };
      fallbackContext.intent = message;
      fallbackContext.segmentPlan = matchedData.segmentRules;
      fallbackContext.segmentName = matchedData.segmentName;
      fallbackContext.segmentDesc = matchedData.segmentDesc;
      fallbackContext.campaignName = matchedData.campaignName;
      fallbackContext.messagePlan = matchedData.messageTemplate;
      fallbackContext.channelPlan = matchedData.channel;
      fallbackContext.currentStep = 'CONFIRM_LAUNCH';
      fallbackContext.approvals = { segment: false, message: false, channel: false };

      agentResult = {
        reply,
        agentContext: fallbackContext,
        structuredData: {
          segmentRules: matchedData.segmentRules,
          segmentName: matchedData.segmentName,
          segmentDesc: matchedData.segmentDesc,
          campaignName: matchedData.campaignName,
          messageTemplate: matchedData.messageTemplate,
          channel: matchedData.channel
        },
        action: 'AWAIT_LAUNCH'
      };
    } else {
      // If Gemini succeeded and returned segment rules, save them to learn!
      if (agentResult.structuredData && agentResult.structuredData.segmentRules && env.GEMINI_API_KEY) {
        // Trigger learning asynchronously
        learnFromSuccess(message, agentResult.structuredData).catch(err => {
          console.error('[Learning Error]:', err.message);
        });
      }
    }

    // If segment plan is extracted/changed, resolve its size using Segment Engine
    if (agentResult.agentContext.segmentPlan) {
      try {
        const { audienceCount } = await resolveSegment(agentResult.agentContext.segmentPlan, req.workspaceId);
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
          workspaceId: req.workspaceId,
          name: agentResult.agentContext.segmentName || `Segment: AI Campaign (${new Date().toLocaleDateString('en-IN')})`,
          description: agentResult.agentContext.segmentDesc || `Automatically created by AI for intent: "${agentResult.agentContext.intent}"`,
          rules: agentResult.agentContext.segmentPlan,
          createdBy: 'ai',
          aiPrompt: agentResult.agentContext.intent
        });
        
        const { audienceIds, audienceCount } = await resolveSegment(agentResult.agentContext.segmentPlan, req.workspaceId);
        segment.audienceIds = audienceIds;
        segment.audienceCount = audienceCount;
        await segment.save();

        // Create Campaign Document
        const campaign = new Campaign({
          userId: req.user._id,
          workspaceId: req.workspaceId,
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
          body: {},
          workspaceId: req.workspaceId,
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
          workspaceId: req.workspaceId,
          name: updatedContext.segmentName || `Segment: AI Campaign (${new Date().toLocaleDateString('en-IN')})`,
          description: updatedContext.segmentDesc || `Automatically created by AI for intent: "${updatedContext.intent || 'Campaign'}"`,
          rules: updatedContext.segmentPlan,
          createdBy: 'ai',
          aiPrompt: updatedContext.intent
        });
        
        const { audienceIds, audienceCount } = await resolveSegment(updatedContext.segmentPlan, req.workspaceId);
        segment.audienceIds = audienceIds;
        segment.audienceCount = audienceCount;
        await segment.save();

        // Create Campaign Document
        const campaign = new Campaign({
          userId: req.user._id,
          workspaceId: req.workspaceId,
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
          body: {},
          workspaceId: req.workspaceId,
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
      
      const { audienceIds, audienceCount } = await resolveSegment(updatedContext.segmentPlan, req.workspaceId);
      updatedContext.resolvedAudienceCount = audienceCount;

      // Segment-only request (if no message plan or channel plan are drafted)
      if (!updatedContext.messagePlan && !updatedContext.channelPlan) {
        try {
          const segment = new Segment({
            userId: req.user._id,
            workspaceId: req.workspaceId,
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
  const cacheKey = `${req.user._id}_${req.workspaceId}`;
  const cached = cache.suggestions.get(cacheKey);
  const now = Date.now();

  try {
    const dbContext = await getDbContext(req.user._id, req.user.role, req.workspaceId);
    let suggestions = [];

    // 1. First prefired is always Gemini
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
        responseText = extractJsonArray(responseText.replace(/```json/gi, '').replace(/```/g, '').trim());
        suggestions = JSON.parse(responseText);
        
        // Cache successful Gemini suggestions
        cache.suggestions.set(cacheKey, { data: suggestions, timestamp: now });
      } catch (apiErr) {
        console.warn('Gemini API call failed for suggestions, trying cache fallback. Error:', apiErr.message);
      }
    }

    // 2. Fall back to cache if Gemini failed/key missing
    if ((!suggestions || suggestions.length === 0) && cached) {
      console.log(`[Suggestions Cache Fallback Hit] User: ${cacheKey}`);
      return success(res, cached.data, 'Campaign suggestions fetched from cache fallback');
    }

    // 3. Fall back to default fixed suggestions if no cache
    if (!suggestions || suggestions.length === 0) {
      suggestions = [
        { title: "Win back inactive high-spenders", prompt: "Target customers with totalSpend > 15000 and daysSinceLastOrder >= 60" },
        { title: "Welcome new customers", prompt: "Target customers with daysSinceRegistration <= 7" },
        { title: "Local promo in top cities", prompt: "Target customers in Mumbai and Delhi" }
      ];
    }

    return success(res, suggestions, 'Campaign suggestions fetched successfully');
  } catch (err) {
    next(err);
  }
};

// @desc    Get proactive AI-powered insights
// @route   GET /api/agent/insights
// @access  Private
exports.getInsights = async (req, res, next) => {
  const cacheKey = `${req.user._id}_${req.workspaceId}`;
  const cached = cache.insights.get(cacheKey);
  const now = Date.now();

  try {
    const matchQuery = req.user.role === 'admin' ? { workspaceId: req.workspaceId } : { userId: req.user._id, workspaceId: req.workspaceId };
    
    // Check total customers in the active workspace
    const totalCustomers = await Customer.countDocuments(matchQuery);
    if (totalCustomers === 0) {
      return success(res, [], 'No insights for empty workspace');
    }
    
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

    // 1. First prefired is always Gemini
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
- "audienceSize": number (matching the corresponding counted metric value above)
- "urgency": "high" | "medium" | "low"
- "suggestedAction": string (description of recommendation)
- "prebuiltPrompt": string (The exact instruction prompt that will be sent to the AI Agent to build this campaign. It must be highly specific, referencing standard database fields: 'totalSpend', 'orderCount', 'avgOrderValue', 'daysSinceLastOrder', 'daysSinceRegistration', 'city', 'gender', 'tags'. 
  * NEVER use 'orders', use 'orderCount' (e.g. 'orderCount == 0' or 'orderCount > 1').
  * NEVER use 'registered', use 'daysSinceRegistration' (e.g. 'daysSinceRegistration <= 7').
  * Example for high-value inactive: "Target customers with totalSpend > 10000 and daysSinceLastOrder >= 45"
  * Example for new shoppers: "Target customers with daysSinceRegistration <= 7"
  * Example for churn risk: "Target customers with daysSinceLastOrder >= 60 and orderCount > 1")

Respond with ONLY the JSON array. No extra text, and do not wrap in markdown codeblocks.
`;

        const result = await generateWithFallback(prompt);
        let responseText = result.response.text().trim();
        responseText = extractJsonArray(responseText.replace(/```json/gi, '').replace(/```/g, '').trim());
        insights = JSON.parse(responseText);
        
        // Cache successful Gemini insights
        cache.insights.set(cacheKey, { data: insights, timestamp: now });
      } catch (apiErr) {
        console.warn('Gemini API call failed for insights, trying cache fallback. Error:', apiErr.message);
      }
    }

    // 2. Fall back to cache if Gemini failed/key missing
    if ((!insights || insights.length === 0) && cached) {
      console.log(`[Insights Cache Fallback Hit] User: ${cacheKey}`);
      return success(res, cached.data, 'Insights fetched from cache fallback');
    }

    // 3. Fall back to default fixed insights if no cache
    if (!insights || insights.length === 0) {
      insights = [
        {
          title: "At-Risk Loyalists",
          description: `We detected ${churnRiskCount} regular shoppers who haven't bought anything in the last 60 days.`,
          audienceSize: churnRiskCount,
          urgency: "high",
          suggestedAction: "Run a re-engagement coupon campaign via WhatsApp.",
          prebuiltPrompt: "Target customers with daysSinceLastOrder >= 60 and orderCount > 2"
        },
        {
          title: "Dormant VIPs",
          description: `${highValueInactive} high-spending customers have been inactive for over 45 days.`,
          audienceSize: highValueInactive,
          urgency: "high",
          suggestedAction: "Send a personalized concierge catalog or 20% discount offer.",
          prebuiltPrompt: "Target customers with totalSpend > 10000 and daysSinceLastOrder >= 45"
        },
        {
          title: "New Customer Onboarding",
          description: `${newCustomers} new shoppers registered in the past 7 days and need welcoming.`,
          audienceSize: newCustomers,
          urgency: "medium",
          suggestedAction: "Trigger an automated Email series with a 10% welcome coupon.",
          prebuiltPrompt: "Target customers with daysSinceRegistration <= 7"
        },
        {
          title: "VIP Reward Opportunity",
          description: `There are ${frequentBuyers} frequent buyers who made purchases in the last 30 days.`,
          audienceSize: frequentBuyers,
          urgency: "low",
          suggestedAction: "Offer early access to the upcoming collection drop.",
          prebuiltPrompt: "Target customers with orderCount >= 5 and daysSinceLastOrder <= 30"
        },
        {
          title: "Convert One-Time Buyers",
          description: `We have ${oneTimeBuyers} shoppers who only bought once.`,
          audienceSize: oneTimeBuyers,
          urgency: "medium",
          suggestedAction: "Recommend complementary products based on their initial order.",
          prebuiltPrompt: "Target customers with orderCount == 1"
        }
      ];
    }

    return success(res, insights, 'Insights fetched successfully');
  } catch (err) {
    next(err);
  }
};
