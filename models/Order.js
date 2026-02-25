const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
    orderId: { type: String, required: true, unique: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'INR' },
    status: { type: String, default: 'CREATED' }, // CREATED, PENDING, CHARGED, FAILED
    customerId: String,
    juspayOrderId: String, // Internal ID from Juspay if different
    mandateId: String,
    // CVV-less card token fields
    cardToken: String,
    cardNetwork: String,       // VISA, MASTERCARD, etc.
    cardLastFour: String,      // last 4 digits for display
    cardType: String,          // CREDIT, DEBIT
    savedToLocker: { type: Boolean, default: false },
    metadata: Object,
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Order', orderSchema);
