const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');
const fs = require('fs').promises;
const path = require('path');

const app = express();

// Constants
const MAX_UPGRADE_DURATION = 240000; // 4 minutes (Cloud Run limit is 5 min)
const MAX_CONCURRENT_BROWSERS = 2; // Limit for memory management
const BROWSER_LAUNCH_TIMEOUT = 60000; // 1 minute for cold starts
const PAGE_LOAD_TIMEOUT = 30000; // 30 seconds
const VERIFICATION_TIMEOUT = 120000; // 2 minutes for manual verification
const CLEANUP_INTERVAL = 30 * 60 * 1000; // 30 minutes
const MAX_HISTORY_ENTRIES = 100;
const MAX_REQUEST_SIZE = '50mb'; // Increased for screenshots

// Global browser pool for resource management
const browserPool = new Map();
let activeBrowserCount = 0;

// Configuration
const config = {
  frontend_url: process.env.FRONTEND_URL || 'http://localhost:3000',
  api_key: process.env.API_KEY,
  port: process.env.PORT || 8080,
  node_env: process.env.NODE_ENV || 'development',
  max_retries: 3,
  retry_delay: 2000,
};

// CORS configuration with validation
const corsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:3001',
      config.frontend_url,
      /https:\/\/.*\.vercel\.app$/,
      /https:\/\/.*\.netlify\.app$/
    ];
    
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);
    
    const isAllowed = allowedOrigins.some(allowed => {
      if (allowed instanceof RegExp) return allowed.test(origin);
      return allowed === origin;
    });
    
    if (isAllowed) {
      callback(null, true);
    } else {
      callback(new Error(`CORS policy: Origin ${origin} not allowed`));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(express.json({ limit: MAX_REQUEST_SIZE }));

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path} - IP: ${req.ip || 'unknown'}`);
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
  });
  
  next();
});

// Error handling middleware
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Authentication middleware
const authenticate = (req, res, next) => {
  if (!config.api_key) return next();
  
  const providedKey = req.headers['x-api-key'] || req.query.api_key;
  
  if (providedKey === config.api_key) {
    next();
  } else {
    res.status(401).json({ 
      error: 'Authentication required',
      message: 'Please provide a valid API key'
    });
  }
};

// Validation middleware
const validatePackageId = (req, res, next) => {
  const { packageUrl } = req.body;
  
  if (!packageUrl) {
    return res.status(400).json({ 
      error: 'Validation error',
      message: 'Package ID is required'
    });
  }
  
  if (!/^04t[a-zA-Z0-9]{12}$/.test(packageUrl)) {
    return res.status(400).json({ 
      error: 'Validation error',
      message: 'Invalid package ID format. Must be 15 characters starting with "04t"'
    });
  }
  
  next();
};

// File paths
const HISTORY_LOG_PATH = '/tmp/upgrade-history.json';

// In-memory stores with size limits
const statusStore = new Map();
const sseClients = new Map();
const MAX_STATUS_ENTRIES = 1000;

// Helper functions
async function loadOrgConfig() {
  try {
    // Environment variable takes precedence
    if (process.env.ORGS_CONFIG) {
      const config = JSON.parse(process.env.ORGS_CONFIG);
      validateOrgConfig(config);
      return config;
    }
    
    // Fallback to file
    const data = await fs.readFile('orgs-config.json', 'utf8');
    const config = JSON.parse(data);
    validateOrgConfig(config);
    return config;
  } catch (error) {
    console.error('Error loading org config:', error.message);
    if (error instanceof SyntaxError) {
      throw new Error('Invalid JSON in org configuration');
    }
    throw error;
  }
}

function validateOrgConfig(config) {
  if (!config.orgs || !Array.isArray(config.orgs)) {
    throw new Error('Invalid org configuration: missing orgs array');
  }
  
  config.orgs.forEach((org, index) => {
    const required = ['id', 'name', 'url', 'username', 'password'];
    const missing = required.filter(field => !org[field]);
    
    if (missing.length > 0) {
      throw new Error(`Org at index ${index} missing required fields: ${missing.join(', ')}`);
    }
    
    if (!org.url.startsWith('https://')) {
      throw new Error(`Org ${org.name} has invalid URL: must start with https://`);
    }
  });
}

async function loadHistory() {
  try {
    const data = await fs.readFile(HISTORY_LOG_PATH, 'utf8');
    const history = JSON.parse(data);
    // Ensure upgrades array exists
    if (!history.upgrades) {
      history.upgrades = [];
    }
    return history;
  } catch (error) {
    return { upgrades: [] };
  }
}

async function saveHistory(history) {
  try {
    // Ensure directory exists
    const dir = path.dirname(HISTORY_LOG_PATH);
    await fs.mkdir(dir, { recursive: true });
    
    // Limit history size
    if (history.upgrades && history.upgrades.length > MAX_HISTORY_ENTRIES) {
      history.upgrades = history.upgrades.slice(0, MAX_HISTORY_ENTRIES);
    }
    
    await fs.writeFile(HISTORY_LOG_PATH, JSON.stringify(history, null, 2));
  } catch (error) {
    console.error('Error saving history:', error);
    // Don't throw - history is not critical
  }
}

async function addToHistory(entry) {
  try {
    const history = await loadHistory();
    if (!history.upgrades) {
      history.upgrades = [];
    }
    history.upgrades.unshift(entry);
    await saveHistory(history);
  } catch (error) {
    console.error('Error adding to history:', error);
  }
}

