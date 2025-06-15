// services/statusManager.js - Status and SSE management
const config = require('../config');
const logger = require('../utils/logger');

class StatusManager {
  constructor() {
    this.statusStore = new Map();
    this.sseClients = new Map();
  }

  broadcastStatus(sessionId, data) {
    try {
      // Add timestamp
      data.timestamp = Date.now();
      
      // Validate screenshot before sending
      if (data.screenshot) {
        const isValidScreenshot = this.validateScreenshotData(data.screenshot);
        if (!isValidScreenshot) {
          logger.warn('Invalid screenshot data detected, removing from broadcast');
          delete data.screenshot;
        }
      }
      
      // Send to SSE clients
      const client = this.sseClients.get(sessionId);
      if (client && !client.destroyed) {
        try {
          // Handle large screenshots by chunking
          if (data.screenshot && data.screenshot.length >= 100000) {
            // Send status without screenshot first
            const statusWithoutScreenshot = { ...data };
            delete statusWithoutScreenshot.screenshot;
            client.write(`data: ${JSON.stringify(statusWithoutScreenshot)}\n\n`);
            
            // Send screenshot separately after a short delay
            setTimeout(() => {
              try {
                client.write(`data: ${JSON.stringify({ 
                  type: 'screenshot',
                  orgId: data.orgId,
                  upgradeId: data.upgradeId,
                  status: data.status,
                  message: data.message,
                  screenshot: data.screenshot 
                })}\n\n`);
              } catch (chunkError) {
                logger.error('Error sending screenshot chunk', chunkError);
              }
            }, 100);
          } else {
            // Normal size, send together
            client.write(`data: ${JSON.stringify(data)}\n\n`);
          }
        } catch (writeError) {
          logger.error('Error writing to SSE client', writeError);
          this.sseClients.delete(sessionId);
        }
      }
      
      // Store for polling with memory management
      const key = `${sessionId}-${data.orgId || 'batch'}`;
      this.statusStore.set(key, data);
      
      // Prevent memory bloat
      if (this.statusStore.size > config.MAX_STATUS_ENTRIES) {
        const oldestKey = this.statusStore.keys().next().value;
        this.statusStore.delete(oldestKey);
      }
      
      logger.statusUpdate(sessionId, data.orgId || 'batch', data.status || data.type);
    } catch (error) {
      logger.error('Error broadcasting status', error);
    }
  }

  validateScreenshotData(screenshot) {
    if (!screenshot || typeof screenshot !== 'string') {
      return false;
    }
    
    if (!screenshot.startsWith('data:image/')) {
      return false;
    }
    
    if (!screenshot.includes('base64,')) {
      return false;
    }
    
    const base64Part = screenshot.split('base64,')[1];
    if (!base64Part) {
      return false;
    }
    
    const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
    if (!base64Regex.test(base64Part)) {
      return false;
    }
    
    if (base64Part.length % 4 !== 0) {
      return false;
    }
    
    return true;
  }

  setupSSE(sessionId, res) {
    // Prevent too many connections
    if (this.sseClients.size > 100) {
      return res.status(503).json({ error: 'Too many active connections' });
    }
    
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    this.sseClients.set(sessionId, res);
    
    // Send initial connection
    res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`);
    
    // Heartbeat to keep connection alive
    const heartbeat = setInterval(() => {
      if (res.destroyed) {
        clearInterval(heartbeat);
        return;
      }
      try {
        res.write(`data: ${JSON.stringify({ type: 'heartbeat', timestamp: Date.now() })}\n\n`);
      } catch (error) {
        clearInterval(heartbeat);
        this.sseClients.delete(sessionId);
      }
    }, 30000);
    
    // Cleanup on disconnect
    const cleanup = () => {
      clearInterval(heartbeat);
      this.sseClients.delete(sessionId);
      logger.debug(`SSE client disconnected: ${sessionId}`);
    };
    
    res.on('close', cleanup);
    res.on('error', cleanup);
  }

  getSessionStatuses(sessionId) {
    const statuses = {};
    
    for (const [key, value] of this.statusStore.entries()) {
      if (key.startsWith(sessionId)) {
        const orgId = key.split('-').slice(1).join('-');
        statuses[orgId] = value;
      }
    }
    
    return statuses;
  }

  storeConfirmation(sessionId, upgradeId, confirmed) {
    const confirmationKey = `${sessionId}-${upgradeId}-confirmation`;
    this.statusStore.set(confirmationKey, { 
      confirmed,
      timestamp: Date.now()
    });
  }

  getConfirmation(sessionId, upgradeId) {
    const confirmationKey = `${sessionId}-${upgradeId}-confirmation`;
    const confirmation = this.statusStore.get(confirmationKey);
    if (confirmation) {
      this.statusStore.delete(confirmationKey);
    }
    return confirmation;
  }

  storeVerificationCode(sessionId, upgradeId, verificationCode) {
    const verificationKey = `${sessionId}-${upgradeId}-verification`;
    this.statusStore.set(verificationKey, { 
      verificationCode,
      timestamp: Date.now()
    });
  }

  getVerificationCode(sessionId, upgradeId) {
    const verificationKey = `${sessionId}-${upgradeId}-verification`;
    const verification = this.statusStore.get(verificationKey);
    if (verification) {
      this.statusStore.delete(verificationKey);
    }
    return verification;
  }

  cleanup() {
    const oneHourAgo = Date.now() - config.STATUS_RETENTION_TIME;
    let cleaned = 0;
    
    // Clean old status entries
    for (const [key, value] of this.statusStore.entries()) {
      if (value.timestamp && value.timestamp < oneHourAgo) {
        this.statusStore.delete(key);
        cleaned++;
      }
    }
    
    // Clean disconnected SSE clients
    for (const [sessionId, client] of this.sseClients.entries()) {
      if (client.destroyed || client.readyState !== 1) {
        this.sseClients.delete(sessionId);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      logger.debug(`Status cleanup: removed ${cleaned} stale entries`);
    }
  }

  getStats() {
    return {
      statusEntries: this.statusStore.size,
      activeClients: this.sseClients.size
    };
  }
}

module.exports = {
  statusManager: new StatusManager()
};