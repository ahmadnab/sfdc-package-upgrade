// services/orgManager.js - Organization configuration management
const fs = require('fs').promises;
const logger = require('../utils/logger');

class OrgManager {
  constructor() {
    this.config = null;
    this.lastLoaded = null;
  }

  async loadConfig() {
    try {
      // Cache for 5 minutes
      if (this.config && this.lastLoaded && Date.now() - this.lastLoaded < 5 * 60 * 1000) {
        return this.config;
      }

      // Environment variable takes precedence
      if (process.env.ORGS_CONFIG) {
        const config = JSON.parse(process.env.ORGS_CONFIG);
        this.validateConfig(config);
        this.config = config;
        this.lastLoaded = Date.now();
        return config;
      }
      
      // Fallback to file
      const data = await fs.readFile('orgs-config.json', 'utf8');
      const config = JSON.parse(data);
      this.validateConfig(config);
      this.config = config;
      this.lastLoaded = Date.now();
      return config;
    } catch (error) {
      logger.error('Error loading org config', error);
      if (error instanceof SyntaxError) {
        throw new Error('Invalid JSON in org configuration');
      }
      throw error;
    }
  }

  validateConfig(config) {
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

  async getOrgs() {
    const config = await this.loadConfig();
    // Return orgs without passwords for security
    return config.orgs.map(({ password, ...org }) => org);
  }

  async getOrgById(orgId) {
    const config = await this.loadConfig();
    return config.orgs.find(o => o.id === orgId);
  }

  async getOrgsByIds(orgIds) {
    const config = await this.loadConfig();
    return orgIds
      .map(id => config.orgs.find(o => o.id === id))
      .filter(Boolean);
  }

  async validateOrgExists(orgId) {
    const org = await this.getOrgById(orgId);
    return !!org;
  }

  async getOrgCount() {
    const config = await this.loadConfig();
    return config.orgs.length;
  }

  // Method to refresh configuration (useful for dynamic updates)
  async refreshConfig() {
    this.config = null;
    this.lastLoaded = null;
    return this.loadConfig();
  }
}

module.exports = {
  orgManager: new OrgManager()
};