// Status management with memory limits
function broadcastStatus(sessionId, data) {
  try {
    // Add timestamp
    data.timestamp = Date.now();
    
    // Log significant events
    if (data.type === 'status' && (data.status === 'completed' || data.status === 'error')) {
      console.log(`Status Update: ${data.orgId} - ${data.status}: ${data.message}`);
    }
    
    // Send to SSE clients
    const client = sseClients.get(sessionId);
    if (client && !client.destroyed) {
      try {
        // For very large screenshots, send separately
        if (data.screenshot && data.screenshot.length > 100000) {
          // Send status without screenshot first
          const statusWithoutScreenshot = { ...data };
          delete statusWithoutScreenshot.screenshot;
          client.write(`data: ${JSON.stringify(statusWithoutScreenshot)}\n\n`);
          
          // Then send screenshot separately
          client.write(`data: ${JSON.stringify({ 
            type: 'screenshot',
            orgId: data.orgId,
            screenshot: data.screenshot 
          })}\n\n`);
        } else {
          client.write(`data: ${JSON.stringify(data)}\n\n`);
        }
      } catch (writeError) {
        console.error('Error writing to SSE client:', writeError.message);
        sseClients.delete(sessionId);
      }
    }
    
    // Store for polling with memory management
    const key = `${sessionId}-${data.orgId || 'batch'}`;
    statusStore.set(key, data);
    
    // Prevent memory bloat
    if (statusStore.size > MAX_STATUS_ENTRIES) {
      const oldestKey = statusStore.keys().next().value;
      statusStore.delete(oldestKey);
    }
  } catch (error) {
    console.error('Error broadcasting status:', error);
  }
}

// Browser management with improved error handling
async function acquireBrowser() {
  if (activeBrowserCount >= MAX_CONCURRENT_BROWSERS) {
    throw new Error('Maximum concurrent browser limit reached. Please try again later.');
  }
  
  activeBrowserCount++;
  
  try {
    const browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-site-isolation-trials',
        '--memory-pressure-off',
        '--max_old_space_size=512'
      ],
      timeout: BROWSER_LAUNCH_TIMEOUT
    });
    
    console.log(`Browser launched. Active browsers: ${activeBrowserCount}`);
    return browser;
  } catch (error) {
    activeBrowserCount--;
    throw new Error(`Failed to launch browser: ${error.message}`);
  }
}

async function releaseBrowser(browser) {
  if (!browser) return;
  
  try {
    await browser.close();
    console.log(`Browser closed. Active browsers: ${activeBrowserCount - 1}`);
  } catch (error) {
    console.error('Error closing browser:', error);
  } finally {
    activeBrowserCount = Math.max(0, activeBrowserCount - 1);
  }
}

// API Routes
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.1',
    environment: config.node_env,
    memory: process.memoryUsage(),
    activeBrowsers: activeBrowserCount,
    activeClients: sseClients.size,
    uptime: process.uptime()
  });
});

app.get('/', (req, res) => {
  res.json({ 
    message: 'Salesforce Automation Backend',
    version: '1.0.1',
    endpoints: [
      { path: '/health', method: 'GET', description: 'Health check' },
      { path: '/api/orgs', method: 'GET', description: 'List organizations' },
      { path: '/api/upgrade', method: 'POST', description: 'Single org upgrade' },
      { path: '/api/upgrade-batch', method: 'POST', description: 'Batch upgrade' },
      { path: '/api/confirm-upgrade', method: 'POST', description: 'Confirm upgrade version' },
      { path: '/api/test-screenshot', method: 'POST', description: 'Test server screenshot capture' },
      { path: '/api/history', method: 'GET', description: 'Upgrade history' },
      { path: '/api/status/:sessionId', method: 'GET', description: 'Status updates (polling)' },
      { path: '/api/status-stream/:sessionId', method: 'GET', description: 'Status updates (SSE)' }
    ]
  });
});

// SSE endpoint with improved connection management
app.get('/api/status-stream/:sessionId', authenticate, asyncHandler(async (req, res) => {
  const { sessionId } = req.params;
  
  if (!sessionId || sessionId.length < 10) {
    return res.status(400).json({ error: 'Invalid session ID' });
  }
  
  // Prevent too many connections
  if (sseClients.size > 100) {
    return res.status(503).json({ error: 'Too many active connections' });
  }
  
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  sseClients.set(sessionId, res);
  console.log(`SSE client connected: ${sessionId}. Total clients: ${sseClients.size}`);
  
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
      sseClients.delete(sessionId);
    }
  }, 30000);
  
  // Cleanup on disconnect
  const cleanup = () => {
    clearInterval(heartbeat);
    sseClients.delete(sessionId);
    console.log(`SSE client disconnected: ${sessionId}. Total clients: ${sseClients.size}`);
  };
  
  req.on('close', cleanup);
  req.on('error', cleanup);
  res.on('close', cleanup);
}));

// Polling endpoint with improved error handling
app.get('/api/status/:sessionId', authenticate, asyncHandler(async (req, res) => {
  const { sessionId } = req.params;
  
  if (!sessionId || sessionId.length < 10) {
    return res.status(400).json({ error: 'Invalid session ID' });
  }
  
  const statuses = {};
  
  for (const [key, value] of statusStore.entries()) {
    if (key.startsWith(sessionId)) {
      const orgId = key.split('-').slice(1).join('-');
      statuses[orgId] = value;
    }
  }
  
  res.json(statuses);
}));

