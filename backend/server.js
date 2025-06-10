const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright-chromium');
const fs = require('fs').promises;
const path = require('path');

const app = express();

// CORS configuration - UPDATE with your Vercel URL
app.use(cors({
  origin: [
    'http://localhost:3000',
    'https://salesforce-automation.vercel.app', // UPDATE this with your Vercel URL
    /https:\/\/.*\.vercel\.app$/ // Allow any Vercel preview URLs
  ],
  credentials: true
}));

app.use(express.json());

// File paths
const ORGS_CONFIG_PATH = 'orgs-config.json';
const HISTORY_LOG_PATH = 'upgrade-history.json';

// In-memory status store
const statusStore = new Map();
const sseClients = new Map();

// Keep Replit alive endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'running',
    message: 'Salesforce Automation Backend',
    endpoints: ['/api/orgs', '/api/upgrade', '/api/upgrade-batch', '/api/history']
  });
});

// SSE endpoint for real-time updates
app.get('/api/status-stream/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  sseClients.set(sessionId, res);
  
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
  
  req.on('close', () => {
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

app.get('/api/status/:sessionId', (req, res) => {
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

async function loadOrgConfig() {
  try {
    const data = await fs.readFile(ORGS_CONFIG_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading org config:', error);
    return { orgs: [] };
  }
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
    await fs.writeFile(HISTORY_LOG_PATH, JSON.stringify(history, null, 2));
  } catch (error) {
    console.error('Error saving history:', error);
  }
}

async function addToHistory(entry) {
  const history = await loadHistory();
  history.upgrades.unshift(entry);
  
  if (history.upgrades.length > 100) {
    history.upgrades = history.upgrades.slice(0, 100);
  }
  
  await saveHistory(history);
}

app.get('/api/orgs', async (req, res) => {
  const config = await loadOrgConfig();
  const orgsWithoutPasswords = config.orgs.map(({ password, ...org }) => org);
  res.json(orgsWithoutPasswords);
});

app.get('/api/history', async (req, res) => {
  const history = await loadHistory();
  res.json(history.upgrades);
});

app.post('/api/upgrade', async (req, res) => {
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

app.post('/api/upgrade-batch', async (req, res) => {
  const { orgIds, packageUrl, maxConcurrent = 2, sessionId } = req.body;
  
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
    maxConcurrent 
  });
  
  // Run in background
  runBatchUpgradeParallel(orgsToUpgrade, packageUrl, sessionId, batchId, maxConcurrent).catch(console.error);
});

async function runBatchUpgradeParallel(orgs, packageUrl, sessionId, batchId, maxConcurrent = 2) {
  // Limit concurrent to 2 on Replit free tier
  maxConcurrent = Math.min(maxConcurrent, 2);
  
  broadcastStatus(sessionId, {
    type: 'batch-status',
    batchId,
    status: 'started',
    totalOrgs: orgs.length,
    maxConcurrent,
    message: `Starting batch upgrade for ${orgs.length} orgs (${maxConcurrent} concurrent)`
  });
  
  let successCount = 0;
  let failureCount = 0;
  let completedCount = 0;
  const results = [];
  
  const processOrg = async (org) => {
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
  };
  
  const batches = [];
  for (let i = 0; i < orgs.length; i += maxConcurrent) {
    batches.push(orgs.slice(i, i + maxConcurrent));
  }
  
  for (const batch of batches) {
    await Promise.all(batch.map(org => processOrg(org)));
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
    
    // Replit-optimized browser launch
    browser = await chromium.launch({
      headless: true, // Must be true on Replit
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process', // Important for Replit
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled'
      ]
    });
    
    context = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    
    page = await context.newPage();
    
    // Set extra headers to avoid bot detection
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
        message: 'Additional verification required. Please complete manually...' 
      });
      
      await page.waitForNavigation({ 
        waitUntil: 'networkidle', 
        timeout: 120000
      });
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
    
    let buttonClicked = false;
    
    // Try multiple strategies
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
          const bodyText = document.body.innerText.toLowerCase();
          return bodyText.includes('successfully') || 
                 bodyText.includes('completed') || 
                 bodyText.includes('installed') ||
                 bodyText.includes('success');
        },
        { timeout: 300000 }
      );
      
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
        message: 'Package upgrade completed successfully!' 
      });
    } catch (timeoutError) {
      const pageText = await page.textContent('body');
      if (pageText.toLowerCase().includes('error') || pageText.toLowerCase().includes('failed')) {
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
    
    // Clean up with proper error handling
    try {
      if (page) await page.close();
    } catch (e) {}
    
    try {
      if (context) await context.close();
    } catch (e) {}
    
    try {
      if (browser) await browser.close();
    } catch (e) {}
  }
}

// Clean up old statuses periodically
setInterval(() => {
  const oneHourAgo = Date.now() - (60 * 60 * 1000);
  for (const [key, value] of statusStore.entries()) {
    if (value.timestamp && value.timestamp < oneHourAgo) {
      statusStore.delete(key);
    }
  }
}, 30 * 60 * 1000);

const PORT = process.env.PORT || 3000; // Replit uses port 3000 by default
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Access at: https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`);
});
