const axios = require('axios');

/**
 * Execute an HTTP request with exponential backoff retry logic.
 * @param {Object} axiosConfig Axios configuration object
 * @param {number} maxRetries Maximum number of retries
 * @param {number} delay Base delay in milliseconds
 * @returns {Promise<any>} Response object
 */
const requestWithRetry = async (axiosConfig, maxRetries = 3, delay = 1000) => {
  let attempt = 0;
  
  while (attempt <= maxRetries) {
    try {
      const response = await axios(axiosConfig);
      return response;
    } catch (err) {
      attempt++;
      if (attempt > maxRetries) {
        throw new Error(`Failed after ${maxRetries} retries. Error: ${err.message}`);
      }
      
      const backoffDelay = delay * Math.pow(2, attempt - 1);
      console.warn(`[Retry Queue] Attempt ${attempt} failed for URL ${axiosConfig.url}. Retrying in ${backoffDelay}ms... Reason: ${err.message}`);
      
      await new Promise(resolve => setTimeout(resolve, backoffDelay));
    }
  }
};

module.exports = { requestWithRetry };
