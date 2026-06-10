# xeno-crm-backend

The Node.js, Express, and MongoDB backend server for the **AI-Native Mini CRM**. It manages customer data, purchase orders, segment definitions, campaign dispatches, and hosts the core Gemini AI Campaign Agent.

---

## 🏗️ Technical Architecture & Role
This service runs on **Port 5000** (by default) and handles:
- **Database Storage**: Shoppers, purchase histories, segment rules, campaigns, and communication logs.
- **Segment Engine**: Evaluates rule-based logic (e.g. `totalSpend >= 5000` AND `daysSinceLastOrder <= 30`) on MongoDB to filter/group target audiences.
- **AI Campaign Agent**: Integrates Google Gemini API to parse natural language queries, propose segments, draft personalized message templates, and recommend optimal channels.
- **Campaign Dispatcher**: Schedules and batches message payloads to the external `channel-service`.
- **Receipt Webhook**: Receives asynchronous delivery and engagement callbacks (`sent`, `delivered`, `failed`, `opened`, `read`, `clicked`) from the `channel-service` and updates CRM logs/statistics.

---

## ⚙️ Local Development Setup

### Prerequisites
- **Node.js** (v18 or higher)
- **MongoDB** running locally on `mongodb://127.0.0.1:27017/xenocrm` (or remote cluster)

### Setup Steps
1. **Install Dependencies**:
   ```bash
   npm install
   ```
2. **Configure Environment Variables**:
   Copy `.env.example` to `.env` and fill in the values:
   ```bash
   cp .env.example .env
   ```
   Provide your MongoDB URI, JWT Secret, and your Google Gemini API Key:
   ```env
   PORT=5000
   MONGODB_URI=mongodb://127.0.0.1:27017/xenocrm
   JWT_SECRET=xeno_super_secret_jwt_key_2026_d2c_brand
   JWT_EXPIRES_IN=7d
   GEMINI_API_KEY=your_gemini_api_key_here
   CHANNEL_SERVICE_URL=http://localhost:5001
   CHANNEL_SECRET=xeno_channel_shared_secret_2026
   CLIENT_URL=http://localhost:5173
   GEMINI_MODEL=gemini-2.5-flash
   GOOGLE_CLIENT_ID=your_google_client_id_here
   GOOGLE_CLIENT_SECRET=your_google_client_secret_here
   ```
3. **Seed the Database**:
   Populate the database with 200 realistic customers and their purchase histories:
   ```bash
   npm run seed
   ```
4. **Run in Development Mode**:
   ```bash
   npm run dev
   ```

---

## 📡 Key API Routes

### 🔐 Authentication
- `POST /api/auth/register` — Register a new marketer profile.
- `POST /api/auth/login` — Sign in and retrieve JWT token.
- `GET /api/auth/me` — Retrieve active profile details (protected).

### 👥 Customers & Orders
- `GET /api/customers` — Paginated, filterable customer list.
- `GET /api/customers/:id` — Load single customer profile details and recent orders.
- `POST /api/customers/import` — Bulk import customers via CSV file upload.
- `POST /api/orders` — Create a purchase order (triggers customer stats recalculation).

### 🔍 Segment Engine
- `POST /api/segments` — Build and save a rule-based audience segment.
- `POST /api/segments/preview` — Test segment rules and return match count.
- `POST /api/segments/:id/refresh` — Force-refresh segment audience.

### 📣 Campaigns & Logs
- `POST /api/campaigns` — Create a draft campaign.
- `POST /api/campaigns/:id/send` — Start a campaign (orchestrates batch sends to simulator).
- `GET /api/campaigns/:id/stats` — Load real-time campaign performance statistics.
- `POST /api/campaigns/receipt` — Webhook endpoint for channel-service status reports.

### 🤖 Gemini AI Agent
- `POST /api/agent/message` — Interactive message to Gemini Campaign agent.
- `POST /api/agent/approve` — Approve proposed segment rules/templates.
- `GET /api/agent/insights` — Calculate database KPIs and generate campaign recommendations.
