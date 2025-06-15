// middleware/index.js - Centralized middleware configuration
const express = require('express');
const cors = require('cors');
const config = require('../config');
const logger = require('../utils/logger');

// CORS configuration
const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);
    
    const isAllowed = config.ALLOWED_ORIGINS.some(allowed => {
      if (allowed instanceof RegExp) return allowed.test(origin);
      return allowed === origin;
    });
    
    if (isAllowed) {
      callback(null, true);
    } else {
      callback(new Error(`CORS policy: Origin ${origin} not allowed`));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200
};

// Request logging middleware
const requestLogger = (req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.logRequest(req.method, req.path, res.statusCode, duration);
  });
  next();
};

// Authentication middleware
const authenticate = (req, res, next) => {
  if (!config.API_KEY) return next();
  
  const providedKey = req.headers['x-api-key'] || req.query.api_key;
  
  if (providedKey === config.API_KEY) {
    next();
  } else {
    res.status(401).json({ 
      error: 'Authentication required',
      message: 'Please provide a valid API key'
    });
  }
};

// Package ID validation middleware
const validatePackageId = (req, res, next) => {
  const { packageUrl } = req.body;
  
  if (!packageUrl) {
    return res.status(400).json({ 
      error: 'Validation error',
      message: 'Package ID is required'
    });
  }
  
  if (!/^04t[a-zA-Z0-9]{12}$/.test(packageUrl)) {
    return res.status(400).json({ 
      error: 'Validation error',
      message: 'Invalid package ID format. Must be 15 characters starting with "04t"'
    });
  }
  
  next();
};

// Async handler wrapper
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Setup all middleware
const setupMiddleware = (app) => {
  app.use(cors(corsOptions));
  app.use(express.json({ limit: config.MAX_REQUEST_SIZE }));
  app.use(requestLogger);
};

module.exports = {
  setupMiddleware,
  authenticate,
  validatePackageId,
  asyncHandler
};