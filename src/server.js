const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const connectDB = require('./config/db');
const env = require('./config/env');
const errorHandler = require('./middleware/errorHandler.middleware');
const { apiLimiter } = require('./middleware/rateLimiter.middleware');

// Initialize database
connectDB();

const app = express();

// Middlewares
app.use(helmet());
app.use(morgan('dev'));

// CORS Configuration
const allowedOrigins = [env.CLIENT_URL, 'http://localhost:5173', 'http://127.0.0.1:5173'];
app.use(cors({
  origin: function (origin, callback) {
    // allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1 || origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) {
      return callback(null, true);
    }
    return callback(new Error('The CORS policy for this site does not allow access from the specified Origin.'), false);
  },
  credentials: true
}));

// Parsers (Limit increased for large CSV imports)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Apply general API rate limiter to all routes except webhook callback
app.use('/api/', (req, res, next) => {
  // Exclude receipt callback from rate limit
  if (req.path === '/campaigns/receipt') {
    return next();
  }
  return apiLimiter(req, res, next);
});

// Mount Routes
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/customers', require('./routes/customer.routes'));
app.use('/api/orders', require('./routes/order.routes'));
app.use('/api/segments', require('./routes/segment.routes'));
app.use('/api/campaigns', require('./routes/campaign.routes'));
app.use('/api/agent', require('./routes/agent.routes'));
app.use('/api/stats', require('./routes/stats.routes'));
app.use('/api/workspace', require('./routes/workspace.routes'));
app.use('/api/history', require('./routes/history.routes'));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', timestamp: new Date() });
});

// 404 handler
app.use((req, res, next) => {
  res.status(404).json({ success: false, error: 'API route not found' });
});

// Global Error Handler
app.use(errorHandler);

const PORT = env.PORT;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[XenoCRM Backend] Service running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
});
