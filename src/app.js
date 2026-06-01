'use strict';

require('dotenv').config();

const express = require('express');
const { pool } = require('./db');
const { redis } = require('./redis');
const tradesRouter = require('./routes/trades');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Routes
app.use('/', tradesRouter);

// Start server
const server = app.listen(PORT, () => {
  console.log(`Prediction market app listening on port ${PORT}`);
});

// Graceful shutdown on SIGTERM (important for queue correctness in later phases)
process.on('SIGTERM', () => {
  console.log('SIGTERM received — shutting down gracefully');
  server.close(async () => {
    console.log('HTTP server closed');
    try {
      await pool.end();
      console.log('pg pool closed');
    } catch (err) {
      console.error('Error closing pg pool:', err.message);
    }
    try {
      await redis.quit();
      console.log('Redis connection closed');
    } catch (err) {
      console.error('Error closing Redis:', err.message);
    }
    process.exit(0);
  });
});

module.exports = app;
