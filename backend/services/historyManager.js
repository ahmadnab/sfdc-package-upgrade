// services/historyManager.js - History persistence with GCS support
const config = require('../config');
const logger = require('../utils/logger');
const { gcsStorageManager } = require('./gcsStorageManager');

class HistoryManager {
  constructor() {
    this.historyPath = config.HISTORY_LOG_PATH;
    this.storage = gcsStorageManager;
  }

  async loadHistory() {
    try {
      const data = await this.storage.readFile(this.historyPath);
      const history = JSON.parse(data);
      // Ensure upgrades array exists
      if (!history.upgrades) {
        history.upgrades = [];
      }
      return history;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return { upgrades: [] };
      }
      logger.error('Error loading history:', error);
      return { upgrades: [] };
    }
  }

  async saveHistory(history) {
    try {
      // Limit history size
      if (history.upgrades && history.upgrades.length > config.MAX_HISTORY_ENTRIES) {
        history.upgrades = history.upgrades.slice(0, config.MAX_HISTORY_ENTRIES);
      }
      
      await this.storage.writeFile(
        this.historyPath, 
        JSON.stringify(history, null, 2)
      );
      
      logger.debug('History saved successfully');
    } catch (error) {
      logger.error('Error saving history', error);
      // Don't throw - history is not critical
    }
  }

  async addEntry(entry) {
    try {
      const history = await this.loadHistory();
      if (!history.upgrades) {
        history.upgrades = [];
      }
      
      // Add to beginning of array (newest first)
      history.upgrades.unshift(entry);
      
      await this.saveHistory(history);
      logger.debug(`History entry added: ${entry.id}`);
    } catch (error) {
      logger.error('Error adding history entry', error);
    }
  }

  async updateEntry(entryId, updates) {
    try {
      const history = await this.loadHistory();
      const index = history.upgrades.findIndex(u => u.id === entryId);
      
      if (index !== -1) {
        history.upgrades[index] = { ...history.upgrades[index], ...updates };
        await this.saveHistory(history);
        logger.debug(`History entry updated: ${entryId}`);
      }
    } catch (error) {
      logger.error('Error updating history entry', error);
    }
  }

  async getHistory(offset = 0, limit = 50) {
    try {
      const history = await this.loadHistory();
      
      // Ensure upgrades array exists
      const upgrades = history.upgrades || [];
      
      const startIndex = offset;
      const endIndex = startIndex + limit;
      const paginatedHistory = upgrades.slice(startIndex, endIndex);
      
      return {
        upgrades: paginatedHistory,
        total: upgrades.length,
        limit: limit,
        offset: offset
      };
    } catch (error) {
      logger.error('Error fetching history', error);
      return {
        upgrades: [],
        total: 0,
        limit: limit,
        offset: offset
      };
    }
  }

  async getEntryById(entryId) {
    try {
      const history = await this.loadHistory();
      return history.upgrades.find(u => u.id === entryId);
    } catch (error) {
      logger.error('Error fetching history entry', error);
      return null;
    }
  }

  async getEntriesByBatchId(batchId) {
    try {
      const history = await this.loadHistory();
      return history.upgrades.filter(u => u.batchId === batchId);
    } catch (error) {
      logger.error('Error fetching batch history entries', error);
      return [];
    }
  }

  async getStats() {
    try {
      const history = await this.loadHistory();
      const upgrades = history.upgrades || [];
      
      const stats = {
        total: upgrades.length,
        successful: upgrades.filter(u => u.status === 'success').length,
        failed: upgrades.filter(u => u.status === 'failed').length,
        timeout: upgrades.filter(u => u.status === 'timeout').length,
        inProgress: upgrades.filter(u => u.status === 'in-progress').length
      };
      
      return stats;
    } catch (error) {
      logger.error('Error calculating history stats', error);
      return {
        total: 0,
        successful: 0,
        failed: 0,
        timeout: 0,
        inProgress: 0
      };
    }
  }

  async cleanup() {
    try {
      const history = await this.loadHistory();
      
      // Remove very old entries (30+ days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const filteredUpgrades = history.upgrades.filter(entry => {
        const entryDate = new Date(entry.startTime);
        return entryDate > thirtyDaysAgo;
      });
      
      if (filteredUpgrades.length < history.upgrades.length) {
        history.upgrades = filteredUpgrades;
        await this.saveHistory(history);
        logger.info(`History cleanup: removed ${history.upgrades.length - filteredUpgrades.length} old entries`);
      }
    } catch (error) {
      logger.error('Error during history cleanup', error);
    }
  }
}

module.exports = {
  historyManager: new HistoryManager()
};