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
const MAX_REQUEST_SIZE = '10mb';

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
      config.frontend_url,
      /https:\/\/.*\.vercel\.app$/
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
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  
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
    return JSON.parse(data);
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
    if (history.upgrades.length > MAX_HISTORY_ENTRIES) {
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
    
    // Send to SSE clients
    const client = sseClients.get(sessionId);
    if (client && client.readyState === 1) {
      client.write(`data: ${JSON.stringify(data)}\n\n`);
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

// Browser management
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
        '--disable-site-isolation-trials'
      ],
      timeout: BROWSER_LAUNCH_TIMEOUT
    });
    
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
  } catch (error) {
    console.error('Error closing browser:', error);
  } finally {
    activeBrowserCount--;
  }
}

// API Routes
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    environment: config.node_env,
    memory: process.memoryUsage(),
    activeBrowsers: activeBrowserCount,
    activeClients: sseClients.size
  });
});

app.get('/', (req, res) => {
  res.json({ 
    message: 'Salesforce Automation Backend',
    version: '1.0.0',
    endpoints: [
      { path: '/health', method: 'GET', description: 'Health check' },
      { path: '/api/orgs', method: 'GET', description: 'List organizations' },
      { path: '/api/upgrade', method: 'POST', description: 'Single org upgrade' },
      { path: '/api/upgrade-batch', method: 'POST', description: 'Batch upgrade' },
      { path: '/api/history', method: 'GET', description: 'Upgrade history' },
      { path: '/api/status/:sessionId', method: 'GET', description: 'Status updates (polling)' },
      { path: '/api/status-stream/:sessionId', method: 'GET', description: 'Status updates (SSE)' }
    ]
  });
});

// SSE endpoint with connection management
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
  
  sseClients.set(sessionId, res);
  
  // Send initial connection
  res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`);
  
  // Heartbeat to keep connection alive
  const heartbeat = setInterval(() => {
    if (res.destroyed) {
      clearInterval(heartbeat);
      return;
    }
    res.write(`data: ${JSON.stringify({ type: 'heartbeat', timestamp: Date.now() })}\n\n`);
  }, 30000);
  
  // Cleanup on disconnect
  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(sessionId);
  });
  
  req.on('error', () => {
    clearInterval(heartbeat);
    sseClients.delete(sessionId);
  });
}));

// Polling endpoint
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

// Get organizations
app.get('/api/orgs', authenticate, asyncHandler(async (req, res) => {
  try {
    const config = await loadOrgConfig();
    const orgsWithoutPasswords = config.orgs.map(({ password, ...org }) => org);
    res.json(orgsWithoutPasswords);
  } catch (error) {
    res.status(500).json({ 
      error: 'Configuration error',
      message: error.message
    });
  }
}));

// Get history
app.get('/api/history', authenticate, asyncHandler(async (req, res) => {
  const history = await loadHistory();
  res.json(history.upgrades);
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
      estimatedDuration: '2-5 minutes'
    });
    
    // Run in background with error handling
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
  
  if (!sessionId) {
    return res.status(400).json({ 
      error: 'Validation error',
      message: 'Session ID is required'
    });
  }
  
  // Limit concurrent for Cloud Run
  const limitedConcurrent = Math.min(Math.max(1, maxConcurrent), 1);
  
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
      estimatedDuration: `${orgsToUpgrade.length * 3}-${orgsToUpgrade.length * 5} minutes`
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
    res.status(500).json({ 
      error: 'Server error',
      message: error.message
    });
  }
}));

// Batch upgrade implementation
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
  
  for (const org of orgs) {
    const upgradeId = `${batchId}-${org.id}`;
    
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
        duration: Date.now() - startTime
      });
      
    } catch (error) {
      console.error(`Batch upgrade error for ${org.name}:`, error);
      failureCount++;
      results.push({ 
        orgId: org.id, 
        orgName: org.name,
        status: 'failed', 
        error: error.message,
        duration: Date.now() - startTime
      });
    } finally {
      completedCount++;
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

// Main upgrade function with comprehensive error handling
async function upgradePackage(org, packageUrl, sessionId, upgradeId, batchId = null) {
  let browser;
  let context;
  let page;
  const startTime = new Date();
  let retryCount = 0;
  
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
    retries: 0
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
        timezoneId: 'America/New_York'
      });
      
      page = await context.newPage();
      
      // Set extra headers
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9'
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
      
      // Step 3: Login
      broadcastStatus(sessionId, { 
        type: 'status',
        orgId: org.id,
        upgradeId,
        batchId,
        status: 'logging-in', 
        message: 'Entering credentials...' 
      });
      
      try {
        await page.waitForSelector('#username', { timeout: 10000 });
      } catch (error) {
        throw new Error('Login page not found - username field missing');
      }
      
      await page.fill('#username', org.username);
      await page.fill('#password', org.password);
      
      // Click login with retry
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
      
      // Wait for navigation after login
      try {
        await page.waitForLoadState('networkidle', { timeout: PAGE_LOAD_TIMEOUT });
      } catch (error) {
        throw new Error('Login failed - page did not load after credentials submission');
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
      
      // Step 6: Find and click upgrade button
      broadcastStatus(sessionId, { 
        type: 'status',
        orgId: org.id,
        upgradeId,
        batchId,
        status: 'finding-upgrade-button', 
        message: 'Looking for upgrade button...' 
      });
      
      let buttonClicked = false;
      const buttonStrategies = [
        { selector: 'button[title="Upgrade"]', name: 'title="Upgrade"' },
        { selector: 'button:has-text("Upgrade")', name: 'text "Upgrade"' },
        { selector: 'button.installButton', name: 'class installButton' },
        { selector: 'input[type="submit"][value="Upgrade"]', name: 'submit "Upgrade"' },
        { selector: 'a.btn:has-text("Upgrade")', name: 'link "Upgrade"' }
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
        // Take screenshot for debugging
        try {
          const screenshot = await page.screenshot({ encoding: 'base64' });
          console.log('Page screenshot taken for debugging');
        } catch (e) {}
        
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
      
      // Step 7: Wait for completion with multiple success indicators
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
      // Retry logic for specific errors
      if (retryCount < config.max_retries && 
          (error.message.includes('net::') || 
           error.message.includes('Page crashed') ||
           error.message.includes('Target closed'))) {
        
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
      
      console.error(`Upgrade error for ${org.name}:`, error.message);
      
      broadcastStatus(sessionId, { 
        type: 'status',
        orgId: org.id,
        upgradeId,
        batchId,
        status: 'error', 
        message: `Error: ${error.message}` 
      });
      
      throw error;
      
    } finally {
      // Always save history
      await addToHistory(historyEntry);
      
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

// Periodic cleanup
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
╚════════════════════════════════════════════════════╝
  `);
});

// Export for testing
module.exports = { app, server };