# Salesforce Package Upgrade Automation

Automate Salesforce package upgrades across multiple orgs with a modern web UI and robust backend.

## Features

- **Single & Batch Upgrades:** Upgrade one or many orgs in parallel.
- **Status Tracking:** Real-time progress via SSE or polling.
- **Version & Verification Handling:** Supports version confirmation and 2FA code entry.
- **History:** View upgrade logs and results.
- **Secure:** API key authentication and CORS controls.
- **Resource Management:** Limits concurrent browser sessions for stability.

## Tech Stack

- **Frontend:** React (TypeScript, Tailwind CSS)
- **Backend:** Node.js (Express, Playwright)
- **Communication:** REST API, Server-Sent Events (SSE)
- **Persistence:** JSON files for org config and upgrade history

## Quick Start

### 1. Clone & Install

```sh
git clone https://github.com/yourusername/salesforce-upgrade-automation.git
cd salesforce-upgrade-automation
cd backend && npm install
cd ../frontend && npm install
```

### 2. Configure Orgs

Edit `backend/orgs-config.json`:

```json
{
  "orgs": [
    {
      "id": "org1",
      "name": "My Org",
      "url": "https://login.salesforce.com",
      "username": "user@example.com",
      "password": "yourpassword"
    }
    // Add more orgs as needed
  ]
}
```

### 3. Set Environment Variables

Create a `.env` file in `backend/` (optional):

```
API_KEY=your_api_key
FRONTEND_URL=http://localhost:3000
```

For the frontend, you can set the backend API URL (if not using the default):

```
REACT_APP_API_URL=http://localhost:8080
```

### 4. Run Backend

```sh
cd backend
npm start
```

### 5. Run Frontend

```sh
cd frontend
npm start
```

Visit [http://localhost:3000](http://localhost:3000).

## Usage

- **Single Upgrade:** Select an org, enter a package ID (15 chars, starts with `04t`), and start.
- **Batch Upgrade:** Select multiple orgs, set concurrency, and start.
- **History:** Review past upgrades and their results.

## Usage Screenshots

| Single Upgrade Tab | Batch Upgrade Tab | History Tab |
|:------------------:|:----------------:|:-----------:|
| ![Single Upgrade](docs/screenshots/single-upgrade.png) | ![Batch Upgrade](docs/screenshots/batch-upgrade.png) | ![History](docs/screenshots/history.png) |

> _Place your screenshots in `docs/screenshots/` or update the paths above. Filenames should match the UI tabs: `single-upgrade.png`, `batch-upgrade.png`, `history.png`._

## Deployment Instructions

### Docker (Recommended)

1. Build and run the backend:

```sh
cd backend
# Build Docker image
docker build -t salesforce-upgrade-backend .
# Run container
# Replace <API_KEY> and <FRONTEND_URL> as needed

docker run -d \
  -p 8080:8080 \
  -e API_KEY=your_api_key \
  -e FRONTEND_URL=http://localhost:3000 \
  -v $(pwd)/orgs-config.json:/app/orgs-config.json \
  --name salesforce-upgrade-backend \
  salesforce-upgrade-backend
```

> **Note:** The backend requires Playwright and Chromium dependencies. The provided Dockerfile installs these. If you encounter browser launch errors, ensure your host supports running headless Chromium (see [Playwright docs](https://playwright.dev/docs/installation)).

2. Build and run the frontend:

```sh
cd frontend
npm run build
# Serve with any static server, e.g.:
npm install -g serve
serve -s build -l 3000
```

### Vercel/Netlify (Frontend Only)

- Deploy the `frontend/` directory as a static site.
- Set the backend API URL via the `REACT_APP_API_URL` environment variable.

### Cloud Run/Heroku (Backend)

- Deploy the backend Docker image or Node.js app as per your platform's instructions.
- Set environment variables for `API_KEY` and `FRONTEND_URL`.

## Troubleshooting

- **Playwright/Chromium errors:** If you see browser launch errors in Docker or cloud, check that all dependencies for headless Chromium are installed. See [Playwright troubleshooting](https://playwright.dev/docs/faq#docker).
- **CORS or API key errors:** Ensure your frontend and backend URLs and API keys match your environment variables.

## Security

- API key required for all endpoints if set.
- Passwords are never exposed to the frontend.
- CORS is restricted to allowed origins.

## Development

- **Backend:** See `backend/server.js` for API and automation logic.
- **Frontend:** See `frontend/src/App.tsx` for UI and API integration.

## License

MIT
