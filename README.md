# HDFC SmartGateway (Juspay) — Payment Integration Reference

A complete **Node.js / Express.js** backend for HDFC SmartGateway (Juspay) integration with an interactive testing dashboard, Swagger API docs, and webhook handling.

---

## Features

| Category | Features |
|---|---|
| **Standard Payments** | Order creation, payment page redirect, order status check |
| **UPI Intent** | App-to-app push payments (Google Pay / PhonePe), dynamic QR code generation, auto-polling |
| **UPI Collect** | VPA-based collect flow |
| **CVV-less Payments** | Card tokenization, saved card payments via NETWORK_TOKEN |
| **Mandates (UPI Autopay)** | Registration, execution (auto-debit), status check, revoke, pre-debit notification |
| **One-Time Mandate (OTM)** | Fund blocking + single debit within validity period |
| **Surcharge** | Convenience fee on orders, tax calculation, surcharge-aware refunds |
| **Webhooks** | RSA signature verification, event handling for orders, mandates, notifications |
| **Interactive Dashboard** | Vanilla JS/HTML test UI at `/` with one-click testing for all features |
| **Swagger Docs** | OpenAPI 3.0 spec at `/docs.html` |

---

## Project Structure

```
juspay-testing/
├── server.js                  # Express app — route registration, DB connection, logger
├── routes/
│   ├── payments.js            # Standard payments, CVV-less, mandates, OTM
│   ├── upi-intent.js          # UPI Intent — create order, initiate txn, poll status, refund
│   ├── surcharge.js           # Surcharge (convenience fee) — create, status, refund
│   └── webhooks.js            # Webhook listener with RSA signature verification
├── models/
│   └── Order.js               # Mongoose schema for local order tracking
├── middleware/
│   └── auth.js                # Authentication helpers
├── utils/
│   └── signature.js           # RSA webhook signature verification
├── keys/
│   ├── privateKey.pem         # RSA private key
│   └── key_*.pem              # Juspay public key for webhook verification
├── public/
│   ├── index.html             # Interactive testing dashboard
│   ├── docs.html              # Swagger UI page
│   └── openapi.json           # OpenAPI 3.0 specification
├── logs/                      # Winston log files
├── requirements/              # Feature requirement documents
└── tests/                     # Test files
```

---

## API Endpoints

### Standard Payment

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/orders` | Create a payment order |
| `GET/POST` | `/api/payment/:orderId/status` | Get order status (also serves as return URL) |

### UPI Intent (Google Pay)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/upi-intent/create-order` | **Step 1**: Create order for UPI Intent |
| `POST` | `/api/upi-intent/initiate-transaction` | **Step 2**: Initiate UPI Intent txn → returns `sdk_params` + `upi_intent_uri` |
| `GET` | `/api/upi-intent/order-status/:orderId` | **Step 3**: Poll order status (UPI Intent is push-based) |
| `POST` | `/api/upi-intent/refund` | Refund a completed UPI Intent payment |

### CVV-less Payments

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/cards/list` | List saved cards for a customer |
| `POST` | `/api/cvvless/create-order` | Create order with `save_to_locker: true` |
| `POST` | `/api/cvvless/pay` | Execute CVV-less payment using card token |
| `POST` | `/api/cvvless/test-pay` | 🧪 Sandbox: test CVV-less with DUMMY gateway |

### Mandates (UPI Autopay)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/mandates/create-order` | Create order for mandate registration |
| `POST` | `/api/mandates/register` | Register mandate (UPI VPA or Card) |
| `GET` | `/api/mandates/order-status/:orderId` | Check mandate registration status |
| `GET` | `/api/mandates/list` | List all mandates for a customer |
| `POST` | `/api/mandates/:mandateId/status` | Check mandate status |
| `POST` | `/api/mandates/:mandateId/execute` | Execute mandate (auto-debit) |
| `POST` | `/api/mandates/:mandateId/revoke` | Revoke mandate permanently |

### One-Time Mandate (OTM)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/otm/create-order` | Create OTM order (block funds) |

### Surcharge (Convenience Fee)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/surcharge/create-order` | Create order with surcharge |
| `GET` | `/api/surcharge/order/:orderId` | Get surcharge order details |
| `POST` | `/api/surcharge/refund` | Refund surcharge order |

