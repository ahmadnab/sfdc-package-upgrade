# Salesforce Package Upgrade Automation

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org)
[![React](https://img.shields.io/badge/react-%5E19.0.0-blue)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/typescript-%5E4.9.0-blue)](https://www.typescriptlang.org/)

A powerful automation tool for upgrading Salesforce packages across multiple organizations with a modern web interface. Built with React, TypeScript, Node.js, and Playwright for reliable browser automation.

![Salesforce Automation Dashboard](https://github.com/yourusername/salesforce-automation/raw/main/screenshots/dashboard.png)

## 🚀 Features

### Core Functionality
- **🔄 Single Organization Upgrade**: Upgrade packages in individual Salesforce orgs with real-time monitoring
- **⚡ Batch Processing**: Upgrade multiple organizations concurrently (up to 50 orgs, 1-4 concurrent)
- **📋 Version Confirmation**: Interactive review and confirmation of package versions before installation
- **🔐 2FA Support**: Seamless handling of Salesforce verification codes via email
- **📊 Real-time Status Updates**: Live progress monitoring with Server-Sent Events (SSE)
- **📸 Error Screenshots**: Automatic screenshot capture on failures for easy debugging
- **📈 History Tracking**: Complete audit trail of all upgrade attempts with search and filtering
- **⚙️ Organization Management**: Add, edit, and manage Salesforce org credentials through the UI

### Technical Features
- **🌐 Modern React UI**: Responsive interface built with React 19 and Tailwind CSS
- **🔧 TypeScript**: Full type safety throughout the application
- **🤖 Browser Automation**: Reliable Playwright-based automation with retry logic
- **🐳 Docker Support**: Containerized deployment with Docker and Docker Compose
- **☁️ Cloud Ready**: Optimized for deployment on Google Cloud Run, Heroku, and other platforms
- **🔒 Security**: API key authentication, input validation, and secure credential storage

## 📋 Prerequisites

- **Node.js**: 18.0.0 or higher
- **npm or yarn**: Latest version
- **Google Chrome**: Required for Playwright automation
- **Salesforce Orgs**: With appropriate package management permissions

## 🛠️ Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/salesforce-package-upgrade-automation.git
cd salesforce-package-upgrade-automation
```

### 2. Install Dependencies

```bash
# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
```

### 3. Configure Environment Variables

Create `.env` files in both directories:

**backend/.env**
```env
PORT=8080
NODE_ENV=development
API_KEY=your-secret-api-key-here
FRONTEND_URL=http://localhost:3000
HISTORY_LOG_PATH=./data/upgrade-history.json
ORGS_CONFIG_PATH=./data/orgs-config.json
```

**frontend/.env**
```env
REACT_APP_API_URL=http://localhost:8080
REACT_APP_API_KEY=your-secret-api-key-here
```

### 4. Start the Application

```bash
# Terminal 1: Start backend server
cd backend
npm start

# Terminal 2: Start frontend development server
cd frontend
npm start
```

### 5. Access the Application

Open your browser and navigate to `http://localhost:3000`

Default passcode: `Ec@12345`

## 🔧 Configuration

### Organization Setup

You can manage organizations through the web interface or by directly editing the configuration file:

**backend/data/orgs-config.json**
```json
{
  "orgs": [
    {
      "id": "org-prod-001",
      "name": "Production Org",
      "url": "https://mycompany.my.salesforce.com",
      "username": "admin@mycompany.com",
      "password": "your-secure-password"
    },
    {
      "id": "org-sandbox-001", 
      "name": "UAT Sandbox",
      "url": "https://mycompany--uat.my.salesforce.com",
      "username": "admin@mycompany.com.uat",
      "password": "your-secure-password"
    }
  ]
}
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Backend server port | `8080` |
| `API_KEY` | Authentication key | None (required) |
| `FRONTEND_URL` | Frontend URL for CORS | `http://localhost:3000` |
| `HISTORY_LOG_PATH` | Path to history file | `./data/upgrade-history.json` |
| `ORGS_CONFIG_PATH` | Path to orgs config | `./data/orgs-config.json` |
| `MAX_CONCURRENT_BROWSERS` | Max browser instances | `4` |
| `VERIFICATION_TIMEOUT` | 2FA timeout (ms) | `120000` |

## 📖 Usage Guide

### Single Organization Upgrade

1. **Navigate to Organizations Tab**: Add your Salesforce orgs with credentials
2. **Go to Single Upgrade Tab**: Select an organization from the dropdown
3. **Enter Package ID**: Input the 15-character Salesforce package ID (e.g., `04tKb000000J8s9`)
4. **Start Upgrade**: Click "Start Upgrade" to begin the process
5. **Version Confirmation**: Review and confirm the package version when prompted
6. **Handle 2FA**: Enter verification code if two-factor authentication is required
7. **Monitor Progress**: Watch real-time status updates as the upgrade proceeds

### Batch Upgrade

1. **Select Organizations**: Choose multiple orgs (up to 50) for batch processing
2. **Configure Concurrency**: Set processing mode (1-4 concurrent upgrades)
3. **Enter Package ID**: Same package will be installed across all selected orgs
4. **Start Batch**: Confirm the batch operation
5. **Monitor Progress**: Track overall progress and individual org status
6. **Review Results**: Check the completion summary with success/failure counts

### Organization Management

- **Add Org**: Click "Add Organization" to configure new Salesforce orgs
- **Edit Org**: Modify existing org credentials and settings
- **Delete Org**: Remove organizations (with confirmation prompt)
- **Security**: Passwords are stored securely and never displayed after saving

### History & Monitoring

- **View History**: Complete log of all upgrade attempts with timestamps
- **Error Details**: View screenshots captured during failed upgrades
- **Filter Results**: Search and filter by organization, status, or date
- **Export Data**: Download history for reporting and analysis

## 🐳 Docker Deployment

### Using Docker Compose (Recommended)

```bash
# Clone and navigate to project
git clone https://github.com/yourusername/salesforce-package-upgrade-automation.git
cd salesforce-package-upgrade-automation

# Configure environment variables
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env

# Start with Docker Compose
docker-compose up -d
```

### Manual Docker Build

```bash
# Backend
cd backend
docker build -t sf-automation-backend .
docker run -p 8080:8080 --env-file .env sf-automation-backend

# Frontend  
cd ../frontend
docker build -t sf-automation-frontend .
docker run -p 3000:80 sf-automation-frontend
```

## ☁️ Cloud Deployment

### Google Cloud Run

```bash
# Build and push to Google Container Registry
gcloud builds submit --tag gcr.io/PROJECT-ID/sf-automation

# Deploy to Cloud Run
gcloud run deploy sf-automation \
  --image gcr.io/PROJECT-ID/sf-automation \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --memory 2Gi \
  --timeout 300s
```

### Heroku

```bash
# Create Heroku app
heroku create your-sf-automation-app

# Add environment variables
heroku config:set API_KEY=your-secret-key
heroku config:set NODE_ENV=production

# Deploy
git push heroku main
```

### Vercel (Frontend Only)

```bash
cd frontend
npx vercel
```

## 🔒 Security Considerations

### Production Security Checklist

- [ ] **Environment Variables**: Store all secrets in environment variables, never in code
- [ ] **API Keys**: Use strong, unique API keys for authentication
- [ ] **HTTPS**: Deploy with SSL/TLS certificates in production
- [ ] **CORS**: Configure allowed origins to match your domain
- [ ] **Credentials**: Use dedicated integration users with minimal required permissions
- [ ] **Network**: Restrict access using firewalls or VPN when possible
- [ ] **Monitoring**: Enable logging and monitoring for security events

### Credential Management

```bash
# Example: Using environment variables for org config
export ORGS_CONFIG='{
  "orgs": [
    {
      "id": "prod",
      "name": "Production",
      "url": "https://company.my.salesforce.com",
      "username": "integration@company.com",
      "password": "'"$SF_PROD_PASSWORD"'"
    }
  ]
}'
```

## 🧪 Testing

### Running Tests

```bash
# Backend tests
cd backend
npm test

# Frontend tests  
cd frontend
npm test

# End-to-end tests
npm run test:e2e
```

### Manual Testing Checklist

- [ ] Test with Salesforce Developer Edition or Sandbox
- [ ] Verify error handling with invalid credentials
- [ ] Test 2FA flow with verification codes
- [ ] Validate concurrent batch operations
- [ ] Check screenshot capture on failures
- [ ] Verify history persistence and retrieval

## 🚨 Troubleshooting

### Common Issues

**🔴 Browser Launch Failures**
```bash
# Install Playwright browsers
npx playwright install chromium

# Set custom Chrome path if needed
export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome
```

**🔴 Connection Errors**
- Verify backend is running on correct port
- Check CORS configuration matches frontend URL
- Ensure API keys match between frontend and backend

**🔴 Salesforce Login Issues**
- Verify credentials in organization configuration
- Check for IP restrictions in Salesforce org settings
- Ensure user has Package Manager permissions

**🔴 Cloud Run Timeouts**
- Cloud Run has 5-minute request timeout
- Use batch processing for large package deployments
- Consider breaking large operations into smaller chunks

### Debug Mode

Enable detailed logging:

```bash
# Backend debug mode
DEBUG=* npm run dev

# Frontend console logging
REACT_APP_DEBUG=true npm start
```

### Log Locations

- **Backend Logs**: Console output or configured log file
- **History Data**: `backend/data/upgrade-history.json`
- **Organization Config**: `backend/data/orgs-config.json`
- **Browser Screenshots**: Embedded in error responses (base64)

## 🏗️ Architecture

### System Overview

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│                 │    │                 │    │                 │
│   React Frontend│◄───┤   Node.js API   │◄───┤   Playwright    │
│   (TypeScript)  │    │   (Express)     │    │   (Browser)     │
│                 │    │                 │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│                 │    │                 │    │                 │
│   Tailwind CSS  │    │   File Storage  │    │   Salesforce    │
│   Server-Sent   │    │   JSON Config   │    │   Organizations │
│   Events (SSE)  │    │   History Logs  │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Key Components

- **Frontend**: React SPA with TypeScript, real-time updates via SSE
- **Backend**: Express.js API with Playwright automation engine  
- **Storage**: File-based JSON for configuration and history
- **Automation**: Headless Chrome with Playwright for Salesforce interaction
- **Security**: API key authentication, input validation, CORS protection

## 🤝 Contributing

We welcome contributions! Please follow these guidelines:

### Development Setup

1. **Fork the repository**
2. **Create a feature branch**: `git checkout -b feature/amazing-feature`
3. **Install dependencies**: `npm install` in both `backend/` and `frontend/`
4. **Make changes**: Follow existing code style and patterns
5. **Add tests**: Include unit tests for new functionality
6. **Update docs**: Update README if needed
7. **Submit PR**: Create a pull request with detailed description

### Code Standards

- **TypeScript**: Use strict type checking
- **ESLint**: Follow configured linting rules
- **Prettier**: Format code consistently
- **Conventional Commits**: Use semantic commit messages
- **Testing**: Maintain test coverage above 80%

### Issue Templates

When reporting bugs or requesting features, please include:

- **Environment**: OS, Node.js version, browser
- **Steps to reproduce**: Detailed reproduction steps
- **Expected behavior**: What should happen
- **Actual behavior**: What actually happens
- **Screenshots**: If applicable
- **Logs**: Relevant error messages or logs

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

**⭐ If this project helps you, please consider giving it a star on GitHub!**
