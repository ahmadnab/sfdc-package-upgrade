// services/browserManager.js - Browser pool and lifecycle management
const { chromium } = require('playwright');
const config = require('../config');
const logger = require('../utils/logger');

class BrowserManager {
  constructor() {
    this.activeBrowserCount = 0;
    this.browserPool = new Map();
  }

  async acquireBrowser() {
    if (this.activeBrowserCount >= config.MAX_CONCURRENT_BROWSERS) {
      throw new Error('Maximum concurrent browser limit reached. Please try again later.');
    }
    
    this.activeBrowserCount++;
    
    try {
      const browserOptions = {
        ...config.BROWSER_OPTIONS,
        timeout: config.BROWSER_LAUNCH_TIMEOUT
      };
      
      // Add executable path for different environments
      if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
        browserOptions.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
      }
      
      const browser = await chromium.launch(browserOptions);
      const browserId = `browser-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      this.browserPool.set(browserId, {
        browser,
        createdAt: Date.now()
      });
      
      logger.info(`Browser acquired: ${browserId}, active count: ${this.activeBrowserCount}`);
      
      return { browser, browserId };
    } catch (error) {
      this.activeBrowserCount--;
      logger.error('Browser launch failed', error);
      throw new Error(`Failed to launch browser: ${error.message}`);
    }
  }

  async releaseBrowser(browserId) {
    const browserEntry = this.browserPool.get(browserId);
    if (!browserEntry) return;
    
    try {
      await browserEntry.browser.close();
      logger.info(`Browser released: ${browserId}`);
    } catch (error) {
      logger.error(`Error closing browser ${browserId}`, error);
    } finally {
      this.browserPool.delete(browserId);
      this.activeBrowserCount = Math.max(0, this.activeBrowserCount - 1);
    }
  }

  async createPage(browser) {
    const context = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      ignoreHTTPSErrors: true,
      locale: 'en-US',
      timezoneId: 'America/New_York',
      permissions: ['clipboard-read', 'clipboard-write'],
      bypassCSP: true,
      javaScriptEnabled: true
    });
    
    // Set default timeouts
    context.setDefaultTimeout(30000);
    context.setDefaultNavigationTimeout(30000);
    
    const page = await context.newPage();
    
    // Set extra headers
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
    });
    
    return { context, page };
  }

  async captureScreenshot(page, format = 'png', quality = 90) {
    try {
      const screenshotBuffer = await page.screenshot({ 
        type: format,
        quality: format === 'jpeg' ? quality : undefined,
        fullPage: false,
        timeout: 10000
      });
      
      const base64String = screenshotBuffer.toString('base64');
      const mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
      
      return `data:${mimeType};base64,${base64String}`;
    } catch (error) {
      logger.error('Screenshot capture failed', error);
      return null;
    }
  }

  cleanup() {
    const now = Date.now();
    const maxAge = 30 * 60 * 1000; // 30 minutes
    
    for (const [browserId, entry] of this.browserPool.entries()) {
      if (now - entry.createdAt > maxAge) {
        logger.info(`Cleaning up stale browser: ${browserId}`);
        this.releaseBrowser(browserId);
      }
    }
  }

  getStats() {
    return {
      activeBrowserCount: this.activeBrowserCount,
      poolSize: this.browserPool.size,
      maxConcurrent: config.MAX_CONCURRENT_BROWSERS
    };
  }
}

module.exports = {
  browserManager: new BrowserManager()
};