### Webhooks

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/webhook/juspay` | Receive Juspay webhooks (RSA signature verified) |

---

## UPI Intent Flow

The UPI Intent flow allows customers to pay via UPI apps (Google Pay, PhonePe, etc.) directly:

```
┌─────────────────────────────────────────────────────────┐
│ 1. POST /api/upi-intent/create-order                    │
│    → Creates order, returns order_id                    │
├─────────────────────────────────────────────────────────┤
│ 2. POST /api/upi-intent/initiate-transaction            │
│    → Calls Juspay /txns with UPI_PAY + sdk_params=true  │
│    → Returns sdk_params for constructing Intent URI     │
│                                                         │
│    upi://pay?tr=...&tid=...&pa=...&mc=...&pn=...&am=.. │
│                                                         │
│    Mobile App  → Open via Android Intent / iOS scheme   │
│    Mobile Web  → Embed as <a> tag → UPI app picker      │
│    Desktop Web → Generate QR code from URI              │
├─────────────────────────────────────────────────────────┤
│ 3. GET /api/upi-intent/order-status/:orderId            │
│    → Poll until status is CHARGED or FAILED             │
│    (UPI Intent is push-based — no redirect callback)    │
└─────────────────────────────────────────────────────────┘
```

---

## Setup Instructions

### 1. Prerequisites

- **Node.js** v18+ installed
- **MongoDB** instance (Local or [Atlas](https://www.mongodb.com/atlas))
- **Ngrok** (for webhook testing): `npm install -g ngrok`

### 2. Clone & Install

```bash
git clone <repo-url>
cd juspay-testing
npm install
```

### 3. Configure Credentials

1. Create a `keys/` directory and add your PEM files:
   - `keys/privateKey.pem` — RSA private key
   - `keys/key_<uuid>.pem` — Juspay's public key (for webhook verification)

2. Create a `.env` file in the root:
   ```env
   PORT=3000
   MONGODB_URI=your_mongodb_connection_string
   JUSPAY_BASE_URL=https://smartgatewayuat.hdfcbank.com
   JUSPAY_API_KEY=your_api_key
   JUSPAY_MERCHANT_ID=your_merchant_id
   JUSPAY_CLIENT_ID=your_client_id
   JUSPAY_KEY_UUID=your_key_uuid
   PAYMENT_PAGE_CLIENT_ID=hdfcmaster
   ```

### 4. Run the Application

```bash
npm start
```

The server starts on `http://localhost:3000` with:
- **Testing Dashboard**: [http://localhost:3000](http://localhost:3000)
- **Swagger API Docs**: [http://localhost:3000/docs.html](http://localhost:3000/docs.html)

### 5. Test Webhooks

1. Start Ngrok:
   ```bash
   ngrok http 3000
   ```
2. Add the Ngrok URL to **Juspay Dashboard** → Webhooks:
   ```
   https://your-ngrok-id.ngrok.io/webhook/juspay
   ```
3. Use test VPA `success@juspay` for successful UPI transactions in sandbox.

---

## Testing Dashboard

The dashboard at `http://localhost:3000` provides one-click testing for all features:

| Section | Cards |
|---|---|
| **Standard Payment** | Create Order, Get Order Status |
| **UPI Intent (Google Pay)** | Pay via UPI Intent (auto-opens GPay), Poll Status (auto-poll 3s), Refund |
| **Mandates — Registration** | Create Mandate Order, Register (UPI VPA), Get Mandate Status |
| **Mandates — Lifecycle** | List Mandates, Status Check, Pre-Debit Notify, Execute (Auto-Debit), Revoke |

### UPI Intent on Dashboard

The **"Pay with Google Pay"** card performs the full flow in one click:
1. Creates order with specified amount
2. Initiates UPI Intent transaction
3. **Auto-opens Google Pay** via `upi://pay?...` URI on mobile
4. Falls back to Juspay authentication URL on desktop
5. **Auto-starts polling** every 3 seconds for payment result
6. On `CHARGED`, auto-fills the refund card

---

## Tech Stack

| Component | Technology |
|---|---|
| Runtime | Node.js |
| Framework | Express.js v5 |
| Database | MongoDB (Mongoose v9) |
| HTTP Client | Axios |
| Logging | Winston |
| Dev Server | Nodemon |
| API Docs | Swagger UI + OpenAPI 3.0 |
| Authentication | Basic Auth (Base64 API Key) |
| Webhook Security | RSA Signature Verification |

---

## HDFC SmartGateway Documentation

- [Tranportal Integration](https://docs.hdfcbank.juspay.in/docs/smartgateway-tranportal-integration/docs/tranportal-integration/introduction)
- [UPI Intent](https://docs.hdfcbank.juspay.in/docs/smartgateway-tranportal-integration/docs/tranportal-integration/upi-intent)
- [UPI Collect](https://docs.hdfcbank.juspay.in/docs/smartgateway-tranportal-integration/docs/tranportal-integration/upi-collect)
- [Mandate Flow](https://docs.hdfcbank.juspay.in/docs/smartgateway-tranportal-integration/docs/tranportal-integration/mandate-flow)
- [CVV-less Payments](https://docs.hdfcbank.juspay.in/docs/hdfc-resources/docs/card-network-tokenization/cvvless-payments)
- [Surcharge](https://docs.hdfcbank.juspay.in/docs/surcharge-hdfc/docs)
- [One-Time Mandate](https://docs.hdfcbank.juspay.in/docs/smartgateway-tranportal-integration/docs/tranportal-integration/one-time-mandate)

---

## License

MIT