// User confirmation endpoint for version verification
app.post('/api/confirm-upgrade', authenticate, asyncHandler(async (req, res) => {
  const { sessionId, upgradeId, confirmed } = req.body;
  
  if (!sessionId || !upgradeId || typeof confirmed !== 'boolean') {
    return res.status(400).json({ 
      error: 'Validation error',
      message: 'Missing required fields: sessionId, upgradeId, confirmed (boolean)'
    });
  }
  
  try {
    // Store the confirmation
    const confirmationKey = `${sessionId}-${upgradeId}-confirmation`;
    statusStore.set(confirmationKey, { 
      confirmed,
      timestamp: Date.now()
    });
    
    console.log(`User confirmation received for ${upgradeId}: ${confirmed ? 'approved' : 'cancelled'}`);
    
    res.json({ 
      message: `Upgrade ${confirmed ? 'confirmed' : 'cancelled'}`,
      upgradeId,
      confirmed
    });
    
  } catch (error) {
    console.error('Error handling confirmation:', error);
    res.status(500).json({ 
      error: 'Server error',
      message: error.message
    });
  }
}));

// Get organizations
app.get('/api/orgs', authenticate, asyncHandler(async (req, res) => {
  try {
    const config = await loadOrgConfig();
    const orgsWithoutPasswords = config.orgs.map(({ password, ...org }) => org);
    res.json(orgsWithoutPasswords);
  } catch (error) {
    console.error('Error loading orgs:', error);
    res.status(500).json({ 
      error: 'Configuration error',
      message: error.message
    });
  }
}));

// Get history with pagination
app.get('/api/history', authenticate, asyncHandler(async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    const history = await loadHistory();
    
    // Ensure upgrades array exists
    const upgrades = history.upgrades || [];
    
    const startIndex = parseInt(offset.toString());
    const endIndex = startIndex + parseInt(limit.toString());
    const paginatedHistory = upgrades.slice(startIndex, endIndex);
    
    res.json({
      upgrades: paginatedHistory,
      total: upgrades.length,
      limit: parseInt(limit.toString()),
      offset: parseInt(offset.toString())
    });
  } catch (error) {
    console.error('Error fetching history:', error);
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

// Force error with screenshot for testing
app.post('/api/force-error-screenshot', authenticate, asyncHandler(async (req, res) => {
  const { sessionId, orgId } = req.body;
  
  if (!sessionId || !orgId) {
    return res.status(400).json({ 
      error: 'Validation error',
      message: 'Missing required fields: sessionId, orgId'
    });
  }
  
  try {
    // Create a test screenshot
    const testScreenshot = await createTestScreenshot();
    
    // Send error status with screenshot
    broadcastStatus(sessionId, {
      type: 'status',
      orgId: orgId,
      upgradeId: 'force-error-test',
      status: 'error',
      message: 'Forced error for screenshot testing - this is a test error',
      screenshot: testScreenshot
    });
    
    res.json({ 
      message: 'Forced error with screenshot sent',
      screenshotSize: testScreenshot.length
    });
    
  } catch (error) {
    console.error('Error forcing screenshot:', error);
    res.status(500).json({ 
      error: 'Server error',
      message: error.message
    });
  }
}));

async function createTestScreenshot() {
  // Create a simple HTML page and screenshot it
  const browser = await acquireBrowser();
  const context = await browser.newContext({
    viewport: { width: 800, height: 600 }
  });
  const page = await context.newPage();
  
  try {
    // Create a test error page
    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Test Error Page</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; background: #f5f5f5; }
          .error { background: #ffebee; border: 2px solid #f44336; padding: 20px; border-radius: 8px; }
          .error h1 { color: #d32f2f; margin-top: 0; }
          .timestamp { color: #666; font-size: 12px; margin-top: 10px; }
        </style>
      </head>
      <body>
        <div class="error">
          <h1>🚨 Test Error</h1>
          <p><strong>Error:</strong> This is a simulated error for testing screenshot capture functionality.</p>
          <p><strong>Package ID:</strong> 04tTEST123456789</p>
          <p><strong>Organization:</strong> Test Org</p>
          <p><strong>Status:</strong> Screenshot capture is working correctly!</p>
          <div class="timestamp">Generated: ${new Date().toISOString()}</div>
        </div>
      </body>
      </html>
    `);
    
    const screenshot = await page.screenshot({ 
      encoding: 'base64',
      fullPage: false,
      type: 'png'
    });
    
    return `data:image/png;base64,${screenshot}`;
    
  } finally {
    await context.close();
    await releaseBrowser(browser);
  }
}

// Manual screenshot test endpoint for debugging
app.post('/api/test-screenshot', authenticate, asyncHandler(async (req, res) => {
  const { orgId, sessionId } = req.body;
  
  if (!orgId || !sessionId) {
    return res.status(400).json({ 
      error: 'Validation error',
      message: 'Missing required fields: orgId, sessionId'
    });
  }
  
  try {
    const config = await loadOrgConfig();
    const org = config.orgs.find(o => o.id === orgId);
    
    if (!org) {
      return res.status(404).json({ 
        error: 'Not found',
        message: `Organization ${orgId} not found`
      });
    }
    
    console.log(`Testing screenshot for org: ${org.name}`);
    
    // Create a test error page and screenshot it (no need to visit actual org)
    const browser = await acquireBrowser();
    const context = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();
    
    try {
      console.log('Creating test error page...');
      
      // Create a realistic error page that looks like a Salesforce error
      await page.setContent(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Package Installation Error - Salesforce</title>
          <style>
            body { 
              font-family: 'Salesforce Sans', Arial, sans-serif; 
              margin: 0; 
              padding: 20px; 
              background: #f3f2f2; 
            }
            .slds-scope { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
            .error-header { 
              background: #c23934; 
              color: white; 
              padding: 15px; 
              margin: -20px -20px 20px -20px;
              border-radius: 8px 8px 0 0;
            }
            .error-content { line-height: 1.6; }
            .package-info { 
              background: #f8f9fa; 
              padding: 15px; 
              border-left: 4px solid #0176d3; 
              margin: 15px 0; 
            }
            .timestamp { color: #666; font-size: 12px; margin-top: 20px; border-top: 1px solid #ddd; padding-top: 10px; }
            .code { font-family: monospace; background: #f1f1f1; padding: 2px 4px; border-radius: 3px; }
          </style>
        </head>
        <body>
          <div class="slds-scope">
            <div class="error-header">
              <h1>⚠️ Package Installation Failed</h1>
            </div>
            <div class="error-content">
              <p><strong>Organization:</strong> ${org.name}</p>
              <p><strong>Error:</strong> This is a <em>simulated error</em> to test screenshot capture functionality.</p>
              
              <div class="package-info">
                <h3>Package Details</h3>
                <p><strong>Package ID:</strong> <span class="code">04tTEST123456789</span></p>
                <p><strong>Version:</strong> 1.0.0.BETA</p>
                <p><strong>Status:</strong> ❌ Installation Failed</p>
              </div>
              
              <p><strong>Possible Causes:</strong></p>
              <ul>
                <li>Missing required permissions</li>
                <li>Package dependencies not met</li>
                <li>Custom objects conflict</li>
                <li>Validation rules blocking installation</li>
              </ul>
              
              <p><strong>Screenshot Test Status:</strong> ✅ Server-side screenshot capture is working correctly!</p>
              
              <div class="timestamp">
                Screenshot captured: ${new Date().toLocaleString()}<br>
                Server: Cloud Run Instance<br>
                Browser: Chromium ${process.version}
              </div>
            </div>
          </div>
        </body>
        </html>
      `);
      
      // Wait a moment for page to render
      await page.waitForTimeout(1000);
      
      console.log('Taking test screenshot...');
      const screenshot = await page.screenshot({ 
        encoding: 'base64',
        fullPage: true,
        type: 'png'
      });
      
      const screenshotData = `data:image/png;base64,${screenshot}`;
      console.log(`✅ Test screenshot captured: ${screenshot.length} bytes`);
      
      // Send via status update as an error with screenshot
      broadcastStatus(sessionId, {
        type: 'status',
        orgId: org.id,
        upgradeId: 'server-screenshot-test',
        status: 'error',
        message: `Server screenshot test completed successfully for ${org.name}`,
        screenshot: screenshotData
      });
      
      res.json({ 
        success: true,
        message: 'Server screenshot test completed and sent via status updates',
        screenshotSize: screenshot.length,
        orgName: org.name
      });
      
    } finally {
      await context.close();
      await releaseBrowser(browser);
    }
    
  } catch (error) {
    console.error('Error capturing test screenshot:', error);
    res.status(500).json({ 
      error: 'Server error',
      message: error.message
    });
  }
}));

// Single upgrade with improved validation
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
    const config = await loadOrgConfig();
    const org = config.orgs.find(o => o.id === orgId);
    
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
    
    // Run in background with comprehensive error handling
    upgradePackage(org, packageUrl, sessionId, upgradeId)
      .catch(error => {
        console.error(`Upgrade ${upgradeId} failed:`, error);
        broadcastStatus(sessionId, {
          type: 'status',
          orgId: org.id,
          upgradeId,
          status: 'error',
          message: `Critical error: ${error.message}`
        });
      });
      
  } catch (error) {
    console.error('Error starting upgrade:', error);
    res.status(500).json({ 
      error: 'Server error',
      message: error.message
    });
  }
}));

