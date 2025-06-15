// server.js - Main server entry point with improved organization
const express = require('express');
const cors = require('cors');
const logger = require('./utils/logger');
const config = require('./config');
const { setupMiddleware } = require('./middleware');
const { setupRoutes } = require('./routes');
const { browserManager } = require('./services/browserManager');
const { statusManager } = require('./services/statusManager');
const { historyManager } = require('./services/historyManager');
const { shutdownManager } = require('./utils/shutdownManager');

const app = express();

// Setup middleware
setupMiddleware(app);

// Setup routes
setupRoutes(app);

// Global error handler
app.use((err, req, res, next) => {
  logger.error('Global error handler:', err);
  
  // Handle CORS errors
  if (err.message && err.message.includes('CORS')) {
    return res.status(403).json({
      error: 'CORS error',
      message: err.message
    });
  }
  
  // Handle validation errors
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation error',
      message: err.message
    });
  }
  
  // Handle timeout errors
  if (err.message && err.message.includes('timeout')) {
    return res.status(408).json({
      error: 'Request timeout',
      message: 'Operation timed out'
    });
  }
  
  // Default error response
  res.status(500).json({
    error: 'Internal server error',
    message: config.isDevelopment ? err.message : 'An unexpected error occurred'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    message: `Endpoint ${req.method} ${req.path} not found`
  });
});

// Periodic cleanup
setInterval(() => {
  statusManager.cleanup();
  browserManager.cleanup();
}, config.CLEANUP_INTERVAL);

// Start server
const server = app.listen(config.PORT, '0.0.0.0', () => {
  logger.info(`
╔════════════════════════════════════════════════════╗
║       Salesforce Automation Backend Started        ║
╠════════════════════════════════════════════════════╣
║ Port:        ${config.PORT.toString().padEnd(38)}║
║ Environment: ${config.NODE_ENV.padEnd(38)}║
║ API Key:     ${(config.API_KEY ? 'Enabled' : 'Disabled').padEnd(38)}║
║ Frontend:    ${config.FRONTEND_URL.padEnd(38).substring(0, 38)}║
║ Version:     ${config.VERSION.padEnd(38)}║
╚════════════════════════════════════════════════════╝
  `);
});

// Setup graceful shutdown
shutdownManager.setup(server);

module.exports = { app, server };