const express = require('express');
const router = express.Router();
const axios = require('axios');
const qs = require('qs');
const Order = require('../models/Order');
const { httpsAgent, getAuthHeaders, config } = require('../middleware/auth');

const JUSPAY_BASE_URL = 'https://smartgateway.hdfcuat.bank.in'; // HDFC SmartGateway Sandbox
const PAYMENT_PAGE_CLIENT_ID = process.env.JUSPAY_CLIENT_ID || 'hdfcmaster'; // sandbox default

/**
 * @route POST /api/orders
 * @desc Create an order in both local DB and Juspay (form-urlencoded)
 */
router.post('/orders', async (req, res) => {
    try {
        const {
            amount,
            currency = 'INR',
            customerId,
            customer_email = 'test@example.com',
            customer_phone = '9876543210',
            payment_locks,       // Array of payment methods to ENABLE, e.g. ['CARD']
            payment_locks_disable, // Array of payment methods to DISABLE, e.g. ['WALLET']
            surcharge,           // { surcharge_amount, tax_amount }
            dcc = false,
            offer_id,
            mandate_auth = false,
            save_to_locker = false,
            native_otp = false
        } = req.body;

        const orderId = `order_${Date.now()}`;
        const host = req.get('host');
        const protocol = req.protocol;

        // --- Build form data (key=value pairs) ---
        const formData = {
            order_id: orderId,
            amount: amount.toString(),
            currency: currency,
            customer_id: customerId || 'cust_default',
            customer_email: customer_email,
            customer_phone: customer_phone,
            payment_page_client_id: PAYMENT_PAGE_CLIENT_ID,
            action: 'paymentPage',
            return_url: `${protocol}://${host}/api/payment/${orderId}/status`,
            description: 'Payment via Feature Dashboard',
            first_name: 'Test',
            last_name: 'User',
        };

        // --- Advanced Feature: Payment Locking ---
        // Ref: https://docs.hdfcbank.juspay.in/docs/hdfc-resources/docs/common-resources/payment-locking
        // To ENABLE specific methods only: allowDefaultOptions=false, enable the ones you want
        // To DISABLE specific methods:    allowDefaultOptions=true,  disable the ones you don't want
        if (payment_locks && payment_locks.length > 0) {
            formData.payment_filter = JSON.stringify({
                allowDefaultOptions: false,
                options: payment_locks.map(method => ({
                    paymentMethodType: method,
                    enable: true
                }))
            });
        } else if (payment_locks_disable && payment_locks_disable.length > 0) {
            formData.payment_filter = JSON.stringify({
                allowDefaultOptions: true,
                options: payment_locks_disable.map(method => ({
                    paymentMethodType: method,
                    enable: false
                }))
            });
        }

        // --- Advanced Feature: Surcharge (Convenience Fee) ---
        // Ref: https://docs.hdfcbank.juspay.in/docs/surcharge-hdfc/docs/overview/overview
        // Note: Surcharge must also be enabled at merchant level in the Juspay Dashboard
        if (surcharge) {
            if (surcharge.surcharge_amount) formData.surcharge_amount = surcharge.surcharge_amount.toString();
            if (surcharge.tax_amount) formData.tax_amount = surcharge.tax_amount.toString();
        }

        // --- Advanced Feature: UPI Autopay / Mandates ---
        // Ref: https://docs.hdfcbank.juspay.in/docs/smartgateway-api-ref-basicauth/docs/mandates-subscriptions/introduction
        if (mandate_auth) {
            formData.mandate_auth = 'true';
        }

        // --- Advanced Feature: Save to Locker (CVV-less) ---
        // Ref: https://docs.hdfcbank.juspay.in/docs/hdfc-resources/docs/card-network-tokenization/cvvless-payments
        if (save_to_locker) {
            formData.save_to_locker = 'true';
        }

        // --- Advanced Feature: DCC ---
        // Ref: https://docs.hdfcbank.juspay.in/docs/dcc-hdfc/docs/overview/dcc
        if (dcc) {
            formData.options = JSON.stringify({ dcc: true });
        }

        // --- Advanced Feature: Offers ---
        // Ref: https://docs.hdfcbank.juspay.in/docs/offer-engine-hdfc/docs/offer-engine/overview
        if (offer_id) {
            formData.offer_id = offer_id;
        }

        // --- Advanced Feature: Native OTP ---
        // Ref: https://docs.hdfcbank.juspay.in/docs/smartgateway-tranportal-integration/docs/native-otp/native-otp-introduction
        if (native_otp) {
            formData.options = JSON.stringify({ ...(dcc ? { dcc: true } : {}), native_otp: true });
        }

        console.log('=== Sending to Juspay ===');
        console.log('URL:', `${JUSPAY_BASE_URL}/orders`);
        console.log('Form Data:', formData);

        const response = await axios.post(
            `${JUSPAY_BASE_URL}/orders`,
            qs.stringify(formData),  // Convert to form-urlencoded string
            {
                httpsAgent,
                headers: getAuthHeaders(formData.customer_id)
            }
        );

        // Save to Local DB
        const newOrder = new Order({
            orderId,
            amount,
            currency,
            customerId: formData.customer_id,
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

        const formData = {
            order_id: orderId,
            payment_method,
            ...card_details,
            ...upi_details
        };

        const response = await axios.post(
            `${JUSPAY_BASE_URL}/payments/${orderId}/initiate`,
            qs.stringify(formData),
            {
                httpsAgent,
                headers: getAuthHeaders(orderId)
            }
        );

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
            headers: getAuthHeaders(orderId)
        });

        // Update local DB status
        await Order.findOneAndUpdate({ orderId }, { status: response.data.status });

        // If it's a redirect, show a nice HTML page
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
        const formData = req.body; // frequency, max_amount, start_date, etc.
        const response = await axios.post(
            `${JUSPAY_BASE_URL}/mandates`,
            qs.stringify(formData),
            {
                httpsAgent,
                headers: getAuthHeaders()
            }
        );
        res.json(response.data);
    } catch (error) {
        console.error('Mandate Creation Error:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { error: 'Mandate creation failed' });
    }
});

module.exports = router;