// Batch upgrade with improved validation and error handling
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
  
  // Limit concurrent for Cloud Run
  const limitedConcurrent = Math.min(Math.max(1, maxConcurrent), 2);
  
  try {
    const config = await loadOrgConfig();
    const orgsToUpgrade = orgIds.map(id => config.orgs.find(o => o.id === id)).filter(Boolean);
    
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
    runBatchUpgradeParallel(orgsToUpgrade, packageUrl, sessionId, batchId, limitedConcurrent)
      .catch(error => {
        console.error(`Batch ${batchId} failed:`, error);
        broadcastStatus(sessionId, {
          type: 'batch-status',
          batchId,
          status: 'error',
          message: `Critical error: ${error.message}`
        });
      });
      
  } catch (error) {
    console.error('Error starting batch upgrade:', error);
    res.status(500).json({ 
      error: 'Server error',
      message: error.message
    });
  }
}));

// Enhanced batch upgrade implementation
async function runBatchUpgradeParallel(orgs, packageUrl, sessionId, batchId, maxConcurrent = 1) {
  const startTime = Date.now();
  
  broadcastStatus(sessionId, {
    type: 'batch-status',
    batchId,
    status: 'started',
    totalOrgs: orgs.length,
    maxConcurrent,
    message: `Starting batch upgrade for ${orgs.length} organizations`,
    startTime: new Date().toISOString()
  });
  
  let successCount = 0;
  let failureCount = 0;
  let completedCount = 0;
  const results = [];
  
  // Process orgs sequentially for better resource management
  for (const org of orgs) {
    const upgradeId = `${batchId}-${org.id}`;
    const orgStartTime = Date.now();
    
    try {
      broadcastStatus(sessionId, {
        type: 'batch-progress',
        batchId,
        orgId: org.id,
        orgName: org.name,
        status: 'starting',
        completed: completedCount,
        total: orgs.length,
        successCount,
        failureCount
      });
      
      await upgradePackage(org, packageUrl, sessionId, upgradeId, batchId);
      successCount++;
      results.push({ 
        orgId: org.id, 
        orgName: org.name,
        status: 'success',
        duration: Math.round((Date.now() - orgStartTime) / 1000)
      });
      
    } catch (error) {
      console.error(`Batch upgrade error for ${org.name}:`, error);
      failureCount++;
      results.push({ 
        orgId: org.id, 
        orgName: org.name,
        status: 'failed', 
        error: error.message,
        duration: Math.round((Date.now() - orgStartTime) / 1000)
      });
    } finally {
      completedCount++;
      
      // Add small delay between orgs to reduce resource pressure
      if (completedCount < orgs.length) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      broadcastStatus(sessionId, {
        type: 'batch-progress',
        batchId,
        completed: completedCount,
        total: orgs.length,
        successCount,
        failureCount,
        percentComplete: Math.round((completedCount / orgs.length) * 100)
      });
    }
  }
  
  const totalDuration = Date.now() - startTime;
  
  broadcastStatus(sessionId, {
    type: 'batch-status',
    batchId,
    status: 'completed',
    totalOrgs: orgs.length,
    successCount,
    failureCount,
    results,
    message: `Batch upgrade completed: ${successCount} succeeded, ${failureCount} failed`,
    startTime: new Date(startTime).toISOString(),
    endTime: new Date().toISOString(),
    totalDuration: Math.round(totalDuration / 1000)
  });
}

