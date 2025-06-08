const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');
const fs = require('fs').promises;
const path = require('path');
const { Server } = require('socket.io');
const http = require('http');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true
  }
});

app.use(cors());
app.use(express.json());

// File paths
const ORGS_CONFIG_PATH = 'orgs-config.json';
const HISTORY_LOG_PATH = 'upgrade-history.json';

// Load org configuration
async function loadOrgConfig() {
  try {
    const data = await fs.readFile(ORGS_CONFIG_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading org config:', error);
    return { orgs: [] };
  }
}

// Load upgrade history
async function loadHistory() {
  try {
    const data = await fs.readFile(HISTORY_LOG_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    // If file doesn't exist, return empty history
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
  history.upgrades.unshift(entry); // Add to beginning of array
  
  // Keep only last 100 entries to prevent file from growing too large
  if (history.upgrades.length > 100) {
    history.upgrades = history.upgrades.slice(0, 100);
  }
  
  await saveHistory(history);
}

// WebSocket connection for real-time updates
io.on('connection', (socket) => {
  console.log('Client connected');
  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

// Get all orgs
app.get('/api/orgs', async (req, res) => {
  const config = await loadOrgConfig();
  // Send orgs without passwords for security
  const orgsWithoutPasswords = config.orgs.map(({ password, ...org }) => org);
  res.json(orgsWithoutPasswords);
});

// Get upgrade history
app.get('/api/history', async (req, res) => {
  const history = await loadHistory();
  res.json(history.upgrades);
});

// Single upgrade endpoint (kept for backward compatibility)
app.post('/api/upgrade', async (req, res) => {
  const { orgId, packageUrl } = req.body;
  
  // Get org details
  const config = await loadOrgConfig();
  const org = config.orgs.find(o => o.id === orgId);
  
  if (!org) {
    return res.status(404).json({ error: 'Org not found' });
  }
  
  // Start the upgrade process
  res.json({ message: 'Upgrade process started' });
  
  // Create upgrade session
  const upgradeId = `upgrade-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  // Run the automation in the background
  upgradePackage(org, packageUrl, io, upgradeId);
});

// Batch upgrade endpoint
app.post('/api/upgrade-batch', async (req, res) => {
  const { orgIds, packageUrl, maxConcurrent = 2 } = req.body;
  
  if (!orgIds || !Array.isArray(orgIds) || orgIds.length === 0) {
    return res.status(400).json({ error: 'No orgs selected for batch upgrade' });
  }
  
  // Get org details
  const config = await loadOrgConfig();
  const orgsToUpgrade = orgIds.map(id => config.orgs.find(o => o.id === id)).filter(Boolean);
  
  if (orgsToUpgrade.length === 0) {
    return res.status(404).json({ error: 'No valid orgs found' });
  }
  
  // Create batch session ID
  const batchId = `batch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  // Start the batch upgrade process
  res.json({ 
    message: 'Batch upgrade process started',
    batchId,
    orgsCount: orgsToUpgrade.length,
    maxConcurrent 
  });
  
  // Run upgrades in parallel with concurrency limit
  runBatchUpgradeParallel(orgsToUpgrade, packageUrl, io, batchId, maxConcurrent);
});

// Run batch upgrades in parallel with concurrency control
async function runBatchUpgradeParallel(orgs, packageUrl, io, batchId, maxConcurrent = 2) {
  io.emit('batch-status', {
    batchId,
    status: 'started',
    totalOrgs: orgs.length,
    maxConcurrent,
    message: `Starting parallel batch upgrade for ${orgs.length} orgs (${maxConcurrent} concurrent)`
  });
  
  let successCount = 0;
  let failureCount = 0;
  let completedCount = 0;
  const results = [];
  
  // Function to process a single org
  const processOrg = async (org) => {
    const upgradeId = `${batchId}-${org.id}`;
    
    try {
      io.emit('batch-progress', {
        batchId,
        orgId: org.id,
        orgName: org.name,
        status: 'starting',
        completed: completedCount,
        total: orgs.length
      });
      
      await upgradePackage(org, packageUrl, io, upgradeId, batchId);
      successCount++;
      results.push({ orgId: org.id, status: 'success' });
    } catch (error) {
      console.error(`Batch upgrade error for ${org.name}:`, error);
      failureCount++;
      results.push({ orgId: org.id, status: 'failed', error: error.message });
    } finally {
      completedCount++;
      io.emit('batch-progress', {
        batchId,
        completed: completedCount,
        total: orgs.length,
        successCount,
        failureCount
      });
    }
  };
  
  // Process orgs in batches of maxConcurrent
  const batches = [];
  for (let i = 0; i < orgs.length; i += maxConcurrent) {
    batches.push(orgs.slice(i, i + maxConcurrent));
  }
  
  // Process each batch
  for (const batch of batches) {
    await Promise.all(batch.map(org => processOrg(org)));
  }
  
  io.emit('batch-status', {
    batchId,
    status: 'completed',
    totalOrgs: orgs.length,
    successCount,
    failureCount,
    results,
    message: `Batch upgrade completed: ${successCount} succeeded, ${failureCount} failed`
  });
}

// Keep the sequential version for fallback
async function runBatchUpgrade(orgs, packageUrl, io, batchId) {
  // Redirect to parallel with maxConcurrent = 1 for sequential processing
  return runBatchUpgradeParallel(orgs, packageUrl, io, batchId, 1);
}

async function upgradePackage(org, packageUrl, io, upgradeId, batchId = null) {
  let browser;
  let context;
  let page;
  const startTime = new Date();
  
  // Create history entry
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
    // Emit status updates
    io.emit('status', { 
      orgId: org.id,
      upgradeId,
      batchId,
      status: 'starting', 
      message: 'Launching browser...' 
    });
    
    // Launch browser with Playwright
    browser = await chromium.launch({
      headless: false, // Set to true for production
      args: ['--start-maximized']
    });
    
    // Create a new browser context with viewport
    context = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    
    // Create a new page
    page = await context.newPage();
    
    // Navigate to Salesforce login
    io.emit('status', { 
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
    
    // Login process
    io.emit('status', { 
      orgId: org.id,
      upgradeId,
      batchId,
      status: 'logging-in', 
      message: 'Entering credentials...' 
    });
    
    // Wait for username field and enter credentials
    await page.waitForSelector('#username', { timeout: 10000 });
    await page.fill('#username', org.username);
    await page.fill('#password', org.password);
    
    // Click login button
    await page.click('#Login');
    
    // Wait for navigation after login
    await page.waitForURL(`${org.url}lightning/page/home`, {
      timeout: 30000
    });

    io.emit('status', { 
      orgId: org.id,
      upgradeId,
      batchId,
      status: 'logged-in', 
      message: 'Successfully logged in!' 
    });
    
    // Handle any additional authentication (like verification codes) if needed
    // Check if we're on a verification page
    const currentUrl = page.url();
    if (currentUrl.includes('verify') || currentUrl.includes('challenge')) {
      io.emit('status', { 
        orgId: org.id,
        upgradeId,
        batchId,
        status: 'verification-required', 
        message: 'Additional verification required. Please complete manually...' 
      });
      
      // Wait for manual verification completion
      await page.waitForNavigation({ 
        waitUntil: 'networkidle', 
        timeout: 120000 // 2 minutes for manual verification
      });
    }
    
    // Navigate to package URL
    io.emit('status', { 
      orgId: org.id,
      upgradeId,
      batchId,
      status: 'navigating-package', 
      message: 'Navigating to package installation page...' 
    });
    
    // Construct the full package URL using the package ID
    const fullPackageUrl = `${org.url}packaging/installPackage.apexp?p0=${packageUrl}`;
    await page.goto(fullPackageUrl, { waitUntil: 'networkidle' });
    
    // Wait for upgrade button
    io.emit('status', { 
      orgId: org.id,
      upgradeId,
      batchId,
      status: 'finding-upgrade-button', 
      message: 'Looking for upgrade button...' 
    });
    
    // Try multiple strategies to find the upgrade button
    let buttonClicked = false;
    
    // Strategy 1: Try button with title "Upgrade"
    try {
      await page.waitForSelector('button[title="Upgrade"]', { timeout: 5000 });
      await page.click('button[title="Upgrade"]');
      buttonClicked = true;
    } catch (e) {
      // Try next strategy
    }
    
    // Strategy 2: Try button with text "Upgrade"
    if (!buttonClicked) {
      try {
        const upgradeButton = await page.getByRole('button', { name: 'Upgrade' });
        await upgradeButton.click();
        buttonClicked = true;
      } catch (e) {
        // Try next strategy
      }
    }
    
    // Strategy 3: Try button with class containing "installButton"
    if (!buttonClicked) {
      try {
        await page.click('button.installButton');
        buttonClicked = true;
      } catch (e) {
        // Try next strategy
      }
    }
    
    // Strategy 4: Try any button containing "Upgrade" text
    if (!buttonClicked) {
      try {
        await page.click('button:has-text("Upgrade")');
        buttonClicked = true;
      } catch (e) {
        throw new Error('Upgrade button not found after trying multiple strategies');
      }
    }
    
    io.emit('status', { 
      orgId: org.id,
      upgradeId,
      batchId,
      status: 'upgrading', 
      message: 'Upgrade initiated! Waiting for completion...' 
    });
    
    // Wait for upgrade to complete (monitor for success indicators)
    try {
      await page.waitForFunction(
        () => {
          const bodyText = document.body.innerText.toLowerCase();
          return bodyText.includes('successfully') || 
                 bodyText.includes('completed') || 
                 bodyText.includes('installed') ||
                 bodyText.includes('success');
        },
        { timeout: 300000 } // 5 minutes timeout for upgrade
      );
      
      const endTime = new Date();
      historyEntry.endTime = endTime.toISOString();
      historyEntry.duration = Math.round((endTime - startTime) / 1000); // Duration in seconds
      historyEntry.status = 'success';
      
      io.emit('status', { 
        orgId: org.id,
        upgradeId,
        batchId,
        status: 'completed', 
        message: 'Package upgrade completed successfully!' 
      });
    } catch (timeoutError) {
      // Check if there's an error message instead
      const pageText = await page.textContent('body');
      if (pageText.toLowerCase().includes('error') || pageText.toLowerCase().includes('failed')) {
        throw new Error('Upgrade failed - error detected on page');
      } else {
        const endTime = new Date();
        historyEntry.endTime = endTime.toISOString();
        historyEntry.duration = Math.round((endTime - startTime) / 1000);
        historyEntry.status = 'timeout';
        
        io.emit('status', { 
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
    io.emit('status', { 
      orgId: org.id,
      upgradeId,
      batchId,
      status: 'error', 
      message: `Error: ${error.message || 'Unknown error occurred'}` 
    });
    
    throw error; // Re-throw for batch processing
  } finally {
    // Save to history
    await addToHistory(historyEntry);
    
    // Clean up
    if (page) {
      try {
        await page.close();
      } catch (e) {
        console.error('Error closing page:', e);
      }
    }
    if (context) {
      try {
        await context.close();
      } catch (e) {
        console.error('Error closing context:', e);
      }
    }
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        console.error('Error closing browser:', e);
      }
    }
  }
}

const PORT = process.env.PORT || 5001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});