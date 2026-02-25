# HDFC SmartGateway (Juspay) Payment Integration

A complete Node.js / Express.js backend for HDFC SmartGateway integration. Supports advanced features like UPI Autopay, Surcharge, DCC, and Payment Locking.

## Features
- **Payment Suite V2**: UPI Autopay, Payment Locking, OTM, Surcharge.
- **Next Gen Experience**: Native OTP, CVV-less Payments, DCC.
- **Improved Affordability**: Offers Engine integration.
- **Secure**: Basic Auth + mTLS (HTTPS Agent).
- **Interactive Dashboard**: Vanilla JS/HTML test UI.

## Project Structure
- `server.js`: Main Express application.
- `routes/payments.js`: Order creation, initiation, and status endpoints.
- `routes/webhooks.js`: Webhook listener for payment updates.
- `middleware/auth.js`: Authentication logic (HDFC Basic Auth).
- `utils/signature.js`: Webhook signature verification (RSA).
- `models/Order.js`: Mongoose schema for order storage.

## Setup Instructions

### 1. Prerequisites
- Node.js installed.
- MongoDB instance (Local or Atlas).
- Ngrok (for webhook testing).

### 2. Configure Credentials
1. Create a `keys/` directory in the root.
2. Add your `privateKey.pem` and `public_key.pem` to the `keys/` folder.
3. Update `.env` with your HDFC SmartGateway credentials:
   ```env
   PORT=3000
   MONGODB_URI=your_mongodb_uri
   JUSPAY_API_KEY=your_api_key
   JUSPAY_MERCHANT_ID=your_merchant_id
   JUSPAY_CLIENT_ID=your_client_id
   JUSPAY_KEY_UUID=your_key_uuid
   ```

### 3. Run the Application
```bash
npm install
npm start
```

### 4. Test Webhooks
1. Start Ngrok: `ngrok http 3000`.
2. Add the dynamic URL to the Juspay Dashboard: `https://your-ngrok.io/webhook/juspay`.
3. Use `success@juspay` for a successful UPI test transaction.

## License
MIT
