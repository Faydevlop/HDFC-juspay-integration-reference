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

function getAuthHeaders() {
    return {
        'Authorization': `Basic ${Buffer.from(JUSPAY_API_KEY + ':').toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-merchantid': JUSPAY_MERCHANT_ID,
        'x-merchant-id': JUSPAY_MERCHANT_ID,
    };
}

// ============================================================
// SURCHARGE (CONVENIENCE FEE) APIs
// ============================================================

/**
 * POST /api/surcharge/create-order
 * Create an order WITH surcharge (convenience fee) applied
 * 
 * Surcharge rules must be configured in Juspay Dashboard:
 *   PG Control Center > Surcharge (4th tab) > Add New Rule
 * 
 * Default surcharge: ₹50 flat fee (can be overridden via request body)
 */
router.post('/create-order', async (req, res) => {
    try {
        const {
            amount,
            currency = 'INR',
            customer_id,
            customer_email,
            customer_phone,
            surcharge_amount = '50.00',   // Default ₹50 convenience fee
            tax_amount = '9.00',          // Default ₹9 tax on surcharge (18% GST)
            return_url
        } = req.body;

        const order_id = `surcharge_${Date.now()}`;
        const totalAmount = parseFloat(amount) + parseFloat(surcharge_amount) + parseFloat(tax_amount);

        console.log('===========================================');
        console.log('💰 SURCHARGE ORDER');
        console.log('   Order Amount:    ₹' + amount);
        console.log('   Surcharge:       ₹' + surcharge_amount);
        console.log('   Tax on Surcharge:₹' + tax_amount);
        console.log('   Total:           ₹' + totalAmount.toFixed(2));
        console.log('===========================================');

        const formData = {
            order_id,
            amount: totalAmount.toFixed(2),
            currency,
            customer_id: customer_id || `cust_${Date.now()}`,
            customer_email: customer_email || 'test@example.com',
            customer_phone: customer_phone || '9876543210',
            payment_page_client_id: PAYMENT_PAGE_CLIENT_ID,
            action: 'paymentPage',
            // Surcharge fields
            surcharge_amount: surcharge_amount,
            tax_amount: tax_amount,
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

        // Update order with Juspay response
        await Order.findOneAndUpdate({ orderId: order_id }, {
            juspayOrderId: response.data.id,
            status: response.data.status
        });

        console.log('✅ Surcharge order created:', order_id);
        console.log('   Payment page link:', response.data.payment_links?.web || 'N/A');

        res.status(201).json({
            ...response.data,
            surcharge_info: {
                base_amount: parseFloat(amount),
                surcharge_amount: parseFloat(surcharge_amount),
                tax_amount: parseFloat(tax_amount),
                total_amount: totalAmount
            }
        });
    } catch (error) {
        console.error('Surcharge Order Error:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { error: 'Surcharge order creation failed' });
    }
});

/**
 * GET /api/surcharge/order/:orderId
 * Get order details with surcharge breakdown
 */
router.get('/order/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;

        const response = await axios.get(`${JUSPAY_BASE_URL}/orders/${orderId}`, {
            httpsAgent,
            headers: getAuthHeaders()
        });

        const data = response.data;
        const txnDetail = data.txn_detail || {};

        console.log('===========================================');
        console.log('📋 SURCHARGE ORDER STATUS:', orderId);
        console.log('   Status:', data.status);
        console.log('   Order Amount:', data.amount);
        console.log('   Surcharge:', txnDetail.surcharge_amount || 'N/A');
        console.log('   Tax:', txnDetail.tax_amount || 'N/A');
        console.log('   Net Amount:', txnDetail.net_amount || data.amount);
        console.log('===========================================');

        res.json(data);
    } catch (error) {
        console.error('Surcharge Order Status Error:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { error: 'Failed to get surcharge order' });
    }
});

/**
 * POST /api/surcharge/refund
 * Refund a surcharge order
 * 
 * Note: Whether surcharge is included in refund depends on Dashboard setting:
 *   Dashboard > Enable "Include Surcharge Amount in Refund" flag
 *   - If enabled: Full refund includes surcharge
 *   - If disabled: Partial refund excluding surcharge
 */
router.post('/refund', async (req, res) => {
    try {
        const {
            order_id,
            amount,                          // refund amount
            include_surcharge = false        // whether to include surcharge in refund
        } = req.body;

        if (!order_id) {
            return res.status(400).json({ error: 'order_id is required' });
        }

        // First get the order to check surcharge details
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

        const txnDetail = orderData.txn_detail || {};
        const surchargeAmt = parseFloat(txnDetail.surcharge_amount) || 0;
        const taxAmt = parseFloat(txnDetail.tax_amount) || 0;
        const netAmount = parseFloat(txnDetail.net_amount) || parseFloat(orderData.amount);

        // Calculate refund amount
        let refundAmount;
        if (amount) {
            refundAmount = parseFloat(amount);
        } else if (include_surcharge) {
            refundAmount = netAmount; // full amount including surcharge
        } else {
            refundAmount = netAmount - surchargeAmt - taxAmt; // exclude surcharge
        }

        console.log('===========================================');
        console.log('💸 SURCHARGE REFUND');
        console.log('   Order:', order_id);
        console.log('   Net Amount:', netAmount);
        console.log('   Surcharge:', surchargeAmt);
        console.log('   Tax:', taxAmt);
        console.log('   Include Surcharge:', include_surcharge);
        console.log('   Refund Amount:', refundAmount);
        console.log('===========================================');

        const unique_request_id = `refund_${Date.now()}`;

        const formData = {
            order_id,
            amount: refundAmount.toFixed(2),
            unique_request_id
        };

        const response = await axios.post(
            `${JUSPAY_BASE_URL}/orders/${order_id}/refunds`,
            qs.stringify(formData),
            { httpsAgent, headers: getAuthHeaders() }
        );

        // Update local DB
        await Order.findOneAndUpdate({ orderId: order_id }, {
            status: 'REFUND_INITIATED'
        });

        res.json({
            ...response.data,
            refund_info: {
                refund_amount: refundAmount,
                surcharge_included: include_surcharge,
                surcharge_amount: surchargeAmt,
                tax_amount: taxAmt
            }
        });
    } catch (error) {
        console.error('Surcharge Refund Error:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { error: 'Surcharge refund failed' });
    }
});

module.exports = router;
