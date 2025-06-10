const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');
const fs = require('fs').promises;
const path = require('path');

const app = express();

// Get configuration from environment or files
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const API_KEY = process.env.API_KEY; // Optional API key for security

// CORS configuration
app.use(cors({
  origin: [
    'http://localhost:3000',
    FRONTEND_URL,
    /https:\/\/.*\.vercel\.app$/ // Allow Vercel preview URLs
  ],
  credentials: true
}));

app.use(express.json({ limit: '10mb' })); // Increase limit for config data

// Optional API Key authentication
const authenticate = (req, res, next) => {
  if (!API_KEY) return next(); // Skip if no API key is set
  
  const providedKey = req.headers['x-api-key'];
  if (providedKey === API_KEY) {
    next();
  } else {
    res.status(401).json({ error: 'Invalid API key' });
  }
};

// File paths - use /tmp for writable storage in Cloud Run
const HISTORY_LOG_PATH = '/tmp/upgrade-history.json';

// In-memory status store
const statusStore = new Map();
const sseClients = new Map();

// Load org configuration from environment or file
async function loadOrgConfig() {
  try {
    // First try environment variable
    if (process.env.ORGS_CONFIG) {
      return JSON.parse(process.env.ORGS_CONFIG);
    }
    
    // Fallback to file (for local development)
    const data = await fs.readFile('orgs-config.json', 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading org config:', error);
    return { orgs: [] };
  }
}

// Health check endpoint (required for Cloud Run)
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    memory: process.memoryUsage()
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'Salesforce Automation Backend on Google Cloud Run',
    endpoints: [
      '/health',
      '/api/orgs',
      '/api/upgrade',
      '/api/upgrade-batch',
      '/api/history',
      '/api/status/:sessionId'
    ]
  });
});

// SSE endpoint for real-time updates
app.get('/api/status-stream/:sessionId', authenticate, (req, res) => {
  const { sessionId } = req.params;
  
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  
  sseClients.set(sessionId, res);
  
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
  
  // Send heartbeat every 30 seconds to keep connection alive
  const heartbeat = setInterval(() => {
    res.write(`data: ${JSON.stringify({ type: 'heartbeat' })}\n\n`);
  }, 30000);
  
  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(sessionId);
  });
});

function broadcastStatus(sessionId, data) {
  const client = sseClients.get(sessionId);
  if (client) {
    client.write(`data: ${JSON.stringify(data)}\n\n`);
  }
  
  const key = `${sessionId}-${data.orgId || 'batch'}`;
  statusStore.set(key, { ...data, timestamp: Date.now() });
}

// Get status updates (polling fallback)
app.get('/api/status/:sessionId', authenticate, (req, res) => {
  const { sessionId } = req.params;
  const statuses = {};
  
  for (const [key, value] of statusStore.entries()) {
    if (key.startsWith(sessionId)) {
      const orgId = key.split('-').slice(1).join('-');
      statuses[orgId] = value;
    }
  }
  
  res.json(statuses);
});

// Load upgrade history
async function loadHistory() {
  try {
    const data = await fs.readFile(HISTORY_LOG_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return { upgrades: [] };
  }
}

// Save upgrade history
async function saveHistory(history) {
  try {
    await fs.writeFile(HISTORY_LOG_PATH, JSON.stringify(history, null, 2));
  } catch (error) {
    console.error('Error saving history:', error);
  }
}

// Add entry to upgrade history
async function addToHistory(entry) {
  const history = await loadHistory();
  history.upgrades.unshift(entry);
  
  if (history.upgrades.length > 100) {
    history.upgrades = history.upgrades.slice(0, 100);
  }
  
  await saveHistory(history);
}

// API Routes
app.get('/api/orgs', authenticate, async (req, res) => {
  const config = await loadOrgConfig();
  const orgsWithoutPasswords = config.orgs.map(({ password, ...org }) => org);
  res.json(orgsWithoutPasswords);
});

app.get('/api/history', authenticate, async (req, res) => {
  const history = await loadHistory();
  res.json(history.upgrades);
});

app.post('/api/upgrade', authenticate, async (req, res) => {
  const { orgId, packageUrl, sessionId } = req.body;
  
  const config = await loadOrgConfig();
  const org = config.orgs.find(o => o.id === orgId);
  
  if (!org) {
    return res.status(404).json({ error: 'Org not found' });
  }
  
  const upgradeId = `upgrade-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  res.json({ 
    message: 'Upgrade process started',
    upgradeId,
    sessionId 
  });
  
  // Run in background
  upgradePackage(org, packageUrl, sessionId, upgradeId).catch(console.error);
});

app.post('/api/upgrade-batch', authenticate, async (req, res) => {
  const { orgIds, packageUrl, maxConcurrent = 1, sessionId } = req.body;
  
  // Limit concurrent to 1 for Cloud Run free tier
  const limitedConcurrent = Math.min(maxConcurrent, 1);
  
  if (!orgIds || !Array.isArray(orgIds) || orgIds.length === 0) {
    return res.status(400).json({ error: 'No orgs selected for batch upgrade' });
  }
  
  const config = await loadOrgConfig();
  const orgsToUpgrade = orgIds.map(id => config.orgs.find(o => o.id === id)).filter(Boolean);
  
  if (orgsToUpgrade.length === 0) {
    return res.status(404).json({ error: 'No valid orgs found' });
  }
  
  const batchId = `batch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  res.json({ 
    message: 'Batch upgrade process started',
    batchId,
    sessionId,
    orgsCount: orgsToUpgrade.length,
    maxConcurrent: limitedConcurrent 
  });
  
  // Run in background
  runBatchUpgradeParallel(orgsToUpgrade, packageUrl, sessionId, batchId, limitedConcurrent).catch(console.error);
});

// Batch upgrade function
async function runBatchUpgradeParallel(orgs, packageUrl, sessionId, batchId, maxConcurrent = 1) {
  broadcastStatus(sessionId, {
    type: 'batch-status',
    batchId,
    status: 'started',
    totalOrgs: orgs.length,
    maxConcurrent,
    message: `Starting batch upgrade for ${orgs.length} orgs`
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
        total: orgs.length
      });
      
      await upgradePackage(org, packageUrl, sessionId, upgradeId, batchId);
      successCount++;
      results.push({ orgId: org.id, status: 'success' });
    } catch (error) {
      console.error(`Batch upgrade error for ${org.name}:`, error);
      failureCount++;
      results.push({ orgId: org.id, status: 'failed', error: error.message });
    } finally {
      completedCount++;
      broadcastStatus(sessionId, {
        type: 'batch-progress',
        batchId,
        completed: completedCount,
        total: orgs.length,
        successCount,
        failureCount
      });
    }
  }
  
  broadcastStatus(sessionId, {
    type: 'batch-status',
    batchId,
    status: 'completed',
    totalOrgs: orgs.length,
    successCount,
    failureCount,
    results,
    message: `Batch upgrade completed: ${successCount} succeeded, ${failureCount} failed`
  });
}

