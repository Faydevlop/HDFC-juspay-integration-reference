const fs = require('fs');
const https = require('https');
const path = require('path');
const config = require('../keys/config.json');

// Paths to PEM files
const privateKeyPath = path.join(__dirname, '../keys', config.PRIVATE_KEY_PATH);
const publicKeyPath = path.join(__dirname, '../keys', config.PUBLIC_KEY_PATH);

console.log('Loading PEM files:');
console.log('Private Key Path:', privateKeyPath);
console.log('Public Key Path:', publicKeyPath);

let httpsAgent;
const certContent = fs.readFileSync(publicKeyPath, 'utf8');
const keyContent = fs.readFileSync(privateKeyPath, 'utf8');

const isCert = certContent.includes('-----BEGIN CERTIFICATE-----');
const isKey = keyContent.includes('-----BEGIN RSA PRIVATE KEY-----') || keyContent.includes('-----BEGIN PRIVATE KEY-----');

console.log('Cert detection:', isCert ? 'Certificate found' : 'Public key found (Not a Cert)');
console.log('Key detection:', isKey ? 'Private key found' : 'No Private key');

if (isCert && isKey) {
    httpsAgent = new https.Agent({
        cert: certContent,
        key: keyContent,
        rejectUnauthorized: false
    });
    console.log('mTLS HTTPS Agent initialized with Cert/Key');
} else {
    // If we only have a public key and private key, they might be for signing, not mTLS
    httpsAgent = new https.Agent({ rejectUnauthorized: false });
    console.log('Standard HTTPS Agent initialized (mTLS disabled due to missing cert)');
}

/**
 * Generates Basic Auth header for Juspay
 * Juspay usually needs Basic Auth for most API calls.
 */
const getAuthHeaders = (routingId) => {
    // Standard Juspay/HDFC Auth: API_KEY as username, empty password
    const apiKey = process.env.JUSPAY_API_KEY || config.KEY_UUID;
    const merchantId = process.env.JUSPAY_MERCHANT_ID || config.MERCHANT_ID;

    const auth = Buffer.from(`${apiKey}:`).toString('base64');

    const headers = {
        'Authorization': `Basic ${auth}`,
        'x-merchantid': merchantId,
        'Content-Type': 'application/x-www-form-urlencoded',
    };

    // x-routing-id is recommended by HDFC for tracking
    if (routingId) {
        headers['x-routing-id'] = routingId;
    }

    return headers;
};

module.exports = {
    httpsAgent,
    getAuthHeaders,
    config
};
