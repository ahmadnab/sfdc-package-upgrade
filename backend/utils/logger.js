// utils/logger.js - Centralized logging with different levels
const config = require('../config');

class Logger {
  constructor() {
    this.isDevelopment = config.isDevelopment;
  }

  formatMessage(level, message, ...args) {
    const timestamp = new Date().toISOString();
    const formattedArgs = args.length > 0 ? ' ' + args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg
    ).join(' ') : '';
    
    return `[${timestamp}] [${level}] ${message}${formattedArgs}`;
  }

  info(message, ...args) {
    console.log(this.formatMessage('INFO', message, ...args));
  }

  warn(message, ...args) {
    console.warn(this.formatMessage('WARN', message, ...args));
  }

  error(message, error = null) {
    const errorMessage = error ? 
      `${message}: ${error.message || error}` : 
      message;
    
    console.error(this.formatMessage('ERROR', errorMessage));
    
    if (error && error.stack && this.isDevelopment) {
      console.error(error.stack);
    }
  }

  debug(message, ...args) {
    if (this.isDevelopment) {
      console.log(this.formatMessage('DEBUG', message, ...args));
    }
  }

  // Special method for request logging
  logRequest(method, path, statusCode, duration) {
    if (this.isDevelopment || statusCode >= 400) {
      this.info(`${method} ${path} - ${statusCode} (${duration}ms)`);
    }
  }

  // Browser specific logging
  browserInfo(action, orgName) {
    this.info(`[BROWSER] ${action} for ${orgName}`);
  }

  browserError(action, orgName, error) {
    this.error(`[BROWSER] ${action} failed for ${orgName}`, error);
  }

  // Status update logging
  statusUpdate(sessionId, orgId, status) {
    this.debug(`[STATUS] Session ${sessionId} - Org ${orgId}: ${status}`);
  }

  // Performance logging
  performance(operation, duration) {
    this.info(`[PERF] ${operation} completed in ${duration}ms`);
  }
}

module.exports = new Logger();