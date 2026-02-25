const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const winston = require('winston');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Important: Do not use global express.json() before the webhook route
// because the webhook needs raw body for signature verification.

// Logger setup
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
        new winston.transports.File({ filename: 'logs/combined.log' }),
        new winston.transports.Console({ format: winston.format.simple() })
    ]
});

const dns = require('dns');

// Fix for Atlas DNS resolution
dns.setServers(["8.8.8.8", "8.8.4.4"]);

// Database connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/juspay_test', {
    serverSelectionTimeoutMS: 5000,
    family: 4, // Force IPv4
}).then(() => {
    logger.info('Connected to MongoDB');
}).catch(err => {
    logger.error('Mongoose connection error (main connection):', err);
});

// Routes
const paymentRoutes = require('./routes/payments');
const webhookRoutes = require('./routes/webhooks');
const surchargeRoutes = require('./routes/surcharge');

app.use('/api', express.json(), express.urlencoded({ extended: true }), paymentRoutes); // JSON and Form parsing for API
app.use('/api/surcharge', express.json(), express.urlencoded({ extended: true }), surchargeRoutes); // Surcharge APIs
app.use('/webhook', webhookRoutes);            // Raw parsing handled inside webhookRoutes

// Error Handling
app.use((err, req, res, next) => {
    logger.error(`${err.status || 500} - ${err.message} - ${req.originalUrl} - ${req.method} - ${req.ip}`);
    res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

app.listen(PORT, () => {
    logger.info(`Server running on http://localhost:${PORT}`);
});
