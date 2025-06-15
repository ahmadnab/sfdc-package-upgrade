// utils/shutdownManager.js - Graceful shutdown handling
const logger = require('./logger');
const { browserManager } = require('../services/browserManager');
const { statusManager } = require('../services/statusManager');
const { historyManager } = require('../services/historyManager');

class ShutdownManager {
  constructor() {
    this.server = null;
    this.isShuttingDown = false;
  }

  setup(server) {
    this.server = server;
    
    // Register shutdown handlers
    process.on('SIGTERM', () => this.shutdown('SIGTERM'));
    process.on('SIGINT', () => this.shutdown('SIGINT'));
    
    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception', error);
      this.shutdown('UNCAUGHT_EXCEPTION');
    });
    
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Rejection at:', { promise, reason });
    });
  }

  async shutdown(signal) {
    if (this.isShuttingDown) {
      logger.info('Shutdown already in progress...');
      return;
    }
    
    this.isShuttingDown = true;
    logger.info(`${signal} received: starting graceful shutdown`);
    
    try {
      // Stop accepting new connections
      if (this.server) {
        await new Promise((resolve) => {
          this.server.close(resolve);
        });
        logger.info('HTTP server closed');
      }
      
      // Close all SSE connections
      const sseStats = statusManager.getStats();
      logger.info(`Closing ${sseStats.activeClients} SSE connections...`);
      
      // Close all browsers
      const browserStats = browserManager.getStats();
      logger.info(`Closing ${browserStats.activeBrowserCount} active browsers...`);
      
      // Wait for all browsers to close
      const closePromises = [];
      for (const [browserId] of browserManager.browserPool) {
        closePromises.push(browserManager.releaseBrowser(browserId));
      }
      await Promise.all(closePromises);
      
      // Save any pending history
      logger.info('Saving history...');
      const history = await historyManager.loadHistory();
      await historyManager.saveHistory(history);
      
      logger.info('Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown', error);
      process.exit(1);
    }
  }
}

module.exports = {
  shutdownManager: new ShutdownManager()
};