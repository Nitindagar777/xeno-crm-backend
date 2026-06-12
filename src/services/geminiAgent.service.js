const { GoogleGenerativeAI } = require('@google/generative-ai');
const env = require('../config/env');

/**
 * Retry helper with exponential backoff for Gemini API calls.
 * Retries on 503 (Service Unavailable) and 429 (Rate Limited) errors.
 * @param {Function} fn Async function to retry
 * @param {number} maxRetries Maximum number of retries (default 3)
 * @param {number} baseDelayMs Base delay in ms (doubles each retry)
 * @returns {Promise<*>} Result of the function
 */
const retryWithBackoff = async (fn, maxRetries = 3, baseDelayMs = 2000) => {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const errMsg = (err.message || '').toLowerCase();
      
      // If the limit is 0 (quota limit: 0), retrying will always fail. Abort immediately.
      const isZeroLimit = errMsg.includes('limit: 0') || errMsg.includes('limit:0') || errMsg.includes('limit of 0');
      const isRetryable = !isZeroLimit && (errMsg.includes('503') || errMsg.includes('429') ||
        errMsg.includes('service unavailable') || errMsg.includes('high demand') ||
        errMsg.includes('resource exhausted') || errMsg.includes('rate limit') ||
        errMsg.includes('overloaded') || errMsg.includes('too many requests') || errMsg.includes('quota'));

      if (!isRetryable || attempt === maxRetries) {
        throw err;
      }

      // Calculate exponential backoff with jitter to prevent thundering herd
      const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
      const jitter = Math.floor(Math.random() * 500);
      const delay = exponentialDelay + jitter;
      
      console.warn(`[Gemini Retry] Attempt ${attempt + 1}/${maxRetries} failed (${err.message}). Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
};

const MODELS = [
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.0-flash-lite",
  "gemini-2.0-flash",
  "gemini-2.5-pro"
];

const DEFAULT_MODEL = "gemini-2.5-flash-lite";

/**
 * Iterates through a fallback list of Gemini models if the primary one fails.
 * @param {string} prompt The text prompt to generate
 * @param {string} systemInstruction Optional system instruction
 * @returns {Promise<any>} The successful generation result
 */
const generateWithFallback = async (prompt, systemInstruction = null) => {
  const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);
  const fallbackModels = [
    DEFAULT_MODEL,
    env.GEMINI_MODEL,
    ...MODELS
  ];

  const modelsToTry = [...new Set(fallbackModels)].filter(Boolean);
  let lastError;

  for (let i = 0; i < modelsToTry.length; i++) {
    const modelName = modelsToTry[i];
    try {
      console.log(`[Gemini] Attempting to use model: ${modelName}`);
      const modelParams = { model: modelName };
      if (systemInstruction) {
        modelParams.systemInstruction = systemInstruction;
      }
      const model = genAI.getGenerativeModel(modelParams);

      // We rely on the outer loop to retry different models, so we set internal retry to 0
      // to quickly fail over if this specific model is rate limited or unavailable.
      const result = await retryWithBackoff(async () => {
        return await model.generateContent(prompt);
      }, 0, 1000); 
      
      console.log(`[Gemini] Successfully generated content using model: ${modelName}`);
      return result;
    } catch (err) {
      console.warn(`[Gemini Fallback] Model ${modelName} failed (${err.message}).`);
      lastError = err;

      // Add a cooldown delay before trying the next model to avoid hitting global API Key limits
      if (i < modelsToTry.length - 1) {
        const fallbackDelay = 2000 + Math.floor(Math.random() * 1000); // 2-3s delay
        console.log(`[Gemini Fallback] Waiting ${fallbackDelay}ms before trying next model...`);
        await new Promise(resolve => setTimeout(resolve, fallbackDelay));
      }
    }
  }

  throw lastError || new Error("All fallback models failed due to high demand or quota limits.");
};

/**
 * Extracts content inside XML-like tags
 * @param {string} text Text response
 * @param {string} tag XML tag name
 * @returns {string|null} Inner text or null
 */
const extractTag = (text, tag) => {
  const regex = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i');
  const match = text.match(regex);
  return match ? match[1].trim() : null;
};

/**
 * Checks for presence of self-closing XML tags
 * @param {string} text Text response
 * @param {string} tag XML tag name
 * @returns {boolean} True if tag exists
 */
const hasTag = (text, tag) => {
  const regex = new RegExp(`<${tag}\\s*/?>`, 'i');
  return regex.test(text);
};

/**
 * Processes a message with Google Gemini API
 * @param {string} userMessage User's message
 * @param {Object} context Current conversation state/context
 * @param {Object} dbContext Database stats and details
 * @returns {Promise<Object>} Reply + updated context + extracted data
 */
const processAgentMessage = async (userMessage, context, dbContext) => {
  if (!env.GEMINI_API_KEY) {
    return {
      reply: "Gemini API key is missing. Please set the GEMINI_API_KEY environment variable in your .env file to enable the AI Agent.",
      agentContext: context,
      structuredData: null,
      action: 'NONE'
    };
  }

  // Update current step based on approvals
  let currentStep = context.currentStep || 'UNDERSTAND_INTENT';
  
  if (!context.intent) {
    currentStep = 'FAST_TRACK_PROPOSAL'; // Tell AI to propose everything at once
  } else if (!context.approvals.segment && !context.messagePlan) {
    currentStep = 'PROPOSE_FULL_CAMPAIGN_OR_SEGMENT';
  } else if (!context.campaignCreated) {
    currentStep = 'CONFIRM_LAUNCH';
  } else {
    currentStep = 'REPORTING';
  }

  // Format DB context for Gemini
  const dbContextStr = JSON.stringify(dbContext, null, 2);
  const contextStr = JSON.stringify(context, null, 2);

  const systemInstruction = `
You are an expert CRM Campaign Agent for a D2C fashion/beauty brand called "Lumière".
You help marketers plan and execute targeted campaigns intelligently.

CRITICAL CAMPAIGN AND SEGMENT BUILDER INSTRUCTIONS:
- "Look at the data first. Propose immediately. Ask ZERO questions unless the user's request is truly ambiguous."
- Do NOT ask clarifying questions. Immediately propose the segment and campaign based on the snapshot of the database status.
- If the user's message is general (e.g. "Build a segment", "create a segment", or "start a campaign"), review the cohort stats in the database status (such as churnRiskCount, highValueInactiveCount, newThisWeekCount, oneTimeBuyersCount), choose the most valuable cohort, and automatically generate rules for it immediately.
- When proposing a segment, output the rules inside <SEGMENT_RULES> tags as a valid JSON object with "logic" and "conditions".
- Include a short, descriptive segment name inside <SEGMENT_NAME> tags.
- Include a detailed segment description inside <SEGMENT_DESCRIPTION> tags.
- Include a catchy campaign name inside <CAMPAIGN_NAME> tags.

- When proposing a message template, output it inside <MESSAGE_TEMPLATE> tags.

DATA CHECKING & CENSUS CITATIONS:
- You have access to precise customer counts, city counts, gender breakdown, and tag frequencies under 'customerStats'.
- Whenever proposing a segment or campaign, you MUST cite the precise numbers from the database to justify your choices in your text explanation (outside the XML tags). For example: "Since we have X customers in Mumbai, let's target them..." or "I see we have Y female customers. Let's run a targeted campaign..."
- If the user asks about specific city/gender/tag metrics, use the exact figures in 'customerStats' to provide highly accurate, fast data check responses.
- If the user's target is not in the database (e.g. they target a city or tag that has 0 customers or is not listed in 'allCities'/'allTags'), let them know politely that no customers match that criteria based on current data.

PREMIUM D2C COPYWRITING STYLE GUIDE:
- Lumière is a premium fashion & beauty brand. The copy must feel high-end, elegant, and engaging. Avoid dry or overly transaction-focused language. Make it sound personal and story-driven.
- Personalized: Always utilize the allowed placeholders like {{firstName}} at the start of the message or naturally within. E.g., "Hey {{firstName}},..."
- Structure: Start with a personalized hook, explain the exclusive reward/offer, and end with a direct Call to Action (CTA) or discount code. Keep the message concise but compelling.
- Variables: You are ONLY allowed to use the following placeholder variables:
  * {{name}} - Full name of customer
  * {{firstName}} - First name of customer
  * {{city}} - City name
  * {{totalSpend}} - Total spent by customer (currency formatted)
  * {{orderCount}} - Number of orders placed
  * {{avgOrderValue}} - Average value per order
  * {{lastOrderDate}} - Date of last purchase
- Absolutely NEVER use generic markdown placeholders like [Name], [City], [First Name], or other bracketed variables. Only use the double-curly brace variables listed above.

- Recommend the best channel (whatsapp/sms/email/rcs) based on the audience size and goal.
- Think step-by-step and explain your reasoning, then output the tags.
- Be concise, direct, and confident. Ask ZERO questions.
- If the customer database is empty (totalCustomers: 0), politely inform the user that they must upload customer data first using the CSV import tool to get started.

Supported rule operators:
- 'gt' (greater than), 'lt' (less than), 'gte' (greater than/equal), 'lte' (less than/equal), 'eq' (equals), 'neq' (not equals)
- 'in' (array of values like cities or genders, e.g. ["Mumbai", "Delhi"])
- 'contains' (checks if a tag array contains a tag, value should be String, e.g. "loyal")

Fields in customer database:
- 'name' (String, full name of customer)
- 'email' (String, email address of customer)
- 'phone' (String, phone number of customer)
- 'totalSpend' (Number)
- 'orderCount' (Number)
- 'avgOrderValue' (Number)
- 'daysSinceLastOrder' (Number, e.g. 60 for 60 days since last purchase. Use it directly as field name)
- 'daysSinceRegistration' (Number, e.g. 7 for 7 days since registration. Use it directly as field name)
- 'createdAt' (Date or number of days ago)
- 'city' (String)
- 'gender' (String: 'male', 'female', 'other')
- 'tags' (Array of Strings)

- "You can target specific individual customers by using their name, email, or phone. For example, if the user asks to target 'Kavya Patel' or 'kavya.patel501@example.com', create a condition like \`{\"field\": \"email\", \"operator\": \"eq\", \"value\": \"kavya.patel501@example.com\"}\` or \`{\"field\": \"name\", \"operator\": \"eq\", \"value\": \"Kavya Patel\"}\`."
- "You can limit the segment size if the user requests a specific number of customers (e.g. 'target 5 customers' or 'limit to 10 users'). To do this, include a 'limit' key in the SEGMENT_RULES JSON. E.g., \`\"limit\": 5\`."

Additional database schema visibility:
- The context includes the exact lists of 'allTags', 'allCities', and 'customFieldKeys' present in the database (inside customerStats).
- Use only these existing tags/cities for segmenting, or alert the user if they request a tag/city that is not in the database.
- Custom field keys (from the 'customFieldKeys' list) can be targeted in queries using the exact custom key path (e.g. if 'age' is in 'customFieldKeys', a query condition should use {"field": "customFields.age", "operator": "gte", "value": 25}).

CONSTRAINTS & OUTPUT TAGS:
- When generating segment rules, you MUST output them in this EXACT JSON format inside <SEGMENT_RULES> tags (with optional "limit" key if user specifies a customer limit):
<SEGMENT_RULES>
{
  "logic": "AND",
  "conditions": [
    {"field": "totalSpend", "operator": "gte", "value": 5000}
  ],
  "limit": 5
}
</SEGMENT_RULES>

- When proposing segment rules, you MUST also generate a descriptive, concise name and description for the segment reflecting the criteria. Output them inside <SEGMENT_NAME> and <SEGMENT_DESCRIPTION> tags. Do not use generic words like "AI Generated":
<SEGMENT_NAME>VIP High Spenders</SEGMENT_NAME>
<SEGMENT_DESCRIPTION>Targeting customers with total spend greater than ₹15,000</SEGMENT_DESCRIPTION>

- When proposing a campaign, you MUST also generate a descriptive name. Output it inside <CAMPAIGN_NAME> tags. Do not use generic words like "AI Campaign":
<CAMPAIGN_NAME>High Spenders winback promotion</CAMPAIGN_NAME>

- When proposing a message template, output it inside <MESSAGE_TEMPLATE> tags:
<MESSAGE_TEMPLATE>Hi {{firstName}}, we miss you! Here is a 15% off coupon: LUMI15</MESSAGE_TEMPLATE>

- When proposing a channel, output it inside <CHANNEL> tags with value: whatsapp/sms/email/rcs:
<CHANNEL>whatsapp</CHANNEL>

- When you propose a segment or campaign and need the marketer's approval, always end your response with <AWAITING_APPROVAL/>.
- When the campaign is fully approved (segment, message, and channel are true) and you are ready to launch, output <READY_TO_LAUNCH/>.

CURRENT STEP IN LIFECYCLE: ${currentStep}
`;

  const prompt = `
DATABASE STATUS (DB CONTEXT):
${dbContextStr}

CURRENT CONVERSATION CONTEXT & APPROVED STEPS:
${contextStr}

USER MESSAGE:
"${userMessage}"

Provide your response. Remember to follow the output tag instructions for Segment Rules, Message Templates, Channels, and Approval indicators.
`;

  try {
    const result = await generateWithFallback(prompt, systemInstruction);

    const responseText = result.response.text();
    console.log('[Gemini Response]:', responseText);

    // Extract structured data from response text
    let segmentRules = null;
    const rulesRaw = extractTag(responseText, 'SEGMENT_RULES');
    if (rulesRaw) {
      try {
        segmentRules = JSON.parse(rulesRaw);
      } catch (jsonErr) {
        console.error('Failed to parse AI segment rules JSON:', jsonErr.message);
      }
    }

    const segmentName = extractTag(responseText, 'SEGMENT_NAME');
    const segmentDesc = extractTag(responseText, 'SEGMENT_DESCRIPTION');
    const campaignName = extractTag(responseText, 'CAMPAIGN_NAME');
    const messageTemplate = extractTag(responseText, 'MESSAGE_TEMPLATE');
    const channel = extractTag(responseText, 'CHANNEL');
    const awaitingApproval = hasTag(responseText, 'AWAITING_APPROVAL');
    const readyToLaunch = hasTag(responseText, 'READY_TO_LAUNCH');

    // Update Context State
    const updatedContext = { ...context };

    if (segmentRules) {
      updatedContext.segmentPlan = segmentRules;
    }
    if (segmentName) {
      updatedContext.segmentName = segmentName;
    }
    if (segmentDesc) {
      updatedContext.segmentDesc = segmentDesc;
    }
    if (campaignName) {
      updatedContext.campaignName = campaignName;
    }
    if (messageTemplate) {
      updatedContext.messagePlan = messageTemplate;
    }
    if (channel) {
      updatedContext.channelPlan = channel.toLowerCase();
    }

    // Attempt to extract user intent if not already captured
    if (!updatedContext.intent && userMessage.length > 15) {
      updatedContext.intent = userMessage;
    }

    // Handle stage progression
    let action = 'NONE';
    if (readyToLaunch && updatedContext.approvals.segment && updatedContext.approvals.message && updatedContext.approvals.channel) {
      action = 'LAUNCH';
      updatedContext.currentStep = 'EXECUTING';
    } else if (awaitingApproval) {
      if (updatedContext.segmentPlan && updatedContext.messagePlan && updatedContext.channelPlan) {
        action = 'AWAIT_LAUNCH';
        updatedContext.currentStep = 'CONFIRM_LAUNCH';
      } else if (!updatedContext.approvals.segment && updatedContext.segmentPlan) {
        action = 'AWAIT_SEGMENT';
        updatedContext.currentStep = 'AWAIT_SEGMENT_APPROVAL';
      } else if (updatedContext.approvals.segment && !updatedContext.approvals.message && updatedContext.messagePlan) {
        action = 'AWAIT_MESSAGE';
        updatedContext.currentStep = 'AWAIT_MESSAGE_APPROVAL';
      } else if (updatedContext.approvals.segment && updatedContext.approvals.message && !updatedContext.approvals.channel && updatedContext.channelPlan) {
        action = 'AWAIT_CHANNEL';
        updatedContext.currentStep = 'AWAIT_CHANNEL_APPROVAL';
      }
    }

    // Clean XML tags from reply for cleaner UI presentation
    let cleanReply = responseText
      .replace(/<SEGMENT_RULES>[\s\S]*?<\/SEGMENT_RULES>/gi, '')
      .replace(/<SEGMENT_NAME>[\s\S]*?<\/SEGMENT_NAME>/gi, '')
      .replace(/<SEGMENT_DESCRIPTION>[\s\S]*?<\/SEGMENT_DESCRIPTION>/gi, '')
      .replace(/<CAMPAIGN_NAME>[\s\S]*?<\/CAMPAIGN_NAME>/gi, '')
      .replace(/<MESSAGE_TEMPLATE>[\s\S]*?<\/MESSAGE_TEMPLATE>/gi, '')
      .replace(/<CHANNEL>[\s\S]*?<\/CHANNEL>/gi, '')
      .replace(/<AWAITING_APPROVAL\s*\/?>/gi, '')
      .replace(/<READY_TO_LAUNCH\s*\/?>/gi, '')
      .trim();

    return {
      reply: cleanReply,
      agentContext: updatedContext,
      structuredData: {
        segmentRules,
        segmentName,
        segmentDesc,
        campaignName,
        messageTemplate,
        channel
      },
      action
    };
  } catch (err) {
    console.error('Gemini API Error (after retries):', err);
    const errMsg = (err.message || '').toLowerCase();
    const isRateLimit = errMsg.includes('503') || errMsg.includes('429') ||
      errMsg.includes('service unavailable') || errMsg.includes('high demand') ||
      errMsg.includes('resource exhausted') || errMsg.includes('rate limit') ||
      errMsg.includes('overloaded');

    const reply = isRateLimit
      ? `⚠️ **AI Service Temporarily Busy**: The Gemini API is experiencing high demand right now. I retried 3 times but it's still overloaded.\n\n**What you can do**:\n1. **Wait 30–60 seconds** and try your message again.\n2. The service should recover shortly — this is a temporary spike.`
      : `⚠️ **AI Agent Connection Error**: I encountered an issue communicating with the Google Gemini AI service.\n\n**Technical Details**: \`${err.message}\`\n\n**How to fix this**:\n1. Verify that your **\`GEMINI_API_KEY\`** is valid in your backend \`.env\` file.\n2. Get your key from [Google AI Studio](https://aistudio.google.com/apikey) (it usually starts with \`AIzaSy...\`).\n3. **Restart the backend server** using \`npm run dev\` after any changes.`;

    return {
      reply,
      agentContext: context,
      structuredData: null,
      action: 'NONE'
    };
  }
};

module.exports = { processAgentMessage, retryWithBackoff, generateWithFallback };
