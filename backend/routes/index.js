// routes/index.js - API routes definition
const { authenticate, validatePackageId, asyncHandler } = require('../middleware');
const { statusManager } = require('../services/statusManager');
const { historyManager } = require('../services/historyManager');
const { upgradeService } = require('../services/upgradeService');
const { orgManager } = require('../services/orgManager');
const config = require('../config');
const logger = require('../utils/logger');

const setupRoutes = (app) => {
  // Health check
  app.get('/health', (req, res) => {
    res.json({ 
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: config.VERSION,
      environment: config.NODE_ENV,
      memory: process.memoryUsage(),
      activeBrowsers: require('../services/browserManager').browserManager.getStats(),
      uptime: process.uptime()
    });
  });

  // Root endpoint
  app.get('/', (req, res) => {
    res.json({ 
      message: 'Salesforce Automation Backend',
      version: config.VERSION,
      endpoints: [
        { path: '/health', method: 'GET', description: 'Health check' },
        { path: '/api/orgs', method: 'GET', description: 'List organizations' },
        { path: '/api/upgrade', method: 'POST', description: 'Single org upgrade' },
        { path: '/api/upgrade-batch', method: 'POST', description: 'Batch upgrade' },
        { path: '/api/confirm-upgrade', method: 'POST', description: 'Confirm upgrade version' },
        { path: '/api/submit-verification', method: 'POST', description: 'Submit verification code' },
        { path: '/api/history', method: 'GET', description: 'Upgrade history' },
        { path: '/api/status/:sessionId', method: 'GET', description: 'Status updates (polling)' },
        { path: '/api/status-stream/:sessionId', method: 'GET', description: 'Status updates (SSE)' }
      ]
    });
  });

  // SSE endpoint
  app.get('/api/status-stream/:sessionId', authenticate, asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    
    if (!sessionId || sessionId.length < 10) {
      return res.status(400).json({ error: 'Invalid session ID' });
    }
    
    statusManager.setupSSE(sessionId, res);
  }));

  // Polling endpoint
  app.get('/api/status/:sessionId', authenticate, asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    
    if (!sessionId || sessionId.length < 10) {
      return res.status(400).json({ error: 'Invalid session ID' });
    }
    
    const statuses = statusManager.getSessionStatuses(sessionId);
    res.json(statuses);
  }));

  // User confirmation endpoint
  app.post('/api/confirm-upgrade', authenticate, asyncHandler(async (req, res) => {
    const { sessionId, upgradeId, confirmed } = req.body;
    
    if (!sessionId || !upgradeId || typeof confirmed !== 'boolean') {
      return res.status(400).json({ 
        error: 'Validation error',
        message: 'Missing required fields: sessionId, upgradeId, confirmed (boolean)'
      });
    }
    
    statusManager.storeConfirmation(sessionId, upgradeId, confirmed);
    
    res.json({ 
      message: `Upgrade ${confirmed ? 'confirmed' : 'cancelled'}`,
      upgradeId,
      confirmed
    });
  }));

  // Verification code submission
  app.post('/api/submit-verification', authenticate, asyncHandler(async (req, res) => {
    const { sessionId, upgradeId, verificationCode } = req.body;
    
    if (!sessionId || !upgradeId || !verificationCode) {
      return res.status(400).json({ 
        error: 'Validation error',
        message: 'Missing required fields: sessionId, upgradeId, verificationCode'
      });
    }
    
    if (!/^\d{6}$/.test(verificationCode)) {
      return res.status(400).json({ 
        error: 'Validation error',
        message: 'Verification code must be 6 digits'
      });
    }
    
    statusManager.storeVerificationCode(sessionId, upgradeId, verificationCode);
    
    res.json({ 
      message: 'Verification code submitted',
      upgradeId
    });
  }));

  // Get organizations
  app.get('/api/orgs', authenticate, asyncHandler(async (req, res) => {
    try {
      const orgs = await orgManager.getOrgs();
      res.json(orgs);
    } catch (error) {
      logger.error('Error loading orgs', error);
      res.status(500).json({ 
        error: 'Configuration error',
        message: error.message
      });
    }
  }));

  // Get history
  app.get('/api/history', authenticate, asyncHandler(async (req, res) => {
    try {
      const { limit = 50, offset = 0 } = req.query;
      const history = await historyManager.getHistory(
        parseInt(offset.toString()),
        parseInt(limit.toString())
      );
      res.json(history);
    } catch (error) {
      logger.error('Error fetching history', error);
      res.status(500).json({ 
        error: 'Server error',
        message: 'Failed to fetch history',
        upgrades: [],
        total: 0,
        limit: 50,
        offset: 0
      });
    }
  }));

  // Single upgrade
  app.post('/api/upgrade', authenticate, validatePackageId, asyncHandler(async (req, res) => {
    const { orgId, packageUrl, sessionId } = req.body;
    
    if (!orgId || !sessionId) {
      return res.status(400).json({ 
        error: 'Validation error',
        message: 'Missing required fields: orgId, sessionId'
      });
    }
    
    if (sessionId.length < 10) {
      return res.status(400).json({ 
        error: 'Validation error',
        message: 'Invalid session ID format'
      });
    }
    
    try {
      const org = await orgManager.getOrgById(orgId);
      
      if (!org) {
        return res.status(404).json({ 
          error: 'Not found',
          message: `Organization ${orgId} not found`
        });
      }
      
      const upgradeId = `upgrade-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      res.json({ 
        message: 'Upgrade process started',
        upgradeId,
        sessionId,
        estimatedDuration: '2-5 minutes',
        org: org.name
      });
      
      // Run in background
      upgradeService.upgradePackage(org, packageUrl, sessionId, upgradeId)
        .catch(error => {
          logger.error(`Upgrade ${upgradeId} failed`, error);
          statusManager.broadcastStatus(sessionId, {
            type: 'status',
            orgId: org.id,
            upgradeId,
            status: 'error',
            message: `Critical error: ${error.message}`
          });
        });
        
    } catch (error) {
      logger.error('Error starting upgrade', error);
      res.status(500).json({ 
        error: 'Server error',
        message: error.message
      });
    }
  }));

  // Batch upgrade
  app.post('/api/upgrade-batch', authenticate, validatePackageId, asyncHandler(async (req, res) => {
    const { orgIds, packageUrl, maxConcurrent = 1, sessionId } = req.body;
    
    if (!orgIds || !Array.isArray(orgIds) || orgIds.length === 0) {
      return res.status(400).json({ 
        error: 'Validation error',
        message: 'No organizations selected for batch upgrade'
      });
    }
    
    if (!sessionId || sessionId.length < 10) {
      return res.status(400).json({ 
        error: 'Validation error',
        message: 'Session ID is required and must be valid format'
      });
    }
    
    if (orgIds.length > 50) {
      return res.status(400).json({ 
        error: 'Validation error',
        message: 'Maximum 50 organizations allowed per batch'
      });
    }
    
    const limitedConcurrent = Math.min(Math.max(1, maxConcurrent), 4);
    
    try {
      const orgsToUpgrade = await orgManager.getOrgsByIds(orgIds);
      
      if (orgsToUpgrade.length === 0) {
        return res.status(404).json({ 
          error: 'Not found',
          message: 'No valid organizations found'
        });
      }
      
      const batchId = `batch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      res.json({ 
        message: 'Batch upgrade process started',
        batchId,
        sessionId,
        orgsCount: orgsToUpgrade.length,
        maxConcurrent: limitedConcurrent,
        estimatedDuration: `${orgsToUpgrade.length * 3}-${orgsToUpgrade.length * 5} minutes`,
        orgs: orgsToUpgrade.map(org => ({ id: org.id, name: org.name }))
      });
      
      // Run in background
      upgradeService.runBatchUpgrade(orgsToUpgrade, packageUrl, sessionId, batchId, limitedConcurrent)
        .catch(error => {
          logger.error(`Batch ${batchId} failed`, error);
          statusManager.broadcastStatus(sessionId, {
            type: 'batch-status',
            batchId,
            status: 'error',
            message: `Critical error: ${error.message}`
          });
        });
        
    } catch (error) {
      logger.error('Error starting batch upgrade', error);
      res.status(500).json({ 
        error: 'Server error',
        message: error.message
      });
    }
  }));
};

module.exports = { setupRoutes };