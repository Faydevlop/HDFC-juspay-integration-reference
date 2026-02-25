const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { config } = require('../middleware/auth');

/**
 * Verify HMAC-SHA256 signature for webhooks
 * @param {string} payload - Raw stringified body
 * @param {string} signature - Signature from header
 * @param {string} secret - Webhook secret
 */
const verifyHmacSignature = (payload, signature, secret) => {
    const expected = crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex');
    return expected === signature;
};

/**
 * Verify RSA signature for webhooks (if PEM is used)
 * @param {string} payload - Raw stringified body
 * @param {string} signature - Base64 encoded signature
 */
const verifyRsaSignature = (payload, signature) => {
    const publicKeyPath = path.join(__dirname, '../keys', config.PUBLIC_KEY_PATH);
    const publicKey = fs.readFileSync(publicKeyPath, 'utf8');

    const verifier = crypto.createVerify('SHA256');
    verifier.update(payload);
    return verifier.verify(publicKey, signature, 'base64');
};

module.exports = {
    verifyHmacSignature,
    verifyRsaSignature
};
