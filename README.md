# Salesforce Package Upgrade Automation

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D16.0.0-brightgreen)](https://nodejs.org)
[![React](https://img.shields.io/badge/react-%5E18.0.0-blue)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/typescript-%5E4.9.0-blue)](https://www.typescriptlang.org/)

A powerful automation tool for upgrading Salesforce packages across multiple organizations with a user-friendly web interface. Built with React, TypeScript, Node.js, and Playwright.


## 🚀 Features

- **Single Organization Upgrade**: Upgrade packages in individual Salesforce orgs
- **Batch Processing**: Upgrade multiple organizations concurrently (up to 50 orgs)
- **Version Confirmation**: Review and confirm package versions before installation
- **2FA Support**: Handle Salesforce verification codes automatically
- **Real-time Status Updates**: Monitor upgrade progress with Server-Sent Events (SSE)
- **Error Screenshots**: Automatic screenshot capture on failures for debugging
- **History Tracking**: Complete audit trail of all upgrade attempts
- **Concurrent Processing**: Configurable concurrency for batch operations (1-4 simultaneous)
- **Responsive UI**: Modern, mobile-friendly interface built with React and Tailwind CSS

## 📋 Prerequisites

- Node.js 16.0.0 or higher
- npm or yarn
- Salesforce org credentials with appropriate permissions
- Google Chrome (for Playwright automation)

## 🛠️ Installation

### 1. Clone the repository

```bash
git clone https://github.com/yourusername/salesforce-upgrade-automation.git
cd salesforce-upgrade-automation
```

### 2. Install Backend Dependencies

```bash
cd backend
npm install
```

### 3. Install Frontend Dependencies

```bash
cd ../frontend
npm install
```

### 4. Configure Organizations

Create a `backend/orgs-config.json` file with your Salesforce organizations:

```json
{
  "orgs": [
    {
      "id": "org1",
      "name": "Production Org",
      "url": "https://mycompany.my.salesforce.com",
      "username": "admin@mycompany.com",
      "password": "yourpassword"
    },
    {
      "id": "org2",
      "name": "Sandbox Org",
      "url": "https://mycompany--sandbox.my.salesforce.com",
      "username": "admin@mycompany.com.sandbox",
      "password": "yourpassword"
    }
  ]
}
```

**⚠️ Security Note**: Never commit credentials to version control. Use environment variables for production.

### 5. Environment Variables

Create `.env` files in both frontend and backend directories:

**backend/.env**
```env
PORT=8080
NODE_ENV=development
API_KEY=your-secret-api-key
FRONTEND_URL=http://localhost:3000
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chrome # Optional
```

**frontend/.env**
```env
REACT_APP_API_URL=http://localhost:8080
REACT_APP_API_KEY=your-secret-api-key
```

## 🚀 Running the Application

### Development Mode

1. **Start the Backend Server**:
```bash
cd backend
npm run dev
```

2. **Start the Frontend Development Server**:
```bash
cd frontend
npm start
```

3. Open your browser and navigate to `http://localhost:3000`

### Production Mode

1. **Build the Frontend**:
```bash
cd frontend
npm run build
```

2. **Start the Backend Server**:
```bash
cd backend
npm start
```

## 🐳 Docker Support

### Using Docker Compose

```bash
docker-compose up -d
```

### Building Individual Images

**Backend**:
```bash
cd backend
docker build -t salesforce-automation-backend .
docker run -p 8080:8080 --env-file .env salesforce-automation-backend
```

**Frontend**:
```bash
cd frontend
docker build -t salesforce-automation-frontend .
docker run -p 3000:80 salesforce-automation-frontend
```

## 📖 Usage Guide

### Single Organization Upgrade

1. Select an organization from the dropdown
2. Enter the 15-character Salesforce package ID (e.g., `04tKb000000J8s9`)
3. Click "Start Upgrade"
4. Confirm the package version when prompted
5. Enter verification code if 2FA is enabled
6. Monitor progress in real-time

### Batch Upgrade

1. Select multiple organizations (max 50)
2. Enter the package ID
3. Choose processing mode (1-4 concurrent)
4. Click "Start Batch Upgrade"
5. Confirm versions and handle verification for each org
6. View progress and results in real-time

### Viewing History

1. Click the "History" tab
2. View all past upgrade attempts
3. Click "View Screenshot" for failed upgrades
4. Load more results as needed

## 🏗️ Architecture

### Backend Stack
- **Node.js + Express**: REST API server
- **Playwright**: Browser automation for Salesforce interaction
- **Server-Sent Events**: Real-time status updates
- **File-based storage**: History persistence

### Frontend Stack
- **React 18**: UI framework
- **TypeScript**: Type safety
- **Tailwind CSS**: Styling
- **Custom Hooks**: State management

### Key Features
- **Modular Design**: Clean separation of concerns
- **Error Recovery**: Automatic retries for transient failures
- **Resource Management**: Browser pool with limits
- **Graceful Shutdown**: Proper cleanup on termination

## 🔒 Security Considerations

1. **API Authentication**: Use API keys for backend access
2. **Credential Storage**: Store credentials securely (use environment variables or secrets management)
3. **CORS Configuration**: Restrict allowed origins in production
4. **HTTPS**: Use SSL/TLS in production environments
5. **Input Validation**: Package IDs are validated before processing

## 🧪 Testing

### Running Tests

```bash
# Backend tests
cd backend
npm test

# Frontend tests
cd frontend
npm test
```

### Manual Testing

1. Use a Salesforce Developer Edition or Sandbox
2. Test with known package IDs
3. Verify error handling with invalid credentials
4. Test concurrent operations with multiple orgs

## 🚨 Troubleshooting

### Common Issues

1. **Browser Launch Failures**
   - Ensure Chrome/Chromium is installed
   - Check Playwright dependencies: `npx playwright install`
   - Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` if needed

2. **Connection Errors**
   - Verify backend is running on correct port
   - Check CORS settings match your frontend URL
   - Ensure API keys match between frontend and backend

3. **Login Failures**
   - Verify credentials in `orgs-config.json`
   - Check for IP restrictions in Salesforce
   - Ensure user has necessary permissions

4. **Timeout Errors**
   - Cloud Run has a 5-minute timeout limit
   - Large packages may exceed this limit
   - Consider breaking into smaller batches

### Debug Mode

Enable debug logging:
```bash
DEBUG=* npm run dev
```

## 📦 Deployment

### Cloud Run (Google Cloud)

1. Build and push Docker image:
```bash
gcloud builds submit --tag gcr.io/PROJECT-ID/salesforce-automation
```

2. Deploy to Cloud Run:
```bash
gcloud run deploy --image gcr.io/PROJECT-ID/salesforce-automation --platform managed
```

### Heroku

1. Create Heroku app:
```bash
heroku create your-app-name
```

2. Deploy:
```bash
git push heroku main
```

### Vercel (Frontend)

1. Install Vercel CLI:
```bash
npm i -g vercel
```

2. Deploy frontend:
```bash
cd frontend
vercel
```

## 🤝 Contributing

We welcome contributions! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines

- Follow the existing code style
- Add tests for new features
- Update documentation as needed
- Use conventional commits

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