// Enhanced main upgrade function
async function upgradePackage(org, packageUrl, sessionId, upgradeId, batchId = null) {
  let browser;
  let context;
  let page;
  const startTime = new Date();
  let retryCount = 0;
  let failureScreenshot = null;
  
  const historyEntry = {
    id: upgradeId,
    batchId,
    orgId: org.id,
    orgName: org.name,
    packageUrl,
    startTime: startTime.toISOString(),
    endTime: null,
    duration: null,
    status: 'in-progress',
    error: null,
    retries: 0,
    screenshot: null
  };
  
  async function attemptUpgrade() {
    try {
      // Step 1: Launch browser
      broadcastStatus(sessionId, { 
        type: 'status',
        orgId: org.id,
        upgradeId,
        batchId,
        status: 'starting', 
        message: retryCount > 0 ? `Launching browser (retry ${retryCount})...` : 'Launching browser...'
      });
      
      browser = await acquireBrowser();
      
      context = await browser.newContext({
        viewport: { width: 1366, height: 768 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ignoreHTTPSErrors: true,
        locale: 'en-US',
        timezoneId: 'America/New_York',
        httpCredentials: null
      });
      
      page = await context.newPage();
      
      // Set extra headers
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
      });
      
      // Step 2: Navigate to org
      broadcastStatus(sessionId, { 
        type: 'status',
        orgId: org.id,
        upgradeId,
        batchId,
        status: 'navigating', 
        message: `Navigating to ${org.name}...` 
      });
      
      try {
        await page.goto(org.url, { 
          waitUntil: 'networkidle',
          timeout: PAGE_LOAD_TIMEOUT 
        });
      } catch (error) {
        throw new Error(`Failed to load ${org.name}: ${error.message}`);
      }
      
      // Step 3: Login with improved error handling
      broadcastStatus(sessionId, { 
        type: 'status',
        orgId: org.id,
        upgradeId,
        batchId,
        status: 'logging-in', 
        message: 'Entering credentials...' 
      });
      
      try {
        await page.waitForSelector('#username', { timeout: 15000 });
        await page.fill('#username', org.username);
        await page.fill('#password', org.password);
        
        // Click login with improved retry logic
        let loginClicked = false;
        for (let i = 0; i < 3; i++) {
          try {
            await page.click('#Login');
            loginClicked = true;
            break;
          } catch (error) {
            if (i === 2) throw new Error('Failed to click login button after 3 attempts');
            await page.waitForTimeout(1000);
          }
        }
        
        // Wait for navigation after login with better timeout
        await page.waitForLoadState('networkidle', { timeout: PAGE_LOAD_TIMEOUT });
        
      } catch (error) {
        throw new Error(`Login failed: ${error.message}`);
      }
      
      broadcastStatus(sessionId, { 
        type: 'status',
        orgId: org.id,
        upgradeId,
        batchId,
        status: 'logged-in', 
        message: 'Successfully logged in!' 
      });
      
      // Step 4: Check for verification
      const currentUrl = page.url();
      if (currentUrl.includes('verify') || currentUrl.includes('challenge') || currentUrl.includes('2fa')) {
        broadcastStatus(sessionId, { 
          type: 'status',
          orgId: org.id,
          upgradeId,
          batchId,
          status: 'verification-required', 
          message: 'Two-factor authentication required. Cannot proceed automatically.' 
        });
        
        throw new Error('Manual verification required - two-factor authentication detected');
      }
      
      // Step 5: Navigate to package
      broadcastStatus(sessionId, { 
        type: 'status',
        orgId: org.id,
        upgradeId,
        batchId,
        status: 'navigating-package', 
        message: 'Navigating to package installation page...' 
      });
      
      const fullPackageUrl = `${org.url}packaging/installPackage.apexp?p0=${packageUrl}`;
      
      try {
        await page.goto(fullPackageUrl, { 
          waitUntil: 'networkidle',
          timeout: PAGE_LOAD_TIMEOUT 
        });
      } catch (error) {
        throw new Error(`Failed to load package page: ${error.message}`);
      }
      
      // Step 6: Extract version information and request confirmation
      broadcastStatus(sessionId, { 
        type: 'status',
        orgId: org.id,
        upgradeId,
        batchId,
        status: 'extracting-version-info', 
        message: 'Extracting package version information...' 
      });
      
      let versionInfo = null;
      try {
        // Wait for the upgrade text element to be present
        await page.waitForSelector('#upgradeText', { timeout: 10000 });
        
        // Extract version information
        const upgradeTextElement = await page.$('#upgradeText');
        if (upgradeTextElement) {
          const upgradeText = await upgradeTextElement.textContent();
          
          // Extract installed version
          const installedMatch = upgradeText.match(/Installed:\s*([^\s(]+)/);
          const installedVersion = installedMatch ? installedMatch[1] : null;
          
          // Extract new version
          const newVersionMatch = upgradeText.match(/New Version:\s*([^\s(]+)/);
          const newVersion = newVersionMatch ? newVersionMatch[1] : null;
          
          // Extract header message
          const headerMatch = upgradeText.match(/^([^\.]+\.)/);
          const headerMessage = headerMatch ? headerMatch[1] : 'Package upgrade available';
          
          versionInfo = {
            installedVersion,
            newVersion,
            headerMessage: headerMessage.trim(),
            fullText: upgradeText.trim()
          };
          
          console.log('Extracted version info:', versionInfo);
        }
      } catch (error) {
        console.log('Could not extract version info:', error.message);
        // Continue without version info if extraction fails
      }
      
      // Send version info for user confirmation
      if (versionInfo && versionInfo.installedVersion && versionInfo.newVersion) {
        broadcastStatus(sessionId, { 
          type: 'version-confirmation-required',
          orgId: org.id,
          upgradeId,
          batchId,
          status: 'awaiting-confirmation', 
          message: 'Please confirm the package versions before proceeding',
          versionInfo
        });
        
        // Wait for user confirmation (up to 2 minutes)
        let confirmationReceived = false;
        let userConfirmed = false;
        
        const confirmationTimeout = setTimeout(() => {
          if (!confirmationReceived) {
            console.log('Version confirmation timeout for', org.name);
          }
        }, VERIFICATION_TIMEOUT);
        
        // Check for confirmation in a loop
        for (let i = 0; i < 120; i++) { // 2 minutes max wait
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // Check if confirmation was received (this would be set via another API endpoint)
          const confirmationKey = `${sessionId}-${upgradeId}-confirmation`;
          const confirmation = statusStore.get(confirmationKey);
          
          if (confirmation) {
            confirmationReceived = true;
            userConfirmed = confirmation.confirmed;
            statusStore.delete(confirmationKey); // Clean up
            clearTimeout(confirmationTimeout);
            break;
          }
        }
        
        if (!confirmationReceived) {
          throw new Error('User confirmation timeout - no response received within 2 minutes');
        }
        
        if (!userConfirmed) {
          throw new Error('User cancelled the upgrade after reviewing version information');
        }
        
        broadcastStatus(sessionId, { 
          type: 'status',
          orgId: org.id,
          upgradeId,
          batchId,
          status: 'user-confirmed', 
          message: 'User confirmed version upgrade. Proceeding...' 
        });
      }
      
      // Step 7: Find and click upgrade button with enhanced strategies
      broadcastStatus(sessionId, { 
        type: 'status',
        orgId: org.id,
        upgradeId,
        batchId,
        status: 'finding-upgrade-button', 
        message: 'Looking for upgrade button...' 
      });
      
      // CAPTURE SCREENSHOT OF UPGRADE PAGE FOR DEBUGGING
      let upgradePageScreenshot = null;
      try {
        const screenshot = await page.screenshot({ 
          encoding: 'base64',
          fullPage: true,
          type: 'png'
        });
        upgradePageScreenshot = `data:image/png;base64,${screenshot}`;
        console.log('📸 Upgrade page screenshot captured for reference:', screenshot.length, 'bytes');
      } catch (e) {
        console.log('Failed to capture upgrade page screenshot:', e.message);
      }
      
      let buttonClicked = false;
      const buttonStrategies = [
        { selector: 'button[title="Upgrade"]', name: 'title="Upgrade"' },
        { selector: 'button:has-text("Upgrade")', name: 'text "Upgrade"' },
        { selector: 'input[type="submit"][value="Upgrade"]', name: 'submit "Upgrade"' },
        { selector: 'button.installButton', name: 'class installButton' },
        { selector: 'a.btn:has-text("Upgrade")', name: 'link "Upgrade"' },
        { selector: '[name="upgradeButton"]', name: 'name upgradeButton' },
        { selector: '.upgradeBtn', name: 'class upgradeBtn' }
      ];
      
      for (const strategy of buttonStrategies) {
        try {
          await page.waitForSelector(strategy.selector, { timeout: 5000 });
          await page.click(strategy.selector);
          buttonClicked = true;
          console.log(`Clicked upgrade button using: ${strategy.name}`);
          break;
        } catch (error) {
          console.log(`Strategy failed: ${strategy.name}`);
        }
      }
      
      // Try with Playwright's smart selectors
      if (!buttonClicked) {
        try {
          const upgradeButton = await page.getByRole('button', { name: /upgrade/i });
          await upgradeButton.click();
          buttonClicked = true;
          console.log('Clicked upgrade button using role selector');
        } catch (error) {
          console.log('Role selector failed');
        }
      }
      
      if (!buttonClicked) {
        // Use the upgrade page screenshot we captured earlier
        if (upgradePageScreenshot) {
          failureScreenshot = upgradePageScreenshot;
          console.log('📸 Using upgrade page screenshot for button not found error');
        } else {
          // Take screenshot for debugging before throwing error
          try {
            console.log('Taking debug screenshot - upgrade button not found');
            const screenshot = await page.screenshot({ 
              encoding: 'base64',
              fullPage: true,
              type: 'png'
            });
            failureScreenshot = `data:image/png;base64,${screenshot}`;
            console.log('Debug screenshot captured:', screenshot.length, 'bytes');
          } catch (e) {
            console.error('Failed to capture debug screenshot:', e.message);
          }
        }
        
        // Also capture the page content for debugging
        try {
          const pageContent = await page.content();
          console.log('Page content length:', pageContent.length);
          console.log('Page title:', await page.title());
          console.log('Current URL:', page.url());
        } catch (e) {
          console.log('Failed to get page details:', e.message);
        }
        
        throw new Error('Upgrade button not found after trying all strategies');
      }
      
      broadcastStatus(sessionId, { 
        type: 'status',
        orgId: org.id,
        upgradeId,
        batchId,
        status: 'upgrading', 
        message: 'Upgrade initiated! Waiting for completion...' 
      });
      
      // Step 8: Wait for completion with multiple success indicators
      let upgradeCompleted = false;
      const successPatterns = [
        'successfully',
        'completed',
        'installed',
        'success',
        'upgrading and granting access to admins only',
        'upgrade is in progress',
        'installation complete'
      ];
      
      try {
        await page.waitForFunction(
          (patterns) => {
            const bodyText = document.body.innerText.toLowerCase();
            return patterns.some(pattern => bodyText.includes(pattern));
          },
          successPatterns,
          { timeout: MAX_UPGRADE_DURATION }
        );
        upgradeCompleted = true;
      } catch (timeoutError) {
        // Check page content before marking as failed
        const pageText = await page.textContent('body').catch(() => '');
        const pageTextLower = pageText.toLowerCase();
        
        // Check for success indicators
        if (successPatterns.some(pattern => pageTextLower.includes(pattern))) {
          upgradeCompleted = true;
        } 
        // Check for specific error indicators
        else if (pageTextLower.includes('error') || 
                 pageTextLower.includes('failed') || 
                 pageTextLower.includes('cannot') ||
                 pageTextLower.includes('unable')) {
          
          // Capture screenshot of error state
          try {
            const screenshot = await page.screenshot({ 
              encoding: 'base64',
              fullPage: false,
              type: 'jpeg',
              quality: 80
            });
            failureScreenshot = `data:image/jpeg;base64,${screenshot}`;
            console.log('Error screenshot captured:', screenshot.length, 'bytes');
          } catch (e) {
            console.error('Failed to capture error screenshot:', e.message);
          }
          
          // Extract error message if possible
          const errorMatch = pageText.match(/error[:\s]+([^.]+)/i);
          const errorMessage = errorMatch ? errorMatch[1].trim() : 'Unknown error on page';
          
          throw new Error(`Upgrade failed: ${errorMessage}`);
        }
        // Timeout without clear status
        else {
          historyEntry.status = 'timeout';
          broadcastStatus(sessionId, { 
            type: 'status',
            orgId: org.id,
            upgradeId,
            batchId,
            status: 'completed', 
            message: 'Upgrade timeout - please verify status manually' 
          });
        }
      }
      
      if (upgradeCompleted) {
        const endTime = new Date();
        historyEntry.endTime = endTime.toISOString();
        historyEntry.duration = Math.round((endTime - startTime) / 1000);
        historyEntry.status = 'success';
        historyEntry.retries = retryCount;
        
        broadcastStatus(sessionId, { 
          type: 'status',
          orgId: org.id,
          upgradeId,
          batchId,
          status: 'completed', 
          message: 'Package upgrade completed successfully!' 
        });
      }
      
    } catch (error) {
      // ENHANCED ERROR HANDLING WITH GUARANTEED SCREENSHOT CAPTURE
      console.error(`Upgrade attempt failed for ${org.name}:`, error.message);
      
      // Force screenshot capture on ANY error
      if (page) {
        console.log('FORCING screenshot capture due to error...');
        try {
          // Try multiple screenshot strategies
          let screenshotCaptured = false;
          
          // Strategy 1: Full page PNG
          if (!screenshotCaptured) {
            try {
              const screenshot = await page.screenshot({ 
                encoding: 'base64',
                fullPage: true,
                type: 'png',
                timeout: 15000
              });
              failureScreenshot = `data:image/png;base64,${screenshot}`;
              console.log('✅ FULL PAGE PNG screenshot captured:', screenshot.length, 'bytes');
              screenshotCaptured = true;
            } catch (e) {
              console.log('❌ Full page PNG failed:', e.message);
            }
          }
          
          // Strategy 2: Viewport PNG
          if (!screenshotCaptured) {
            try {
              const screenshot = await page.screenshot({ 
                encoding: 'base64',
                fullPage: false,
                type: 'png',
                timeout: 10000
              });
              failureScreenshot = `data:image/png;base64,${screenshot}`;
              console.log('✅ VIEWPORT PNG screenshot captured:', screenshot.length, 'bytes');
              screenshotCaptured = true;
            } catch (e) {
              console.log('❌ Viewport PNG failed:', e.message);
            }
          }
          
          // Strategy 3: Viewport JPEG (most compatible)
          if (!screenshotCaptured) {
            try {
              const screenshot = await page.screenshot({ 
                encoding: 'base64',
                fullPage: false,
                type: 'jpeg',
                quality: 90,
                timeout: 5000
              });
              failureScreenshot = `data:image/jpeg;base64,${screenshot}`;
              console.log('✅ VIEWPORT JPEG screenshot captured:', screenshot.length, 'bytes');
              screenshotCaptured = true;
            } catch (e) {
              console.log('❌ Viewport JPEG failed:', e.message);
            }
          }
          
          if (!screenshotCaptured) {
            console.error('🚨 ALL SCREENSHOT STRATEGIES FAILED');
          }
          
        } catch (screenshotError) {
          console.error('🚨 Critical screenshot capture error:', screenshotError.message);
        }
      } else {
        console.warn('⚠️ No page object available for screenshot capture');
      }
      
      // Retry logic for specific errors
      if (retryCount < config.max_retries && 
          (error.message.includes('net::') || 
           error.message.includes('Page crashed') ||
           error.message.includes('Target closed') ||
           error.message.includes('timeout'))) {
        
        retryCount++;
        console.log(`Retrying upgrade for ${org.name} (attempt ${retryCount + 1}/${config.max_retries + 1})`);
        
        // Clean up before retry
        await releaseBrowser(browser);
        browser = null;
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, config.retry_delay));
        
        // Retry
        return attemptUpgrade();
      }
      
      // Final failure
      const endTime = new Date();
      historyEntry.endTime = endTime.toISOString();
      historyEntry.duration = Math.round((endTime - startTime) / 1000);
      historyEntry.status = 'failed';
      historyEntry.error = error.message || 'Unknown error occurred';
      historyEntry.retries = retryCount;
      historyEntry.screenshot = failureScreenshot;
      
      console.error(`Upgrade error for ${org.name}:`, error.message);
      
      // Always broadcast with screenshot if available
      const statusUpdate = { 
        type: 'status',
        orgId: org.id,
        upgradeId,
        batchId,
        status: 'error', 
        message: `Error: ${error.message}`
      };
      
      if (failureScreenshot) {
        statusUpdate.screenshot = failureScreenshot;
        console.log('Broadcasting error status with screenshot, size:', failureScreenshot.length);
      } else {
        console.log('Broadcasting error status without screenshot');
      }
      
      broadcastStatus(sessionId, statusUpdate);
      
      throw error;
      
    } finally {
      // Always save history with screenshot info
      await addToHistory(historyEntry);
      
      // Debug log the final history entry
      console.log('Final history entry:', {
        id: historyEntry.id,
        status: historyEntry.status,
        error: historyEntry.error,
        hasScreenshot: !!historyEntry.screenshot,
        screenshotSize: historyEntry.screenshot ? historyEntry.screenshot.length : 0
      });
      
      // Cleanup with proper error handling
      if (page) {
        try {
          await page.close();
        } catch (e) {
          console.error('Error closing page:', e.message);
        }
      }
      
      if (context) {
        try {
          await context.close();
        } catch (e) {
          console.error('Error closing context:', e.message);
        }
      }
      
      if (browser) {
        await releaseBrowser(browser);
      }
    }
  }
  
  // Start the upgrade attempt
  return attemptUpgrade();
}

