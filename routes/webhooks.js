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
        console.log('FULL WEBHOOK PAYLOAD (Check for card_token here):', JSON.stringify(event, null, 2));

        // Specifically log card token if found in the payload
        const cardData = orderData.card || content.card;
        const cardToken = cardData?.card_token
            || (cardData?.tokens && cardData.tokens.length > 0 && cardData.tokens[0].token)
            || content.card_token
            || null;

        if (cardToken) {
            console.log('===========================================');
            console.log('🎉 CARD TOKEN IS HERE ->', cardToken);
            console.log('   Card Network:', cardData?.card_brand);
            console.log('   Last Four:', cardData?.last_four_digits);
            console.log('   Customer:', orderData.customer_id);
            console.log('===========================================');
        }

        // 2. Update Local DB Status (including card token if found)
        const updateData = {
            status: orderData.status,
            metadata: orderData
        };

        if (cardToken) {
            updateData.cardToken = cardToken;
            updateData.cardNetwork = cardData?.card_brand;
            updateData.cardLastFour = cardData?.last_four_digits;
            updateData.cardType = cardData?.card_type;
            updateData.savedToLocker = true;
        }

        await Order.findOneAndUpdate(
            { orderId: orderData.order_id },
            updateData
        );

        // 3. Respond with 200 OK
        res.status(200).send('Webhook processed');
    } catch (error) {
        console.error('Webhook processing error:', error.message);
        res.status(500).send('Internal Server Error');
    }
});

module.exports = router;
