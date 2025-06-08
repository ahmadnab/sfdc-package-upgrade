# Salesforce Package Upgrade Automation - Setup Guide
Project Structure
Create the following directory structure:
salesforce-upgrade-automation/
├── backend/
│   ├── server.js
│   ├── package.json
│   └── orgs-config.json
├── frontend/
│   ├── src/
│   │   └── App.js
│   ├── public/
│   │   └── index.html
│   └── package.json
Setup Instructions
# 1. Backend Setup

Navigate to the backend directory:
bashcd backend

Copy the orgs-config.json file and update it with your actual Salesforce org credentials:
json{
  "orgs": [
    {
      "id": "qa1315fto",
      "name": "Your QA Environment Name",
      "url": "https://qa1315fto.lightning.force.com/",
      "username": "your-actual-username@example.com",
      "password": "your-actual-password"
    }
    // Add your other 3 orgs here
  ]
}

Install dependencies:
bashnpm install

Start the backend server:
bashnpm start


# 2. Frontend Setup

In a new terminal, navigate to the frontend directory:
bashcd frontend

Create the basic React app structure:
bashnpx create-react-app . --template typescript

Replace the contents of src/App.tsx with the provided React component code. Since you're using TypeScript, you'll need to rename the component file from App.js to App.tsx.
Add Tailwind CSS to your public/index.html:
html<link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">

Install socket.io-client and its TypeScript types:
bashnpm install socket.io-client
npm install --save-dev @types/socket.io-client

Start the frontend:
bashnpm start


# New Features
🎯 Batch Upgrades

Select multiple orgs to upgrade with the same package
Parallel processing with configurable concurrency (1-4 simultaneous upgrades)
Real-time progress tracking showing completed/in-progress orgs
Resource-aware - Choose concurrency based on your system capabilities
Batch summary with success/failure counts

Parallel Processing Options

1 (Sequential): Processes one org at a time - safest option
2 (Recommended): Good balance of speed and resource usage
3: Faster processing if your system can handle it
4 (Maximum): Fastest option but requires powerful hardware

Choose based on:

Your computer's RAM and CPU
Network bandwidth
Number of orgs to upgrade

📊 Upgrade History

Automatic logging of all upgrade attempts
Detailed tracking including:

Start and end times
Duration of each upgrade
Success/failure status
Error messages for failed upgrades
Batch vs single upgrade type


Persistent storage in upgrade-history.json
Last 100 entries kept to prevent file bloat

# Usage

Start both servers: Make sure both the backend (port 5000/5001) and frontend (port 3000) are running.
Open the UI: Navigate to http://localhost:3000 in your browser.
Choose upgrade type:

Single Upgrade: Select one org and upgrade
Batch Upgrade: Select multiple orgs for sequential upgrades
History: View past upgrade attempts



Single Upgrade

Click the "Single Upgrade" tab
Select an org from the dropdown
Enter the package ID (e.g., 04tKb000000J8s9)
Click "Start Upgrade"

Batch Upgrade

Click the "Batch Upgrade" tab
Check the orgs you want to upgrade (or use Select All)
Enter the package ID (e.g., 04tKb000000J8s9)
Click "Start Batch Upgrade"
Monitor progress as each org is processed

Package ID
The package ID is the 15-character identifier from your Salesforce package URL:

Full URL: https://yourorg.lightning.force.com/packaging/installPackage.apexp?p0=04tKb000000J8s9
Package ID: 04tKb000000J8s9 (this is what you enter)
Format: Always starts with "04t" followed by 12 alphanumeric characters

View History

Click the "History" tab
See all past upgrades with details
Click "Refresh" to update the list

File Structure
The automation now creates these files:

orgs-config.json - Your org credentials (never commit this!)
upgrade-history.json - Log of all upgrade attempts (auto-created)

Important Notes
Security Considerations

Never commit the orgs-config.json file to version control
Add orgs-config.json to your .gitignore
Consider encrypting credentials for production use

# Troubleshooting

Login Issues:

Ensure credentials are correct
Check if Salesforce requires IP whitelisting
Handle 2FA if enabled on your orgs


Button Not Found:

The script tries multiple selectors for the upgrade button
You can add more selectors in the upgradeButtonSelectors array


Timeout Issues:

Increase timeout values in the code if needed
Check your internet connection



# Customization Options

Headless Mode: Change headless: false to true in server.js to run without browser UI
Additional Verification: The script waits for manual verification if needed (2FA, security challenges)
Success Detection: Modify the success detection logic in waitForFunction if your org shows different success messages

Key Improvements with Playwright
Why Playwright over Puppeteer?

Better reliability: More stable automation with auto-waiting for elements
Superior selectors: Built-in support for text-based and role-based selectors
Cross-browser support: Can easily switch between Chromium, Firefox, and WebKit
Better error handling: More descriptive errors and debugging capabilities
Modern API: Cleaner syntax with better TypeScript support
