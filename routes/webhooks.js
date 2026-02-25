const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const { verifyRsaSignature } = require('../utils/signature');

/**
 * @route POST /webhook/juspay
 * @desc Handle Juspay webhook notifications
 */
router.post('/juspay', express.raw({ type: 'application/json' }), async (req, res) => {
    const signature = req.headers['x-juspay-signature'];
    const payload = req.body.toString(); // express.raw gives buffer

    try {
        // 1. Verify Signature
        // Assuming RSA signature verification with Juspay Public Key
        const isValid = verifyRsaSignature(payload, signature);

        if (!isValid) {
            console.warn('Invalid Webhook Signature');
            return res.status(401).send('Invalid signature');
        }

        const event = JSON.parse(payload);
        const { event_name, content } = event;
        const orderData = content.order;

        console.log(`Received Webhook Event: ${event_name} for Order: ${orderData.order_id}`);

        // 2. Update Local DB Status
        await Order.findOneAndUpdate(
            { orderId: orderData.order_id },
            {
                status: orderData.status,
                metadata: orderData // Update with latest details
            }
        );

        // 3. Respond with 200 OK
        res.status(200).send('Webhook processed');
    } catch (error) {
        console.error('Webhook processing error:', error.message);
        res.status(500).send('Internal Server Error');
    }
});

module.exports = router;
