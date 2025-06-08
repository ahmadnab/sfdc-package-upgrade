# Salesforce Package Upgrade Automation - Setup Guide

---

## 📁 Project Structure

```
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
```

---

## ⚙️ Setup Instructions

### 1. Backend Setup

1. **Navigate to the backend directory:**
   ```bash
   cd backend
   ```
2. **Copy and update your orgs-config.json:**
   ```json
   {
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
   ```
3. **Install dependencies:**
   ```bash
   npm install
   ```
4. **Start the backend server:**
   ```bash
   npm start
   ```

---

### 2. Frontend Setup

1. **Navigate to the frontend directory:**
   ```bash
   cd frontend
   ```
2. **Create the basic React app structure:**
   ```bash
   npx create-react-app . --template typescript
   ```
3. **Replace `src/App.tsx` with the provided React component code.**
   - Rename `App.js` to `App.tsx` if needed.
4. **Add Tailwind CSS to your `public/index.html`:**
   ```html
   <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
   ```
5. **Install socket.io-client and its TypeScript types:**
   ```bash
   npm install socket.io-client
   npm install --save-dev @types/socket.io-client
   ```
6. **Start the frontend:**
   ```bash
   npm start
   ```

---

## 🚀 New Features

### 🎯 Batch Upgrades
- Select multiple orgs to upgrade with the same package
- Parallel processing with configurable concurrency (1-4 simultaneous upgrades)
- Real-time progress tracking showing completed/in-progress orgs
- Resource-aware: Choose concurrency based on your system capabilities
- Batch summary with success/failure counts

#### Parallel Processing Options
| Option         | Description                                 |
|---------------|---------------------------------------------|
| **1**         | Sequential: One org at a time (safest)      |
| **2**         | Recommended: Good balance                   |
| **3**         | Faster if your system can handle it          |
| **4**         | Maximum: Fastest, needs powerful hardware    |

Choose based on:
- Your computer's RAM and CPU
- Network bandwidth
- Number of orgs to upgrade

### 📊 Upgrade History
- Automatic logging of all upgrade attempts
- Detailed tracking: start/end times, duration, status, error messages
- Batch vs single upgrade type
- Persistent storage in `upgrade-history.json` (last 100 entries kept)

---

## 🧑‍💻 Usage

1. **Start both servers:**
   - Backend (port 5000/5001)
   - Frontend (port 3000)
2. **Open the UI:**
   - [http://localhost:3000](http://localhost:3000)
3. **Choose upgrade type:**
   - **Single Upgrade:** Select one org and upgrade
   - **Batch Upgrade:** Select multiple orgs for sequential upgrades
   - **History:** View past upgrade attempts

### Single Upgrade
1. Click the **Single Upgrade** tab
2. Select an org from the dropdown
3. Enter the package ID (e.g., `04tKb000000J8s9`)
4. Click **Start Upgrade**

### Batch Upgrade
1. Click the **Batch Upgrade** tab
2. Check the orgs you want to upgrade (or use Select All)
3. Enter the package ID (e.g., `04tKb000000J8s9`)
4. Click **Start Batch Upgrade**
5. Monitor progress as each org is processed

#### Package ID
- The package ID is the 15-character identifier from your Salesforce package URL:
  - **Full URL:** `https://yourorg.lightning.force.com/packaging/installPackage.apexp?p0=04tKb000000J8s9`
  - **Package ID:** `04tKb000000J8s9` (this is what you enter)
  - **Format:** Always starts with `04t` followed by 12 alphanumeric characters

### View History
- Click the **History** tab
- See all past upgrades with details
- Click **Refresh** to update the list

---

## 📂 File Structure
- `orgs-config.json` - Your org credentials (**never commit this!**)
- `upgrade-history.json` - Log of all upgrade attempts (auto-created)

---

## ⚠️ Important Notes

### Security Considerations
- **Never commit the `orgs-config.json` file to version control**
- Add `orgs-config.json` to your `.gitignore`
- Consider encrypting credentials for production use

---

## 🛠️ Troubleshooting

### Login Issues
- Ensure credentials are correct
- Check if Salesforce requires IP whitelisting
- Handle 2FA if enabled on your orgs

### Button Not Found
- The script tries multiple selectors for the upgrade button
- You can add more selectors in the `upgradeButtonSelectors` array

### Timeout Issues
- Increase timeout values in the code if needed
- Check your internet connection

---

## 🧩 Customization Options

- **Headless Mode:** Change `headless: false` to `true` in `server.js` to run without browser UI
- **Additional Verification:** The script waits for manual verification if needed (2FA, security challenges)
- **Success Detection:** Modify the success detection logic in `waitForFunction` if your org shows different success messages

---

## 🏆 Key Improvements with Playwright

### Why Playwright over Puppeteer?
- **Better reliability:** More stable automation with auto-waiting for elements
- **Superior selectors:** Built-in support for text-based and role-based selectors
- **Cross-browser support:** Easily switch between Chromium, Firefox, and WebKit
- **Better error handling:** More descriptive errors and debugging capabilities
- **Modern API:** Cleaner syntax with better TypeScript support
