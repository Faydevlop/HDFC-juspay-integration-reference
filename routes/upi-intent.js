const express = require('express');
const router = express.Router();
const axios = require('axios');
const https = require('https');
const qs = require('querystring');
const Order = require('../models/Order');

const JUSPAY_BASE_URL = process.env.JUSPAY_BASE_URL;
const JUSPAY_API_KEY = process.env.JUSPAY_API_KEY;
const JUSPAY_MERCHANT_ID = process.env.JUSPAY_MERCHANT_ID;
const PAYMENT_PAGE_CLIENT_ID = process.env.PAYMENT_PAGE_CLIENT_ID || 'hdfcmaster';

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

function getAuthHeaders(extraId) {
    return {
        'Authorization': `Basic ${Buffer.from(JUSPAY_API_KEY + ':').toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-merchantid': JUSPAY_MERCHANT_ID,
        'x-merchant-id': JUSPAY_MERCHANT_ID,
        ...(extraId && { 'x-customerid': extraId })
    };
}

// ============================================================
// UPI INTENT PAYMENT APIs
// ============================================================

/**
 * POST /api/upi-intent/create-order
 * Step 1: Create a standard order for UPI Intent payment
 * 
 * This is the same as a regular order creation, but the order_id
 * is prefixed with 'upi_intent_' for easy identification.
 * 
 * Ref: https://docs.hdfcbank.juspay.in/docs/smartgateway-tranportal-integration/docs/tranportal-integration/create-order-api
 */
router.post('/create-order', async (req, res) => {
    try {
        const {
            amount,
            currency = 'INR',
            customer_id,
            customer_email,
            customer_phone,
            return_url
        } = req.body;

        if (!amount) {
            return res.status(400).json({ error: 'amount is required' });
        }

        const order_id = `upi_intent_${Date.now()}`;

        const formData = {
            order_id,
            amount: amount.toString(),
            currency,
            customer_id: customer_id || `cust_${Date.now()}`,
            customer_email: customer_email || 'test@example.com',
            customer_phone: customer_phone || '9876543210',
            payment_page_client_id: PAYMENT_PAGE_CLIENT_ID,
            action: 'paymentPage',
            return_url: return_url || `http://localhost:3000/api/payment/${order_id}/status`
        };

        // Save to local DB
        const localOrder = new Order({
            orderId: order_id,
            amount: parseFloat(amount),
            currency,
            status: 'CREATED',
            customerId: formData.customer_id
        });
        await localOrder.save();

        // Create on Juspay
        const response = await axios.post(
            `${JUSPAY_BASE_URL}/order/create`,
            qs.stringify(formData),
            { httpsAgent, headers: getAuthHeaders() }
        );

        // Update local record
        await Order.findOneAndUpdate({ orderId: order_id }, {
            juspayOrderId: response.data.id,
            status: response.data.status
        });

        console.log('===========================================');
        console.log('📱 UPI INTENT: Order Created');
        console.log('   Order ID:', order_id);
        console.log('   Amount:', amount, currency);
        console.log('   Status:', response.data.status);
        console.log('   → Next: Call POST /api/upi-intent/initiate-transaction');
        console.log('===========================================');

        res.status(201).json(response.data);
    } catch (error) {
        console.error('UPI Intent Create Order Error:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { error: 'UPI Intent order creation failed' });
    }
});

/**
 * POST /api/upi-intent/initiate-transaction
 * Step 2: Initiate UPI Intent transaction
 * 
 * Calls Juspay's /txns endpoint with:
 *   - payment_method_type: UPI
 *   - payment_method: UPI_PAY
 *   - txn_type: UPI_PAY
 *   - sdk_params: true (to receive intent URI params)
 * 
 * The response contains `sdk_params` with fields needed to construct
 * the UPI Intent URI:
 *   upi://pay?tr=..&tid=..&pa=..&mc=..&pn=..&am=..&cu=INR&tn=..
 * 
 * Ref: https://docs.hdfcbank.juspay.in/docs/smartgateway-tranportal-integration/docs/tranportal-integration/upi-intent
 * Juspay endpoint: POST /txns
 */