// Main upgrade function
async function upgradePackage(org, packageUrl, sessionId, upgradeId, batchId = null) {
  let browser;
  let context;
  let page;
  const startTime = new Date();
  
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
    error: null
  };
  
  try {
    broadcastStatus(sessionId, { 
      type: 'status',
      orgId: org.id,
      upgradeId,
      batchId,
      status: 'starting', 
      message: 'Launching browser...' 
    });
    
    // Cloud Run optimized browser launch
    browser = await chromium.launch({
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
      // Increase timeout for Cloud Run cold starts
      timeout: 60000
    });
    
    context = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      // Reduce resource usage
      javaScriptEnabled: true,
      ignoreHTTPSErrors: true
    });
    
    page = await context.newPage();
    
    // Set extra headers
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9'
    });
    
    broadcastStatus(sessionId, { 
      type: 'status',
      orgId: org.id,
      upgradeId,
      batchId,
      status: 'navigating', 
      message: `Navigating to ${org.name}...` 
    });
    
    await page.goto(org.url, { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });
    
    broadcastStatus(sessionId, { 
      type: 'status',
      orgId: org.id,
      upgradeId,
      batchId,
      status: 'logging-in', 
      message: 'Entering credentials...' 
    });
    
    await page.waitForSelector('#username', { timeout: 10000 });
    await page.fill('#username', org.username);
    await page.fill('#password', org.password);
    await page.click('#Login');
    
    await page.waitForLoadState('networkidle');
    
    broadcastStatus(sessionId, { 
      type: 'status',
      orgId: org.id,
      upgradeId,
      batchId,
      status: 'logged-in', 
      message: 'Successfully logged in!' 
    });
    
    const currentUrl = page.url();
    if (currentUrl.includes('verify') || currentUrl.includes('challenge')) {
      broadcastStatus(sessionId, { 
        type: 'status',
        orgId: org.id,
        upgradeId,
        batchId,
        status: 'verification-required', 
        message: 'Additional verification required. Cannot proceed automatically.' 
      });
      
      throw new Error('Manual verification required - automation cannot proceed');
    }
    
    broadcastStatus(sessionId, { 
      type: 'status',
      orgId: org.id,
      upgradeId,
      batchId,
      status: 'navigating-package', 
      message: 'Navigating to package installation page...' 
    });
    
    const fullPackageUrl = `${org.url}packaging/installPackage.apexp?p0=${packageUrl}`;
    await page.goto(fullPackageUrl, { waitUntil: 'networkidle' });
    
    broadcastStatus(sessionId, { 
      type: 'status',
      orgId: org.id,
      upgradeId,
      batchId,
      status: 'finding-upgrade-button', 
      message: 'Looking for upgrade button...' 
    });
    
    // Try multiple strategies to find the upgrade button
    let buttonClicked = false;
    const strategies = [
      () => page.click('button[title="Upgrade"]'),
      () => page.getByRole('button', { name: 'Upgrade' }).click(),
      () => page.click('button.installButton'),
      () => page.click('button:has-text("Upgrade")')
    ];
    
    for (const strategy of strategies) {
      try {
        await strategy();
        buttonClicked = true;
        break;
      } catch (e) {
        // Try next strategy
      }
    }
    
    if (!buttonClicked) {
      throw new Error('Upgrade button not found after trying multiple strategies');
    }
    
    broadcastStatus(sessionId, { 
      type: 'status',
      orgId: org.id,
      upgradeId,
      batchId,
      status: 'upgrading', 
      message: 'Upgrade initiated! Waiting for completion...' 
    });
    
    try {
      await page.waitForFunction(
        () => {
          const bodyText = document.body.innerText;
          // Normalize whitespace and remove extra dots
          const normalized = bodyText.replace(/\s+/g, ' ').replace(/\.+/g, '.').trim().toLowerCase();
          return (
            normalized.includes('successfully') ||
            normalized.includes('completed') ||
            normalized.includes('installed') ||
            normalized.includes('success') ||
            normalized.includes('upgrading') ||
            /upgrading and granting access to admins only\.*\s*$/i.test(normalized)
          );
        },
        { timeout: 240000 } // 4 minutes (Cloud Run limit is 5 min)
      );

      // Check for the specific message and broadcast as completed
      const pageText = await page.textContent('body');
      const normalizedText = pageText ? pageText.replace(/\s+/g, ' ').replace(/\.+/g, '.').trim().toLowerCase() : '';
      if (/upgrading and granting access to admins only\.*\s*$/i.test(normalizedText)) {
        const endTime = new Date();
        historyEntry.endTime = endTime.toISOString();
        historyEntry.duration = Math.round((endTime - startTime) / 1000);
        historyEntry.status = 'success';
        broadcastStatus(sessionId, { 
          type: 'status',
          orgId: org.id,
          upgradeId,
          batchId,
          status: 'completed', 
          message: 'Upgrade process started, wait for confirmation email.' 
        });
      } else {
        const endTime = new Date();
        historyEntry.endTime = endTime.toISOString();
        historyEntry.duration = Math.round((endTime - startTime) / 1000);
        historyEntry.status = 'success';
        broadcastStatus(sessionId, { 
          type: 'status',
          orgId: org.id,
          upgradeId,
          batchId,
          status: 'completed', 
          message: 'Package upgrade initiated successfully! Wait for completion email.' 
        });
      }
    } catch (timeoutError) {
      const pageText = await page.textContent('body');
      const normalizedText = pageText ? pageText.replace(/\s+/g, ' ').replace(/\.+/g, '.').trim().toLowerCase() : '';
      // If the special message is present (case-insensitive, ignore dots/case/extra spaces), treat as success regardless of 'error' presence
      if (/upgrading and granting access to admins only\.*\s*$/i.test(normalizedText)) {
        const endTime = new Date();
        historyEntry.endTime = endTime.toISOString();
        historyEntry.duration = Math.round((endTime - startTime) / 1000);
        historyEntry.status = 'success';
        broadcastStatus(sessionId, {
          type: 'status',
          orgId: org.id,
          upgradeId,
          batchId,
          status: 'completed',
          message: 'Upgrade process started, wait for confirmation email.'
        });
      } else if (normalizedText.includes('error') || normalizedText.includes('failed')) {
        // Only throw error if the special message is NOT present
        throw new Error('Upgrade failed - error detected on page');
      } else {
        const endTime = new Date();
        historyEntry.endTime = endTime.toISOString();
        historyEntry.duration = Math.round((endTime - startTime) / 1000);
        historyEntry.status = 'timeout';
        broadcastStatus(sessionId, {
          type: 'status',
          orgId: org.id,
          upgradeId,
          batchId,
          status: 'completed',
          message: 'Upgrade process finished (timeout reached, please verify manually)'
        });
      }
    }
    
  } catch (error) {
    const endTime = new Date();
    historyEntry.endTime = endTime.toISOString();
    historyEntry.duration = Math.round((endTime - startTime) / 1000);
    historyEntry.status = 'failed';
    historyEntry.error = error.message || 'Unknown error occurred';
    
    console.error('Upgrade error:', error.message || error);
    broadcastStatus(sessionId, { 
      type: 'status',
      orgId: org.id,
      upgradeId,
      batchId,
      status: 'error', 
      message: `Error: ${error.message || 'Unknown error occurred'}` 
    });
    
    throw error;
  } finally {
    await addToHistory(historyEntry);
    
    // Aggressive cleanup for Cloud Run
    try {
      if (page) {
        await page.close();
      }
    } catch (e) {
      console.error('Error closing page:', e);
    }
    
    try {
      if (context) {
        await context.close();
      }
    } catch (e) {
      console.error('Error closing context:', e);
    }
    
    try {
      if (browser) {
        await browser.close();
      }
    } catch (e) {
      console.error('Error closing browser:', e);
    }
  }
}

// Clean up old statuses periodically (every 30 minutes)
setInterval(() => {
  const oneHourAgo = Date.now() - (60 * 60 * 1000);
  for (const [key, value] of statusStore.entries()) {
    if (value.timestamp && value.timestamp < oneHourAgo) {
      statusStore.delete(key);
    }
  }
}, 30 * 60 * 1000);

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
  });
});

// Start server
const PORT = process.env.PORT || 8080;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Cloud Run optimized configuration loaded');
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});