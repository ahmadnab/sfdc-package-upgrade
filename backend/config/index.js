// config/index.js - Centralized configuration
module.exports = {
  // Server settings
  PORT: process.env.PORT || 8080,
  NODE_ENV: process.env.NODE_ENV || 'development',
  VERSION: '1.0.3',
  
  // API settings
  API_KEY: process.env.API_KEY,
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3000',
  
  // Browser settings
  MAX_CONCURRENT_BROWSERS: 4,
  BROWSER_LAUNCH_TIMEOUT: 60000, // 1 minute
  PAGE_LOAD_TIMEOUT: 30000, // 30 seconds
  VERIFICATION_TIMEOUT: 120000, // 2 minutes
  MAX_UPGRADE_DURATION: 240000, // 4 minutes
  
  // Retry settings
  MAX_RETRIES: 3,
  RETRY_DELAY: 2000,
  
  // Storage settings
  HISTORY_LOG_PATH: '/tmp/upgrade-history.json',
  MAX_HISTORY_ENTRIES: 100,
  MAX_STATUS_ENTRIES: 1000,
  MAX_REQUEST_SIZE: '50mb',
  
  // Cleanup settings
  CLEANUP_INTERVAL: 30 * 60 * 1000, // 30 minutes
  STATUS_RETENTION_TIME: 60 * 60 * 1000, // 1 hour
  
  // CORS allowed origins
  ALLOWED_ORIGINS: [
    'http://localhost:3000',
    'http://localhost:3001',
    process.env.FRONTEND_URL,
    /https:\/\/.*\.vercel\.app$/,
    /https:\/\/.*\.netlify\.app$/
  ],
  
  // Browser launch options
  BROWSER_OPTIONS: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--disable-blink-features=AutomationControlled',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-site-isolation-trials',
      '--memory-pressure-off',
      '--max_old_space_size=512',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding'
    ]
  },
  
  // Helper methods
  isDevelopment: process.env.NODE_ENV === 'development',
  isProduction: process.env.NODE_ENV === 'production'
};