router.post('/initiate-transaction', async (req, res) => {
    try {
        const {
            order_id,
            redirect_after_payment = true,
            format = 'json'
        } = req.body;

        if (!order_id) {
            return res.status(400).json({ error: 'order_id is required' });
        }

        const formData = {
            order_id,
            merchant_id: JUSPAY_MERCHANT_ID,
            payment_method_type: 'UPI',
            payment_method: 'UPI_PAY',
            txn_type: 'UPI_PAY',
            sdk_params: 'true',
            redirect_after_payment: redirect_after_payment.toString(),
            format
        };

        console.log('===========================================');
        console.log('📱 UPI INTENT: Initiating Transaction');
        console.log('   Order:', order_id);
        console.log('   Payment Method: UPI_PAY (Intent)');
        console.log('===========================================');

        const response = await axios.post(
            `${JUSPAY_BASE_URL}/txns`,
            qs.stringify(formData),
            { httpsAgent, headers: getAuthHeaders() }
        );

        const data = response.data;

        // Extract sdk_params for intent URI construction
        const sdkParams = data.payment?.sdk_params;
        let intentUri = null;

        if (sdkParams) {
            // Use pgIntentUrl if available directly from response
            if (sdkParams.pgIntentUrl) {
                intentUri = sdkParams.pgIntentUrl;
            } else {
                // Construct UPI Intent URI from sdk_params
                const params = new URLSearchParams();
                if (sdkParams.tr) params.set('tr', sdkParams.tr);
                if (sdkParams.tid) params.set('tid', sdkParams.tid);
                if (sdkParams.merchant_vpa) params.set('pa', sdkParams.merchant_vpa);
                if (sdkParams.mcc) params.set('mc', sdkParams.mcc);
                if (sdkParams.merchant_name) params.set('pn', sdkParams.merchant_name);
                if (sdkParams.amount) params.set('am', sdkParams.amount);
                params.set('cu', sdkParams.currency || 'INR');
                if (sdkParams.tn) params.set('tn', sdkParams.tn);
                intentUri = `upi://pay?${params.toString()}`;
            }

            console.log('✅ UPI Intent URI constructed:');
            console.log('   ', intentUri);
            console.log('');
            console.log('📋 SDK Params received:');
            console.log('   tr:', sdkParams.tr);
            console.log('   tid:', sdkParams.tid);
            console.log('   merchant_vpa:', sdkParams.merchant_vpa);
            console.log('   mcc:', sdkParams.mcc);
            console.log('   merchant_name:', sdkParams.merchant_name);
            console.log('   amount:', sdkParams.amount);
        }

        console.log('   Status:', data.status);
        console.log('   Txn ID:', data.txn_id || 'N/A');
        console.log('   → Next: Poll GET /api/upi-intent/order-status/:orderId for payment result');
        console.log('===========================================');

        // Update local DB
        await Order.findOneAndUpdate({ orderId: order_id }, {
            status: data.status,
            txnId: data.txn_id
        });

        // Return response enhanced with constructed intent URI
        res.json({
            ...data,
            upi_intent_uri: intentUri,
            next_step: 'Use the upi_intent_uri to open UPI app on mobile, or generate QR code for web. Poll /api/upi-intent/order-status/:orderId for payment status.'
        });
    } catch (error) {
        console.error('UPI Intent Transaction Error:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { error: 'UPI Intent transaction initiation failed' });
    }
});

/**
 * GET /api/upi-intent/order-status/:orderId
 * Step 3: Poll order status after UPI Intent payment
 * 
 * Unlike UPI Collect (where response redirects to return_url),
 * UPI Intent is a push payment — the merchant must poll for status.
 * 
 * Keep polling until status transitions from PENDING_VBV to:
 *   - CHARGED (payment successful)
 *   - AUTHENTICATION_FAILED (payment failed)
 *   - AUTHORIZATION_FAILED (payment failed)
 * 
 * Juspay endpoint: GET /orders/:orderId
 */
router.get('/order-status/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;

        const response = await axios.get(`${JUSPAY_BASE_URL}/orders/${orderId}`, {
            httpsAgent,
            headers: getAuthHeaders()
        });

        const data = response.data;
        const status = data.status;

        console.log('===========================================');
        console.log('📱 UPI INTENT: Order Status Check');
        console.log('   Order:', orderId);
        console.log('   Status:', status);

        if (status === 'CHARGED') {
            console.log('   ✅ Payment SUCCESSFUL!');
        } else if (status === 'PENDING_VBV') {
            console.log('   ⏳ Payment PENDING — customer has not completed yet');
            console.log('   → Continue polling this endpoint');
        } else if (['AUTHENTICATION_FAILED', 'AUTHORIZATION_FAILED', 'JUSPAY_DECLINED'].includes(status)) {
            console.log('   ❌ Payment FAILED');
        }
        console.log('===========================================');

        // Update local DB
        await Order.findOneAndUpdate({ orderId }, { status });

        res.json(data);
    } catch (error) {
        console.error('UPI Intent Order Status Error:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { error: 'UPI Intent order status check failed' });
    }
});

/**
 * POST /api/upi-intent/refund
 * Refund a UPI Intent payment
 * 
 * Standard Juspay refund endpoint. Works the same for all payment methods.
 * 
 * Juspay endpoint: POST /orders/:orderId/refunds
 */
router.post('/refund', async (req, res) => {
    try {
        const {
            order_id,
            amount          // optional: partial refund amount
        } = req.body;

        if (!order_id) {
            return res.status(400).json({ error: 'order_id is required' });
        }

        // First get the order to know the full amount
        const orderResponse = await axios.get(`${JUSPAY_BASE_URL}/orders/${order_id}`, {
            httpsAgent,
            headers: getAuthHeaders()
        });

        const orderData = orderResponse.data;

        if (orderData.status !== 'CHARGED') {
            return res.status(400).json({
                error: 'Order must be in CHARGED status to refund',
                current_status: orderData.status
            });
        }

        const refundAmount = amount || orderData.amount;
        const unique_request_id = `refund_${Date.now()}`;

        const formData = {
            order_id,
            amount: refundAmount.toString(),
            unique_request_id,
            merchant_id: JUSPAY_MERCHANT_ID
        };

        console.log('===========================================');
        console.log('💸 UPI INTENT: Refund');
        console.log('   Order:', order_id);
        console.log('   Refund Amount:', refundAmount);
        console.log('   Request ID:', unique_request_id);
        console.log('===========================================');

        const response = await axios.post(
            `${JUSPAY_BASE_URL}/orders/${order_id}/refunds`,
            qs.stringify(formData),
            { httpsAgent, headers: getAuthHeaders() }
        );

        // Update local DB
        await Order.findOneAndUpdate({ orderId: order_id }, {
            status: 'REFUND_INITIATED'
        });

        res.json(response.data);
    } catch (error) {
        console.error('UPI Intent Refund Error:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { error: 'UPI Intent refund failed' });
    }
});

module.exports = router;
