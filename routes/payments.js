const express = require('express');
const router = express.Router();
const axios = require('axios');
const Order = require('../models/Order');
const { httpsAgent, getAuthHeaders, config } = require('../middleware/auth');

const JUSPAY_BASE_URL = 'https://smartgateway.hdfcuat.bank.in'; // HDFC SmartGateway Sandbox

/**
 * @route POST /api/orders
 * @desc Create an order in both local DB and Juspay
 */
router.post('/orders', async (req, res) => {
    try {
        const {
            amount,
            currency = 'INR',
            customerId,
            payment_locks,
            surcharge,
            dcc = false,
            offer_id
        } = req.body;

        const orderId = `order_${Date.now()}`;
        const host = req.get('host');
        const protocol = req.protocol;

        // Prepare Juspay payload
        const payload = {
            order_id: orderId,
            amount: amount.toString(),
            currency: currency,
            customer_id: customerId || 'cust_default',
            return_url: `${protocol}://${host}/api/payment/${orderId}/status`, // Redirect to status page
            // Advanced features
            // return_url: `http://localhost:3000/api/payment/${orderId}/return`,
            payment_filter: payment_locks ? { payment_locks } : undefined,
            surcharge_details: surcharge,
            options: {
                dcc: dcc,
                offer_id: offer_id
            }
        };

        const response = await axios.post(`${JUSPAY_BASE_URL}/orders`, payload, {
            httpsAgent,
            headers: getAuthHeaders()
        });

        // Save to Local DB
        const newOrder = new Order({
            orderId,
            amount,
            currency,
            customerId: payload.customer_id,
            juspayOrderId: response.data.id,
            metadata: response.data
        });
        await newOrder.save();

        res.status(201).json(response.data);
    } catch (error) {
        console.error('Order Creation Error:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { error: 'Order creation failed' });
    }
});

/**
 * @route POST /api/payments/:orderId/initiate
 * @desc Initiate payment / start transaction
 */
router.post('/payments/:orderId/initiate', async (req, res) => {
    try {
        const { orderId } = req.params;
        const { payment_method, card_details, upi_details } = req.body;

        const payload = {
            order_id: orderId,
            payment_method,
            // Native OTP / CVV-less info would go here
            ...card_details,
            ...upi_details
        };

        const response = await axios.post(`${JUSPAY_BASE_URL}/payments/${orderId}/initiate`, payload, {
            httpsAgent,
            headers: getAuthHeaders()
        });

        res.json(response.data);
    } catch (error) {
        console.error('Payment Initiation Error:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { error: 'Payment initiation failed' });
    }
});

/**
 * @route GET/POST /api/payment/:orderId/status
 * @desc Fetch order status (Handles redirect from Juspay)
 */
const getStatus = async (req, res) => {
    try {
        const { orderId } = req.params;

        const response = await axios.get(`${JUSPAY_BASE_URL}/orders/${orderId}`, {
            httpsAgent,
            headers: getAuthHeaders()
        });

        // Update local DB status
        await Order.findOneAndUpdate({ orderId }, { status: response.data.status });

        // If it's a redirect, we might want to show a nice HTML page instead of JSON
        if (req.method === 'POST' || req.query.redirect === 'true') {
            return res.send(`
                <html>
                    <body style="font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh;">
                        <h2>Payment Status: ${response.data.status}</h2>
                        <p>Order ID: ${orderId}</p>
                        <a href="/" style="padding: 10px 20px; background: #007bff; color: white; text-decoration: none; border-radius: 5px;">Back to Dashboard</a>
                    </body>
                </html>
            `);
        }

        res.json(response.data);
    } catch (error) {
        console.error('Status Check Error:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { error: 'Status check failed' });
    }
};

router.get('/payment/:orderId/status', getStatus);
router.post('/payment/:orderId/status', getStatus);

/**
 * @route POST /api/mandates
 * @desc Create UPI Autopay / OTM Mandate
 */
router.post('/mandates', async (req, res) => {
    try {
        const payload = req.body; // frequency, max_amount, start_date, etc.
        const response = await axios.post(`${JUSPAY_BASE_URL}/mandates`, payload, {
            httpsAgent,
            headers: getAuthHeaders()
        });
        res.json(response.data);
    } catch (error) {
        console.error('Mandate Creation Error:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { error: 'Mandate creation failed' });
    }
});

module.exports = router;
