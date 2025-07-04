// services/orgManager.js - Organization configuration with GCS support
const config = require('../config');
const logger = require('../utils/logger');
const { gcsStorageManager } = require('./gcsStorageManager');

class OrgManager {
  constructor() {
    this.config = null;
    this.lastLoaded = null;
    this.configPath = config.ORGS_CONFIG_PATH;
    this.storage = gcsStorageManager;
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
      
      // Try to read from storage (GCS or local)
      try {
        const data = await this.storage.readFile(this.configPath);
        const config = JSON.parse(data);
        this.validateConfig(config);
        this.config = config;
        this.lastLoaded = Date.now();
        return config;
      } catch (error) {
        // If file doesn't exist, create default config
        if (error.code === 'ENOENT') {
          const defaultConfig = { orgs: [] };
          await this.saveConfig(defaultConfig);
          this.config = defaultConfig;
          this.lastLoaded = Date.now();
          return defaultConfig;
        }
        throw error;
      }
    } catch (error) {
      logger.error('Error loading org config', error);
      if (error instanceof SyntaxError) {
        throw new Error('Invalid JSON in org configuration');
      }
      // Return empty config as fallback
      return { orgs: [] };
    }
  }

  async saveConfig(config) {
    try {
      // Don't save if using environment variable
      if (process.env.ORGS_CONFIG) {
        throw new Error('Cannot modify organizations when using environment variable configuration');
      }
      
      // Write config
      await this.storage.writeFile(
        this.configPath, 
        JSON.stringify(config, null, 2)
      );
      
      // Clear cache
      this.config = null;
      this.lastLoaded = null;
      
      logger.debug('Organization config saved successfully');
    } catch (error) {
      logger.error('Error saving org config', error);
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

  async addOrg(orgData) {
    const config = await this.loadConfig();
    
    // Check for duplicate names
    if (config.orgs.some(o => o.name === orgData.name)) {
      throw new Error(`Organization with name "${orgData.name}" already exists`);
    }
    
    // Validate new org
    this.validateConfig({ orgs: [orgData] });
    
    // Add to config
    config.orgs.push(orgData);
    
    // Save
    await this.saveConfig(config);
    
    logger.info(`Organization added: ${orgData.name} (${orgData.id})`);
    return orgData;
  }

  async updateOrg(orgId, updates) {
    const config = await this.loadConfig();
    const index = config.orgs.findIndex(o => o.id === orgId);
    
    if (index === -1) {
      return false;
    }
    
    // Check for duplicate names (excluding current org)
    if (updates.name && config.orgs.some((o, i) => i !== index && o.name === updates.name)) {
      throw new Error(`Organization with name "${updates.name}" already exists`);
    }
    
    // Merge updates
    const updatedOrg = { ...config.orgs[index], ...updates };
    
    // Validate updated org
    this.validateConfig({ orgs: [updatedOrg] });
    
    // Update in config
    config.orgs[index] = updatedOrg;
    
    // Save
    await this.saveConfig(config);
    
    logger.info(`Organization updated: ${updatedOrg.name} (${orgId})`);
    return true;
  }

  async deleteOrg(orgId) {
    const config = await this.loadConfig();
    const initialLength = config.orgs.length;
    
    // Filter out the org
    config.orgs = config.orgs.filter(o => o.id !== orgId);
    
    if (config.orgs.length === initialLength) {
      return false; // Org not found
    }
    
    // Save
    await this.saveConfig(config);
    
    logger.info(`Organization deleted: ${orgId}`);
    return true;
  }

  // Method to refresh configuration (useful for dynamic updates)
  async refreshConfig() {
    this.config = null;
    this.lastLoaded = null;
    return this.loadConfig();
  }

  // Create backup before major operations
  async createBackup() {
    try {
      if (this.storage.createBackup) {
        return await this.storage.createBackup();
      }
    } catch (error) {
      logger.error('Error creating backup:', error);
    }
    return null;
  }
}

module.exports = {
  orgManager: new OrgManager()
};