// Periodic cleanup with improved logic
setInterval(() => {
  const oneHourAgo = Date.now() - (60 * 60 * 1000);
  let cleaned = 0;
  
  // Clean old status entries
  for (const [key, value] of statusStore.entries()) {
    if (value.timestamp && value.timestamp < oneHourAgo) {
      statusStore.delete(key);
      cleaned++;
    }
  }
  
  // Clean disconnected SSE clients
  for (const [sessionId, client] of sseClients.entries()) {
    if (client.destroyed || client.readyState !== 1) {
      sseClients.delete(sessionId);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    console.log(`Cleanup: removed ${cleaned} stale entries`);
  }
  
  // Log memory usage
  const memUsage = process.memoryUsage();
  console.log(`Memory usage: RSS ${Math.round(memUsage.rss / 1024 / 1024)}MB, Heap ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`);
}, CLEANUP_INTERVAL);

// Global error handler
app.use((err, req, res, next) => {
  console.error(`[${new Date().toISOString()}] Error:`, err);
  
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
    message: config.node_env === 'development' ? err.message : 'An unexpected error occurred'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    message: `Endpoint ${req.method} ${req.path} not found`
  });
});

// Graceful shutdown
let server;

async function shutdown(signal) {
  console.log(`\n${signal} received: starting graceful shutdown`);
  
  // Stop accepting new connections
  if (server) {
    server.close(() => {
      console.log('HTTP server closed');
    });
  }
  
  // Close all SSE connections
  for (const [sessionId, client] of sseClients.entries()) {
    try {
      client.end();
    } catch (e) {}
  }
  sseClients.clear();
  
  // Close all browsers
  console.log(`Closing ${activeBrowserCount} active browsers...`);
  for (const browser of browserPool.values()) {
    try {
      await browser.close();
    } catch (e) {}
  }
  
  // Save any pending history
  console.log('Saving history...');
  const history = await loadHistory();
  await saveHistory(history);
  
  console.log('Graceful shutdown completed');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  shutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start server
const PORT = config.port;
server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔════════════════════════════════════════════════════╗
║       Salesforce Automation Backend Started        ║
╠════════════════════════════════════════════════════╣
║ Port:        ${PORT.toString().padEnd(38)}║
║ Environment: ${config.node_env.padEnd(38)}║
║ API Key:     ${(config.api_key ? 'Enabled' : 'Disabled').padEnd(38)}║
║ Frontend:    ${config.frontend_url.padEnd(38).substring(0, 38)}║
║ Version:     1.0.1${' '.repeat(32)}║
╚════════════════════════════════════════════════════╝
  `);
});

// Export for testing
module.exports = { app, server };