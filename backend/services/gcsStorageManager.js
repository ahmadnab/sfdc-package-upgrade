// services/gcsStorageManager.js - Google Cloud Storage adapter for persistence
const { Storage } = require('@google-cloud/storage');
const logger = require('../utils/logger');

class GCSStorageManager {
  constructor() {
    this.bucketName = process.env.GCS_BUCKET_NAME;
    this.useGCS = !!this.bucketName;
    
    if (this.useGCS) {
      try {
        this.storage = new Storage();
        this.bucket = this.storage.bucket(this.bucketName);
        logger.info(`GCS Storage initialized with bucket: ${this.bucketName}`);
      } catch (error) {
        logger.error('Failed to initialize GCS:', error);
        this.useGCS = false;
      }
    }
  }

  async readFile(filePath) {
    if (!this.useGCS) {
      // Fallback to local file system
      const fs = require('fs').promises;
      return fs.readFile(filePath, 'utf8');
    }

    try {
      const fileName = filePath.split('/').pop();
      const file = this.bucket.file(fileName);
      const [exists] = await file.exists();
      
      if (!exists) {
        throw new Error(`File ${fileName} not found in GCS`);
      }
      
      const [contents] = await file.download();
      return contents.toString('utf8');
    } catch (error) {
      if (error.code === 404 || error.message.includes('not found')) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      }
      throw error;
    }
  }

  async writeFile(filePath, data) {
    if (!this.useGCS) {
      // Fallback to local file system
      const fs = require('fs').promises;
      const path = require('path');
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });
      return fs.writeFile(filePath, data);
    }

    try {
      const fileName = filePath.split('/').pop();
      const file = this.bucket.file(fileName);
      
      await file.save(data, {
        metadata: {
          contentType: 'application/json',
          cacheControl: 'no-cache',
        }
      });
      
      logger.debug(`File ${fileName} saved to GCS`);
    } catch (error) {
      logger.error(`Error saving file to GCS:`, error);
      throw error;
    }
  }

  async exists(filePath) {
    if (!this.useGCS) {
      const fs = require('fs').promises;
      try {
        await fs.access(filePath);
        return true;
      } catch {
        return false;
      }
    }

    try {
      const fileName = filePath.split('/').pop();
      const file = this.bucket.file(fileName);
      const [exists] = await file.exists();
      return exists;
    } catch (error) {
      logger.error(`Error checking file existence in GCS:`, error);
      return false;
    }
  }

  async createBackup() {
    if (!this.useGCS) return null;

    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPrefix = `backups/${timestamp}`;
      
      // Copy current files to backup location
      const files = ['orgs-config.json', 'upgrade-history.json'];
      
      for (const fileName of files) {
        const file = this.bucket.file(fileName);
        const [exists] = await file.exists();
        
        if (exists) {
          const backupFile = this.bucket.file(`${backupPrefix}/${fileName}`);
          await file.copy(backupFile);
        }
      }
      
      logger.info(`Backup created: ${backupPrefix}`);
      return backupPrefix;
    } catch (error) {
      logger.error('Error creating backup:', error);
      return null;
    }
  }
}

module.exports = {
  gcsStorageManager: new GCSStorageManager()
};