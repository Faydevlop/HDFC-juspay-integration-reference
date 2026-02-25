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
// STANDARD PAYMENT APIs
// ============================================================

/**
 * POST /api/orders
 * Create a standard payment order
 */
router.post('/orders', async (req, res) => {
    try {
        const {
            amount,
            currency = 'INR',
            customerId,
            customer_email,
            customer_phone,
            return_url
        } = req.body;

        const order_id = `order_${Date.now()}`;

        const formData = {
            order_id,
            amount: amount.toString(),
            currency,
            customer_id: customerId || `cust_${Date.now()}`,
            customer_email: customer_email || 'test@example.com',
            customer_phone: customer_phone || '9876543210',
            payment_page_client_id: PAYMENT_PAGE_CLIENT_ID,
            action: 'paymentPage',
            return_url: return_url || `http://localhost:3000/api/payment/${order_id}/status`
        };

        // Save to local DB
        const localOrder = new Order({
            orderId: order_id,
            amount,
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

        res.status(201).json(response.data);
    } catch (error) {
        console.error('Create Order Error:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { error: 'Order creation failed' });
    }
});

/**
 * ALL /api/payment/:orderId/status
 * Get order status (serves as return URL handler for both GET and POST)
 */
router.all('/payment/:orderId/status', async (req, res) => {
    try {
        const { orderId } = req.params;

        const response = await axios.get(`${JUSPAY_BASE_URL}/orders/${orderId}`, {
            httpsAgent,
            headers: getAuthHeaders()
        });
        console.log(`Order Status Response for ${orderId}:`, JSON.stringify(response.data, null, 2));

        const updateData = { status: response.data.status };

        // Extract mandate ID if present
        if (response.data.mandate?.mandate_id) {
            updateData.mandateId = response.data.mandate.mandate_id;
        }

        // ========== CARD TOKEN EXTRACTION ==========
        const cardData = response.data.card;
        if (cardData) {
            // Check all possible token locations
            const cardToken = cardData.card_token
                || (cardData.tokens && cardData.tokens.length > 0 && cardData.tokens[0].token)
                || null;

            if (cardToken) {
                console.log('===========================================');
                console.log('🎉 CARD TOKEN IS HERE ->', cardToken);
                console.log('   Card Network:', cardData.card_brand);
                console.log('   Last Four:', cardData.last_four_digits);
                console.log('   Card Type:', cardData.card_type);
                console.log('   Customer:', response.data.customer_id);
                console.log('===========================================');

                updateData.cardToken = cardToken;
                updateData.cardNetwork = cardData.card_brand;
                updateData.cardLastFour = cardData.last_four_digits;
                updateData.cardType = cardData.card_type;
                updateData.savedToLocker = true;
            } else {
                console.log('⚠️  Card found but NO TOKEN. saved_to_locker:', cardData.saved_to_locker);
                console.log('   tokens array:', JSON.stringify(cardData.tokens));
            }

            updateData.savedToLocker = cardData.saved_to_locker || false;
        }
        // ============================================

        await Order.findOneAndUpdate({ orderId }, updateData);

        res.json(response.data);
    } catch (error) {
        console.error('Order Status Error:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { error: 'Status check failed' });
    }
});

/**
 * GET /api/cards/list
 * List saved cards for a customer (to get card tokens)
 * IMPORTANT: Check `cvvLessSupported` flag to know if CVV-less is available
 */
router.get('/cards/list', async (req, res) => {
    try {
        const { customer_id } = req.query;
        if (!customer_id) {
            return res.status(400).json({ error: 'customer_id query parameter is required' });
        }

        const response = await axios.get(`${JUSPAY_BASE_URL}/customers/${customer_id}/cards`, {
            httpsAgent,
            headers: getAuthHeaders(customer_id)
        });

        console.log(`Saved Cards for Customer ${customer_id}:`, JSON.stringify(response.data, null, 2));

        // Parse and log each saved card with CVV-less eligibility
        const cards = response.data.cards || response.data || [];
        const cardList = Array.isArray(cards) ? cards : [];

        if (cardList.length === 0) {
            console.log('⚠️  No saved cards found for customer:', customer_id);
            console.log('   → Customer needs to make a first payment with save_to_locker: true');
        } else {
            console.log('===========================================');
            console.log(`📋 Found ${cardList.length} saved card(s) for ${customer_id}:`);
            cardList.forEach((card, index) => {
                console.log(`--- Card [${index}] ---`);
                console.log('   card_token:', card.card_token || '❌ NOT AVAILABLE');
                console.log('   last4:', card.last_four_digits || card.card_number?.slice(-4) || 'N/A');
                console.log('   card_brand:', card.card_brand || card.card_type || 'N/A');
                console.log('   expired:', card.expired || 'N/A');
                console.log('   🔑 cvvLessSupported:', card.cvv_less_supported ?? card.cvvLessSupported ?? '❓ NOT IN RESPONSE');
            });
            console.log('===========================================');
        }

        res.json(response.data);
    } catch (error) {
        console.error('List Cards Error:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { error: 'Failed to list saved cards' });
    }
});

// ============================================================
// CVV-LESS PAYMENT APIs (Card Tokenization)
// ============================================================

/**
 * POST /api/cvvless/create-order
 * Create Order with Tokenization enabled (save_to_locker: true)
 * Ref: https://docs.hdfcbank.juspay.in/docs/hdfc-resources/docs/card-network-tokenization/cvvless-payments
 */
router.post('/cvvless/create-order', async (req, res) => {
    try {
        const {
            amount,
            currency = 'INR',
            customer_id,
            customer_email,
            customer_phone,
            return_url
        } = req.body;

        const order_id = `cvvl_${Date.now()}`;

        const formData = {
            order_id,
            amount: amount.toString(),
            currency,
            customer_id: customer_id || `cust_${Date.now()}`,
            customer_email: customer_email || 'test@example.com',
            customer_phone: customer_phone || '9876543210',
            payment_page_client_id: PAYMENT_PAGE_CLIENT_ID,
            action: 'paymentPage',
            'save_to_locker': 'true',         // Added top-level parameter
            'options.save_to_locker': 'true', // Keep options-level for compatibility
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

        const response = await axios.post(
            `${JUSPAY_BASE_URL}/order/create`,
            qs.stringify(formData),
            { httpsAgent, headers: getAuthHeaders() }
        );

        await Order.findOneAndUpdate({ orderId: order_id }, {
            juspayOrderId: response.data.id,
            status: response.data.status
        });

        res.status(201).json(response.data);
    } catch (error) {
        console.error('Create CVV-less Order Error:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { error: 'CVV-less order creation failed' });
    }
});

/**
 * POST /api/cvvless/pay
 * Execute CVV-less payment using card token (PRODUCTION FLOW)
 */
router.post('/cvvless/pay', async (req, res) => {
    try {
        const {
            order_id,           // NEW order_id for repeat payment
            card_token,         // From /cards/list
            card_network,       // VISA/MASTERCARD
            cryptogram,         // REQUIRED - generated by Juspay SDK
            customer_id
        } = req.body;

        // VALIDATION
        if (!card_token || !card_network) {
            return res.status(400).json({ error: 'card_token & card_network required' });
        }
        if (!cryptogram) {
            return res.status(400).json({ error: 'cryptogram REQUIRED for CVV-less (NETWORK_TOKEN flow)' });
        }

        const formData = {
            order_id,
            merchant_id: JUSPAY_MERCHANT_ID,
            payment_method_type: 'CARD',
            'card.token': card_token,
            'card.network': card_network,
            'card.tokenization_mode': 'NETWORK_TOKEN',  // ✅ Use NETWORK_TOKEN for tokenized card checkout
            format: 'json'
        };

        formData['card.cryptogram'] = cryptogram;

        const response = await axios.post(
            `${JUSPAY_BASE_URL}/txns`,
            qs.stringify(formData),
            { httpsAgent, headers: getAuthHeaders(customer_id) }
        );

        res.json(response.data);
    } catch (error) {
        console.error('CVV-less Payment Error:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { error: 'CVV-less failed' });
    }
});

/**
 * POST /api/cvvless/test-pay
 * 🧪 TEST ONLY: Simulate CVV-less payment with DUMMY gateway
 * 
 * The DUMMY gateway bypasses real CVV validation, so we can test
 * submitting a payment WITHOUT CVV to verify the flow works.
 * 
 * Use test card: 4591 5000 0000 0055, expiry 12/30, NO CVV
 * 
 * ⚠️ This route is for SANDBOX TESTING ONLY.
 * In production, use /api/cvvless/pay with real card_token.
 */
router.post('/cvvless/test-pay', async (req, res) => {
    try {
        const {
            order_id,                   // Must be a NEW order (create first via /api/cvvless/create-order)
            card_number,                // Test card: 4591500000000055
            card_exp_month,             // 12
            card_exp_year,              // 2030
            name_on_card,               // any name
            customer_id
        } = req.body;

        // VALIDATION
        if (!order_id) {
            return res.status(400).json({ error: 'order_id is required (create an order first)' });
        }
        if (!card_number) {
            return res.status(400).json({ error: 'card_number is required for test mode' });
        }

        console.log('===========================================');
        console.log('🧪 TEST MODE: CVV-less payment (DUMMY gateway)');
        console.log('   Order:', order_id);
        console.log('   Card:', card_number.slice(-4));
        console.log('   ⚠️  Submitting WITHOUT CVV');
        console.log('===========================================');

        const formData = {
            order_id,
            merchant_id: JUSPAY_MERCHANT_ID,
            payment_method_type: 'CARD',
            payment_method: 'CARD',
            'card_number': card_number,
            'card_exp_month': card_exp_month || '12',
            'card_exp_year': card_exp_year || '2030',
            'name_on_card': name_on_card || 'Test User',
            // 🔑 NO CVV FIELD — this is the CVV-less test
            format: 'json',
            redirect_after_payment: 'true',
            return_url: `http://localhost:3000/api/payment/${order_id}/status`
        };

        console.log('📤 Sending to Juspay (no CVV):', JSON.stringify(formData, null, 2));

        const response = await axios.post(
            `${JUSPAY_BASE_URL}/txns`,
            qs.stringify(formData),
            { httpsAgent, headers: getAuthHeaders(customer_id) }
        );

        console.log('📥 Juspay Response:', JSON.stringify(response.data, null, 2));

        // Check if it succeeded without CVV
        const status = response.data.status;
        if (status === 'CHARGED' || status === 'PENDING_VBV' || status === 'AUTHORIZING') {
            console.log('✅ DUMMY gateway accepted payment WITHOUT CVV!');
            console.log('   Status:', status);
        } else {
            console.log('⚠️  Status:', status, '- check if CVV-less is supported');
        }

        res.json({
            test_mode: true,
            message: 'CVV-less test payment via DUMMY gateway',
            cvv_sent: false,
            ...response.data
        });
    } catch (error) {
        console.error('CVV-less Test Payment Error:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json({
            test_mode: true,
            error: 'CVV-less test payment failed',
            details: error.response?.data || error.message
        });
    }
});

// ============================================================
// MANDATE APIs (UPI Autopay / Subscription)
// ============================================================


// ============================================================
// ONE-TIME MANDATE (OTM) APIs
// ============================================================

/**
 * POST /api/otm/create-order
 * Create Order for One-Time Mandate (OTM)
 * Ref: https://docs.hdfcbank.juspay.in/docs/smartgateway-tranportal-integration/docs/tranportal-integration/one-time-mandate
 */
router.post('/otm/create-order', async (req, res) => {
    try {
        const {
            amount,              // The amount to block
            currency = 'INR',
            customer_id,
            customer_email,
            customer_phone,
            start_date,          // Mandatory for OTM
            end_date,
            description,
            return_url
        } = req.body;

        if (!amount || !start_date) {
            return res.status(400).json({ error: 'amount and start_date are mandatory for OTM' });
        }

        const dateToUnix = (d) => d ? Math.floor(new Date(d).getTime() / 1000) : undefined;
        const order_id = `otm_${Date.now()}`;

        const formData = {
            order_id,
            amount: amount.toString(),
            currency,
            customer_id: customer_id || `cust_${Date.now()}`,
            customer_email: customer_email || 'test@example.com',
            customer_phone: customer_phone || '9876543210',
            payment_page_client_id: PAYMENT_PAGE_CLIENT_ID,
            action: 'paymentPage',
            'options.create_mandate': 'REQUIRED',
            'mandate.frequency': 'ONETIME',
            'mandate.max_amount': amount.toString(),
            'mandate.amount_rule': 'VARIABLE',
            'mandate.revokable_by_customer': 'false',  // OTM: customer cannot revoke
            'mandate.block_funds': 'true',              // OTM: block funds upfront
            // NOTE: rule_type and rule_value are NOT used for ONETIME frequency
            'mandate.start_date': dateToUnix(start_date),
            'mandate.end_date': dateToUnix(end_date),
            return_url: return_url || `http://localhost:3000/api/payment/${order_id}/status`
        };

        if (description) formData['mandate.description'] = description;

        // Save to local DB
        const localOrder = new Order({
            orderId: order_id,
            amount: parseFloat(amount),
            currency,
            status: 'CREATED',
            customerId: formData.customer_id
        });
        await localOrder.save();

        const response = await axios.post(
            `${JUSPAY_BASE_URL}/order/create`,
            qs.stringify(formData),
            { httpsAgent, headers: getAuthHeaders() }
        );

        await Order.findOneAndUpdate({ orderId: order_id }, {
            juspayOrderId: response.data.id,
            status: response.data.status
        });

        res.status(201).json(response.data);
    } catch (error) {
        console.error('Create OTM Order Error:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { error: 'OTM order creation failed' });
    }
});

/**
 * POST /api/mandates/create-order
 * Create Order with Mandate (Step 1: Create order for mandate registration)
 * Ref: https://docs.hdfcbank.juspay.in/docs/.../create-order--mandate
 */
router.post('/mandates/create-order', async (req, res) => {
    try {
        const {
            amount = '1.00',
            currency = 'INR',
            customer_id,
            customer_email,
            customer_phone,
            max_amount,
            frequency = 'MONTHLY',
            start_date,
            end_date,
            description,
            return_url
        } = req.body;

        const dateToUnix = (d) => d ? Math.floor(new Date(d).getTime() / 1000) : undefined;
        const order_id = `mandate_${Date.now()}`;

        const formData = {
            order_id,
            amount: amount.toString(),
            currency,
            customer_id: customer_id || `cust_${Date.now()}`,
            customer_email: customer_email || 'test@example.com',
            customer_phone: customer_phone || '9876543210',
            payment_page_client_id: PAYMENT_PAGE_CLIENT_ID,
            action: 'paymentPage',
            mandate_auth: 'true',
            payment_methods: 'UPI,CARD',
            'options.create_mandate': 'REQUIRED',
            'mandate.frequency': frequency,
            'mandate.max_amount': max_amount || amount.toString(),
            'mandate.amount_rule': 'VARIABLE',
            'mandate.revokable_by_customer': 'true',
            'mandate.block_funds': 'false',
            'mandate.rule_type': 'ON',
            'mandate.rule_value': '1',
            'mandate.start_date': dateToUnix(start_date),
            'mandate.end_date': dateToUnix(end_date),
            return_url: return_url || `http://localhost:3000/api/payment/${order_id}/status`
        };

        if (description) formData['mandate.description'] = description;

        // Save to local DB
        const localOrder = new Order({
            orderId: order_id,
            amount: parseFloat(amount),
            currency,
            status: 'CREATED',
            customerId: formData.customer_id
        });
        await localOrder.save();

        console.log('httpsAgent are here', httpsAgent, getAuthHeaders());
        const response = await axios.post(
            `${JUSPAY_BASE_URL}/order/create`,
            qs.stringify(formData),
            { httpsAgent, headers: getAuthHeaders() }
        );



        await Order.findOneAndUpdate({ orderId: order_id }, {
            juspayOrderId: response.data.id,
            status: response.data.status
        });

        res.status(201).json(response.data);
    } catch (error) {
        console.error('Create Mandate Order Error:', error.response?.data || error.message);

        res.status(error.response?.status || 500).json(error.response?.data || { error: 'Mandate order creation failed' });
    }
});

/**
 * POST /api/mandates/register
 * Mandate Registration API (Step 2: Register mandate after order creation)
 * Ref: https://docs.hdfcbank.juspay.in/docs/.../mandate-registration-api
 */
router.post('/mandates/register', async (req, res) => {
    try {
        const {
            order_id,
            payment_method_type = 'UPI',
            payment_method,       // e.g. UPI VPA like "customer@upi"
            upi_vpa,
            card_number,
            card_exp_month,
            card_exp_year,
            name_on_card,
            card_security_code
        } = req.body;

        const formData = {
            order_id,
            merchant_id: JUSPAY_MERCHANT_ID,
            payment_method_type,
            redirect_after_payment: 'true',
            format: 'json'
        };

        if (payment_method_type === 'UPI') {
            formData.payment_method = 'UPI_COLLECT';
            formData.txn_type = 'UPI_COLLECT';
            formData.upi_vpa = upi_vpa || payment_method;
            formData.should_create_mandate = 'true';
            formData.mandate_type = 'EMANDATE';
        } else if (payment_method_type === 'CARD') {
            formData.card_number = card_number;
            formData.card_exp_month = card_exp_month;
            formData.card_exp_year = card_exp_year;
            formData.name_on_card = name_on_card;
            formData.card_security_code = card_security_code;
        }

        const response = await axios.post(
            `${JUSPAY_BASE_URL}/txns`,
            qs.stringify(formData),
            { httpsAgent, headers: getAuthHeaders() }
        );

        res.json(response.data);
    } catch (error) {
        console.error('Mandate Registration Error:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { error: 'Mandate registration failed' });
    }
});

/**
 * GET /api/mandates/order-status/:orderId
 * Get Mandate Order Status (Check status of mandate registration order)
 * Ref: https://docs.hdfcbank.juspay.in/docs/.../get-mandate-order-status
 */
router.get('/mandates/order-status/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;

        const response = await axios.get(`${JUSPAY_BASE_URL}/orders/${orderId}`, {
            httpsAgent,
            headers: getAuthHeaders()
        });

        res.json(response.data);
    } catch (error) {
        console.error('Mandate Order Status Error:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { error: 'Mandate order status check failed' });
    }
});

/**
 * GET /api/mandates/list
 * List Mandates for a customer
 * Ref: https://docs.hdfcbank.juspay.in/docs/.../list-mandate-api
 */
router.get('/mandates/list', async (req, res) => {
    try {
        const { customer_id } = req.query;

        if (!customer_id) {
            return res.status(400).json({ error: 'customer_id query parameter is required' });
        }

        const response = await axios.get(`${JUSPAY_BASE_URL}/customers/${customer_id}/mandates`, {
            httpsAgent,
            headers: getAuthHeaders(customer_id)
        });

        res.json(response.data);
    } catch (error) {
        console.error('List Mandates Error:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { error: 'Failed to list mandates' });
    }
});

/**
 * POST /api/mandates/:mandateId/status
 * Mandate Status Check API
 * Ref: https://docs.hdfcbank.juspay.in/docs/.../mandates-status-check-api
 */
router.post('/mandates/:mandateId/status', async (req, res) => {
    try {
        const { mandateId } = req.params;

        const formData = {
            merchant_id: JUSPAY_MERCHANT_ID,
            command: 'check_status'
        };

        const response = await axios.post(
            `${JUSPAY_BASE_URL}/mandates/${mandateId}`,
            qs.stringify(formData),
            { httpsAgent, headers: getAuthHeaders() }
        );

        res.json(response.data);
    } catch (error) {
        console.error('Mandate Status Error:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { error: 'Mandate status check failed' });
    }
});

/**
 * POST /api/mandates/:mandateId/execute
 * Mandate Execution API (Auto-debit of subscription)
 * Ref: https://docs.hdfcbank.juspay.in/docs/.../mandate-execution-api
 */
router.post('/mandates/:mandateId/execute', async (req, res) => {
    try {
        const { mandateId } = req.params;
        const {
            amount,
            order_id,
            customer_id,
            notification_id
        } = req.body;

        const formData = {
            mandate_id: mandateId,
            'order.amount': amount.toString(),
            'order.order_id': order_id || `exec_${Date.now()}`,
            merchant_id: JUSPAY_MERCHANT_ID,
            format: 'json'
        };

        if (customer_id) formData['order.customer_id'] = customer_id;
        if (notification_id) formData.notification_id = notification_id;

        const response = await axios.post(
            `${JUSPAY_BASE_URL}/txns`,
            qs.stringify(formData),
            { httpsAgent, headers: getAuthHeaders() }
        );

        res.json(response.data);
    } catch (error) {
        console.error('Mandate Execute Error:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { error: 'Mandate execution failed' });
    }
});

/**
 * POST /api/mandates/:mandateId/revoke
 * Revoke Mandate API
 * Ref: https://docs.hdfcbank.juspay.in/docs/.../revoke-mandate-api
 */
router.post('/mandates/:mandateId/revoke', async (req, res) => {
    try {
        const { mandateId } = req.params;

        const formData = {
            merchant_id: JUSPAY_MERCHANT_ID,
            command: 'revoke'
        };

        const response = await axios.post(
            `${JUSPAY_BASE_URL}/mandates/${mandateId}`,
            qs.stringify(formData),
            { httpsAgent, headers: getAuthHeaders() }
        );

        res.json(response.data);
    } catch (error) {
        console.error('Mandate Revoke Error:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { error: 'Mandate revocation failed' });
    }
});

module.exports = router;
