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
            mandate_auth = false,
            otm = false,         // One-Time Mandate flag
            save_to_locker = false,
            native_otp = false,
            expiryInMins         // Payment link expiry (optional)
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

        // --- Feature: Payment Link Expiry ---
        if (expiryInMins) {
            formData.expiryInMins = expiryInMins.toString();
        }

        // --- Feature: Payment Locking ---
        // Ref: https://docs.hdfcbank.juspay.in/docs/hdfc-resources/docs/common-resources/payment-locking
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

        // --- Feature: Surcharge (Convenience Fee) ---
        // Requires dashboard config: PG Control Center > Surcharge tab
        if (surcharge) {
            if (surcharge.surcharge_amount) formData.surcharge_amount = surcharge.surcharge_amount.toString();
            if (surcharge.tax_amount) formData.tax_amount = surcharge.tax_amount.toString();
        }

        // --- Feature: UPI Autopay / Mandates ---
        // Requires: PA/PG to enable UPI Autopay + Dashboard PG Control Centre config
        if (mandate_auth) {
            formData.mandate_auth = 'true';
        }

        // --- Feature: One-Time Mandate (OTM) ---
        // Ref: https://docs.hdfcbank.juspay.in/docs/smartgateway-tranportal-integration/docs/tranportal-integration/one-time-mandate
        if (otm) {
            formData.mandate_auth = 'true';
            formData.options = JSON.stringify({ create_mandate: 'REQUIRED' });
        }

        // --- Feature: Save to Locker (CVV-less) ---
        // Requires: PA/PG KAM to activate + CVV-less supported gateway
        if (save_to_locker) {
            formData.save_to_locker = 'true';
        }

        // --- Feature: Native OTP ---
        // Requires: PA/PG to enable + Dashboard Marketplace tab config
        if (native_otp) {
            formData.options = JSON.stringify({ native_otp: true });
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

// ============================================================
// REFUND APIs
// ============================================================

/**
 * @route POST /api/orders/:orderId/refund
 * @desc Create a refund for a charged order
 */
router.post('/orders/:orderId/refund', async (req, res) => {
    try {
        const { orderId } = req.params;
        const {
            amount,
            unique_request_id,  // Idempotency key to prevent duplicate refunds
            refund_type = 'STANDARD' // STANDARD or INSTANT
        } = req.body;

        const formData = {
            order_id: orderId,
            amount: amount.toString(),
            unique_request_id: unique_request_id || `refund_${Date.now()}`,
        };

        if (refund_type === 'INSTANT') {
            formData.refund_type = 'INSTANT';
        }

        const response = await axios.post(
            `${JUSPAY_BASE_URL}/orders/${orderId}/refunds`,
            qs.stringify(formData),
            {
                httpsAgent,
                headers: getAuthHeaders(orderId)
            }
        );

        res.json(response.data);
    } catch (error) {
        console.error('Refund Error:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { error: 'Refund failed' });
    }
});

// ============================================================
// CARD MANAGEMENT APIs (CVV-less / Tokenization)
// ============================================================

/**
 * @route GET /api/cards
 * @desc List all saved/tokenized cards for a customer
 */
router.get('/cards', async (req, res) => {
    try {
        const { customer_id } = req.query;

        if (!customer_id) {
            return res.status(400).json({ error: 'customer_id query parameter is required' });
        }

        const response = await axios.get(`${JUSPAY_BASE_URL}/cards`, {
            httpsAgent,
            headers: getAuthHeaders(customer_id),
            params: { customer_id }
        });

        res.json(response.data);
    } catch (error) {
        console.error('List Cards Error:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { error: 'Failed to list cards' });
    }
});

/**
 * @route GET /api/card/bin/:bin
 * @desc Get card info by BIN (first 6-9 digits) — issuer, network, type, tokenization eligibility
 */
router.get('/card/bin/:bin', async (req, res) => {
    try {
        const { bin } = req.params;

        const response = await axios.get(`${JUSPAY_BASE_URL}/card/bin/${bin}`, {
            httpsAgent,
            headers: getAuthHeaders()
        });

        res.json(response.data);
    } catch (error) {
        console.error('Card BIN Lookup Error:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { error: 'BIN lookup failed' });
    }
});

/**
 * @route DELETE /api/cards/:cardToken
 * @desc Delete a saved card from the locker
 */
router.delete('/cards/:cardToken', async (req, res) => {
    try {
        const { cardToken } = req.params;
        const { customer_id } = req.body;

        const formData = { card_token: cardToken };
        if (customer_id) formData.customer_id = customer_id;

        const response = await axios.post(
            `${JUSPAY_BASE_URL}/card/delete`,
            qs.stringify(formData),
            {
                httpsAgent,
                headers: getAuthHeaders(customer_id)
            }
        );

        res.json(response.data);
    } catch (error) {
        console.error('Delete Card Error:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { error: 'Card deletion failed' });
    }
});

// ============================================================
// MANDATE LIFECYCLE APIs (UPI Autopay + OTM)
// ============================================================

/**
 * @route POST /api/mandates/:mandateId/execute
 * @desc Execute a mandate (trigger a recurring debit or OTM fund transfer)
 */
router.post('/mandates/:mandateId/execute', async (req, res) => {
    try {
        const { mandateId } = req.params;
        const {
            amount,
            order_id,           // New order ID for this execution
            customer_id,
            notification_id     // Pre-debit notification ID (for UPI Autopay)
        } = req.body;

        const formData = {
            mandate_id: mandateId,
            amount: amount.toString(),
            order_id: order_id || `exec_${Date.now()}`,
        };

        if (customer_id) formData.customer_id = customer_id;
        if (notification_id) formData.notification_id = notification_id;

        const response = await axios.post(
            `${JUSPAY_BASE_URL}/mandates/${mandateId}/execute`,
            qs.stringify(formData),
            {
                httpsAgent,
                headers: getAuthHeaders(customer_id)
            }
        );

        res.json(response.data);
    } catch (error) {
        console.error('Mandate Execute Error:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { error: 'Mandate execution failed' });
    }
});

/**
 * @route POST /api/mandates/:mandateId/revoke
 * @desc Revoke (cancel) an active mandate
 */
router.post('/mandates/:mandateId/revoke', async (req, res) => {
    try {
        const { mandateId } = req.params;

        const formData = {
            mandate_id: mandateId,
            command: 'revoke'
        };

        const response = await axios.post(
            `${JUSPAY_BASE_URL}/mandates/${mandateId}`,
            qs.stringify(formData),
            {
                httpsAgent,
                headers: getAuthHeaders()
            }
        );

        res.json(response.data);
    } catch (error) {
        console.error('Mandate Revoke Error:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { error: 'Mandate revocation failed' });
    }
});

/**
 * @route GET /api/mandates/:mandateId/status
 * @desc Check the current status of a mandate
 */
router.get('/mandates/:mandateId/status', async (req, res) => {
    try {
        const { mandateId } = req.params;

        const formData = {
            mandate_id: mandateId,
            command: 'check_status'
        };

        const response = await axios.post(
            `${JUSPAY_BASE_URL}/mandates/${mandateId}`,
            qs.stringify(formData),
            {
                httpsAgent,
                headers: getAuthHeaders()
            }
        );

        res.json(response.data);
    } catch (error) {
        console.error('Mandate Status Error:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { error: 'Mandate status check failed' });
    }
});

/**
 * @route POST /api/mandates/:mandateId/notify
 * @desc Send pre-debit notification (required 24h before auto-debit for UPI Autopay)
 */
router.post('/mandates/:mandateId/notify', async (req, res) => {
    try {
        const { mandateId } = req.params;
        const {
            amount,
            execution_date  // Expected debit date (YYYY-MM-DD)
        } = req.body;

        const formData = {
            mandate_id: mandateId,
            amount: amount.toString(),
            command: 'pre_debit_notify'
        };

        if (execution_date) formData.execution_date = execution_date;

        const response = await axios.post(
            `${JUSPAY_BASE_URL}/mandates/${mandateId}/notify`,
            qs.stringify(formData),
            {
                httpsAgent,
                headers: getAuthHeaders()
            }
        );

        res.json(response.data);
    } catch (error) {
        console.error('Pre-Debit Notification Error:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { error: 'Pre-debit notification failed' });
    }
});

module.exports = router;
