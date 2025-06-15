// services/upgradeService.js - Core upgrade automation logic
const { browserManager } = require('./browserManager');
const { statusManager } = require('./statusManager');
const { historyManager } = require('./historyManager');
const config = require('../config');
const logger = require('../utils/logger');

class UpgradeService {
  async upgradePackage(org, packageUrl, sessionId, upgradeId, batchId = null) {
    let browser, context, page, browserId;
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
    
    const attemptUpgrade = async () => {
      try {
        // Step 1: Launch browser
        statusManager.broadcastStatus(sessionId, { 
          type: 'status',
          orgId: org.id,
          upgradeId,
          batchId,
          status: 'starting', 
          message: retryCount > 0 ? `Launching browser (retry ${retryCount})...` : 'Launching browser...'
        });
        
        const browserData = await browserManager.acquireBrowser();
        browser = browserData.browser;
        browserId = browserData.browserId;
        
        const pageData = await browserManager.createPage(browser);
        context = pageData.context;
        page = pageData.page;
        
        // Step 2: Navigate to org
        statusManager.broadcastStatus(sessionId, { 
          type: 'status',
          orgId: org.id,
          upgradeId,
          batchId,
          status: 'navigating', 
          message: `Navigating to ${org.name}...` 
        });
        
        await this.navigateToOrg(page, org);
        
        // Step 3: Login
        statusManager.broadcastStatus(sessionId, { 
          type: 'status',
          orgId: org.id,
          upgradeId,
          batchId,
          status: 'logging-in', 
          message: 'Entering credentials...' 
        });
        
        await this.performLogin(page, org);
        
        statusManager.broadcastStatus(sessionId, { 
          type: 'status',
          orgId: org.id,
          upgradeId,
          batchId,
          status: 'logged-in', 
          message: 'Successfully logged in!' 
        });
        
        // Step 4: Handle verification if needed
        const verificationHandled = await this.handleVerification(
          page, sessionId, org, upgradeId, batchId
        );
        
        if (!verificationHandled) {
          throw new Error('Failed to complete verification process');
        }
        
        // Step 5: Navigate to package
        statusManager.broadcastStatus(sessionId, { 
          type: 'status',
          orgId: org.id,
          upgradeId,
          batchId,
          status: 'navigating-package', 
          message: 'Navigating to package installation page...' 
        });
        
        const fullPackageUrl = `${org.url}packaging/installPackage.apexp?p0=${packageUrl}`;
        await page.goto(fullPackageUrl, { 
          waitUntil: 'domcontentloaded',
          timeout: config.PAGE_LOAD_TIMEOUT 
        });
        await page.waitForTimeout(2000);
        
        // Step 6: Extract version info and get confirmation
        const versionConfirmed = await this.handleVersionConfirmation(
          page, sessionId, org, upgradeId, batchId
        );
        
        if (!versionConfirmed) {
          throw new Error('User cancelled the upgrade after reviewing version information');
        }
        
        // Step 7: Click upgrade button
        statusManager.broadcastStatus(sessionId, { 
          type: 'status',
          orgId: org.id,
          upgradeId,
          batchId,
          status: 'finding-upgrade-button', 
          message: 'Looking for upgrade button...' 
        });
        
        await this.clickUpgradeButton(page);
        
        statusManager.broadcastStatus(sessionId, { 
          type: 'status',
          orgId: org.id,
          upgradeId,
          batchId,
          status: 'upgrading', 
          message: 'Upgrade initiated! Waiting for completion...' 
        });
        
        // Step 8: Wait for completion
        const success = await this.waitForUpgradeCompletion(page);
        
        if (success) {
          const endTime = new Date();
          historyEntry.endTime = endTime.toISOString();
          historyEntry.duration = Math.round((endTime - startTime) / 1000);
          historyEntry.status = 'success';
          historyEntry.retries = retryCount;
          
          statusManager.broadcastStatus(sessionId, { 
            type: 'status',
            orgId: org.id,
            upgradeId,
            batchId,
            status: 'completed', 
            message: 'Package upgrade completed successfully!' 
          });
        }
        
      } catch (error) {
        logger.browserError(`Upgrade attempt failed`, org.name, error);
        
        // Capture screenshot on error
        if (page) {
          try {
            failureScreenshot = await browserManager.captureScreenshot(page, 'png');
          } catch (e) {
            logger.error('Failed to capture error screenshot', e);
          }
        }
        
        // Retry logic
        if (retryCount < config.MAX_RETRIES && this.isRetriableError(error)) {
          retryCount++;
          
          if (browserId) {
            await browserManager.releaseBrowser(browserId);
          }
          
          await new Promise(resolve => setTimeout(resolve, config.RETRY_DELAY));
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
        
        const statusUpdate = { 
          type: 'status',
          orgId: org.id,
          upgradeId,
          batchId,
          status: 'error', 
          message: `Error: ${error.message}`
        };
        
        if (failureScreenshot && this.isValidScreenshot(failureScreenshot)) {
          statusUpdate.screenshot = failureScreenshot;
        }
        
        statusManager.broadcastStatus(sessionId, statusUpdate);
        throw error;
        
      } finally {
        await historyManager.addEntry(historyEntry);
        
        if (page) {
          try {
            await page.close();
          } catch (e) {}
        }
        
        if (context) {
          try {
            await context.close();
          } catch (e) {}
        }
        
        if (browserId) {
          await browserManager.releaseBrowser(browserId);
        }
      }
    };
    
    return attemptUpgrade();
  }

  async runBatchUpgrade(orgs, packageUrl, sessionId, batchId, maxConcurrent = 1) {
    const startTime = Date.now();
    
    statusManager.broadcastStatus(sessionId, {
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
    
    // Process orgs with concurrency control
    const processingQueue = [...orgs];
    const activeProcesses = [];
    
    while (processingQueue.length > 0 || activeProcesses.length > 0) {
      // Start new processes up to maxConcurrent
      while (activeProcesses.length < maxConcurrent && processingQueue.length > 0) {
        const org = processingQueue.shift();
        const upgradeId = `${batchId}-${org.id}`;
        const orgStartTime = Date.now();
        
        const processPromise = this.upgradePackage(org, packageUrl, sessionId, upgradeId, batchId)
          .then(() => {
            successCount++;
            results.push({ 
              orgId: org.id, 
              orgName: org.name,
              status: 'success',
              duration: Math.round((Date.now() - orgStartTime) / 1000)
            });
          })
          .catch(error => {
            logger.error(`Batch upgrade error for ${org.name}`, error);
            failureCount++;
            results.push({ 
              orgId: org.id, 
              orgName: org.name,
              status: 'failed', 
              error: error.message,
              duration: Math.round((Date.now() - orgStartTime) / 1000)
            });
          })
          .finally(() => {
            completedCount++;
            statusManager.broadcastStatus(sessionId, {
              type: 'batch-progress',
              batchId,
              completed: completedCount,
              total: orgs.length,
              successCount,
              failureCount,
              percentComplete: Math.round((completedCount / orgs.length) * 100)
            });
          });
        
        activeProcesses.push(processPromise);
        
        statusManager.broadcastStatus(sessionId, {
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
      }
      
      // Wait for at least one process to complete
      if (activeProcesses.length > 0) {
        const completedIndex = await Promise.race(
          activeProcesses.map((p, i) => p.then(() => i))
        );
        activeProcesses.splice(completedIndex, 1);
        
        // Add small delay between processes
        if (processingQueue.length > 0) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    }
    
    const totalDuration = Date.now() - startTime;
    
    statusManager.broadcastStatus(sessionId, {
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

  // Helper methods
  async navigateToOrg(page, org) {
    try {
      const response = await page.goto(org.url, { 
        waitUntil: 'domcontentloaded',
        timeout: config.PAGE_LOAD_TIMEOUT 
      });
      
      if (!response || !response.ok()) {
        throw new Error(`Failed to load page: ${response ? response.status() : 'No response'}`);
      }
      
      await page.waitForTimeout(2000);
      
      // Check if we need to navigate to login page
      const hasLoginForm = await page.evaluate(() => {
        return !!(document.querySelector('#username') || document.querySelector('#Username'));
      });
      
      if (!hasLoginForm) {
        const loginLink = await page.$('a[href*="/login"], a[href*="login.salesforce.com"]');
        if (loginLink) {
          await loginLink.click();
          await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 });
        } else {
          const loginUrl = org.url.includes('my.salesforce.com') 
            ? org.url 
            : org.url.replace('lightning.force.com', 'my.salesforce.com');
          await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: config.PAGE_LOAD_TIMEOUT });
        }
      }
    } catch (error) {
      throw new Error(`Failed to load ${org.name}: ${error.message}`);
    }
  }

  async performLogin(page, org) {
    try {
      await page.waitForSelector('#username', { timeout: 15000 });
      
      await page.locator('#username').clear();
      await page.locator('#username').fill(org.username);
      
      await page.locator('#password').clear();
      await page.locator('#password').fill(org.password);
      
      const navigationPromise = page.waitForNavigation({ 
        waitUntil: 'domcontentloaded',
        timeout: 30000 
      });
      
      await page.click('#Login');
      await navigationPromise;
      await page.waitForTimeout(3000);
      
      const currentUrl = page.url();
      
      if (currentUrl.includes('/login') || currentUrl.includes('AuthPage')) {
        const errorElement = await page.$('.loginError, .error, [id*="error"]');
        if (errorElement) {
          const errorText = await errorElement.textContent();
          throw new Error(`Login failed: ${errorText.trim()}`);
        }
        throw new Error('Login failed: Still on login page after submit');
      }
      
    } catch (error) {
      throw new Error(`Login failed: ${error.message}`);
    }
  }

  async handleVerification(page, sessionId, org, upgradeId, batchId) {
    const currentUrl = page.url();
    
    const hasVerificationHeader = await page.evaluate(() => {
      const header = document.querySelector('h2#header.mb12');
      return header && header.textContent && header.textContent.includes('Verify Your Identity');
    });
    
    if (!currentUrl.includes('verify') && !currentUrl.includes('challenge') && 
        !currentUrl.includes('2fa') && !hasVerificationHeader) {
      return true; // No verification needed
    }
    
    // Capture screenshot of verification page
    let verificationScreenshot = null;
    try {
      verificationScreenshot = await browserManager.captureScreenshot(page, 'png');
    } catch (e) {}
    
    statusManager.broadcastStatus(sessionId, { 
      type: 'verification-code-required',
      orgId: org.id,
      upgradeId,
      batchId,
      status: 'verification-required', 
      message: 'Verification code required. Please check your email and enter the 6-digit code.',
      screenshot: verificationScreenshot
    });
    
    // Wait for user to submit verification code
    let verificationCode = null;
    const maxWaitTime = config.VERIFICATION_TIMEOUT;
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const verification = statusManager.getVerificationCode(sessionId, upgradeId);
      if (verification) {
        verificationCode = verification.verificationCode;
        break;
      }
    }
    
    if (!verificationCode) {
      throw new Error('Verification code timeout - no code received within 2 minutes');
    }
    
    statusManager.broadcastStatus(sessionId, { 
      type: 'status',
      orgId: org.id,
      upgradeId,
      batchId,
      status: 'entering-verification', 
      message: 'Entering verification code...' 
    });
    
    try {
      await page.waitForSelector('input#emc', { timeout: 10000 });
      await page.locator('input#emc').clear();
      await page.locator('input#emc').fill(verificationCode);
      
      const submitButton = await page.$('input#save[type="submit"][value="Verify"]');
      if (submitButton) {
        await submitButton.click();
      } else {
        await page.locator('input#emc').press('Enter');
      }
      
      await page.waitForNavigation({ 
        waitUntil: 'domcontentloaded',
        timeout: 30000 
      });
      
      await page.waitForTimeout(3000);
      
      statusManager.broadcastStatus(sessionId, { 
        type: 'status',
        orgId: org.id,
        upgradeId,
        batchId,
        status: 'verification-completed', 
        message: 'Verification completed successfully!' 
      });
      
      return true;
    } catch (error) {
      throw new Error(`Verification failed: ${error.message}`);
    }
  }

  async handleVersionConfirmation(page, sessionId, org, upgradeId, batchId) {
    statusManager.broadcastStatus(sessionId, { 
      type: 'status',
      orgId: org.id,
      upgradeId,
      batchId,
      status: 'extracting-version-info', 
      message: 'Extracting package version information...' 
    });
    
    let versionInfo = null;
    try {
      await page.waitForSelector('#upgradeText', { timeout: 10000 });
      
      const upgradeTextElement = await page.$('#upgradeText');
      if (upgradeTextElement) {
        const upgradeText = await upgradeTextElement.textContent();
        
        const installedMatch = upgradeText.match(/Installed:\s*([^\s(]+)/);
        const installedVersion = installedMatch ? installedMatch[1] : null;
        
        const newVersionMatch = upgradeText.match(/New Version:\s*([^\s(]+)/);
        const newVersion = newVersionMatch ? newVersionMatch[1] : null;
        
        const headerMatch = upgradeText.match(/^([^\.]+\.)/);
        const headerMessage = headerMatch ? headerMatch[1] : 'Package upgrade available';
        
        versionInfo = {
          installedVersion,
          newVersion,
          headerMessage: headerMessage.trim(),
          fullText: upgradeText.trim()
        };
      }
    } catch (error) {
      // Continue without version info if extraction fails
      return true;
    }
    
    if (versionInfo && versionInfo.installedVersion && versionInfo.newVersion) {
      statusManager.broadcastStatus(sessionId, { 
        type: 'version-confirmation-required',
        orgId: org.id,
        upgradeId,
        batchId,
        status: 'awaiting-confirmation', 
        message: 'Please confirm the package versions before proceeding',
        versionInfo
      });
      
      // Wait for user confirmation
      let confirmed = null;
      const maxWaitTime = config.VERIFICATION_TIMEOUT;
      const startTime = Date.now();
      
      while (Date.now() - startTime < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const confirmation = statusManager.getConfirmation(sessionId, upgradeId);
        if (confirmation) {
          confirmed = confirmation.confirmed;
          break;
        }
      }
      
      if (confirmed === null) {
        throw new Error('User confirmation timeout - no response received within 2 minutes');
      }
      
      if (!confirmed) {
        return false;
      }
      
      statusManager.broadcastStatus(sessionId, { 
        type: 'status',
        orgId: org.id,
        upgradeId,
        batchId,
        status: 'user-confirmed', 
        message: 'User confirmed version upgrade. Proceeding...' 
      });
    }
    
    return true;
  }

  async clickUpgradeButton(page) {
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
        logger.debug(`Clicked upgrade button using strategy: ${strategy.name}`);
        return;
      } catch (error) {
        // Try next strategy
      }
    }
    
    // Try with Playwright's smart selectors
    try {
      const upgradeButton = await page.getByRole('button', { name: /upgrade/i });
      await upgradeButton.click();
      return;
    } catch (error) {
      // Failed
    }
    
    throw new Error('Upgrade button not found after trying all strategies');
  }

  async waitForUpgradeCompletion(page) {
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
        { timeout: config.MAX_UPGRADE_DURATION }
      );
      return true;
    } catch (timeoutError) {
      // Check page content before marking as failed
      const pageText = await page.textContent('body').catch(() => '');
      const pageTextLower = pageText.toLowerCase();
      
      if (successPatterns.some(pattern => pageTextLower.includes(pattern))) {
        return true;
      } else if (pageTextLower.includes('error') || 
                 pageTextLower.includes('failed') || 
                 pageTextLower.includes('cannot') ||
                 pageTextLower.includes('unable')) {
        // Extract error message if possible
        const errorMatch = pageText.match(/error[:\s]+([^.]+)/i);
        const errorMessage = errorMatch ? errorMatch[1].trim() : 'Unknown error on page';
        throw new Error(`Upgrade failed: ${errorMessage}`);
      } else {
        throw new Error('Upgrade timeout - please verify status manually');
      }
    }
  }

  isRetriableError(error) {
    const retriablePatterns = [
      'net::',
      'Page crashed',
      'Target closed',
      'timeout',
      'Failed to launch browser',
      'Browser launch failed'
    ];
    
    return retriablePatterns.some(pattern => 
      error.message && error.message.includes(pattern)
    );
  }

  isValidScreenshot(screenshot) {
    return (
      typeof screenshot === 'string' &&
      screenshot.length > 30 &&
      /^data:image\/[a-zA-Z]+;base64,/.test(screenshot)
    );
  }
}

module.exports = {
  upgradeService: new UpgradeService()
};