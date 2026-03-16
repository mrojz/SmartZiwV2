# Installation Guide

This guide covers two ways to run Procurement Watch:

- Docker Compose
- Direct commands with Python and npm

## 1. Run with Docker Compose

Prerequisites:

- Docker
- Docker Compose

From the project root:

```bash
docker compose up --build -d
```

This starts:

- MongoDB
- FastAPI backend on port `8000`
- Frontend on port `80`

Default compose behavior in this repository:

- frontend: [docker-compose.yml](d:/Dev/Ziw/new_cdx_gpt_5.4/docker-compose.yml)
- backend build: [backend/Dockerfile](d:/Dev/Ziw/new_cdx_gpt_5.4/backend/Dockerfile)
- frontend build: [frontend/Dockerfile](d:/Dev/Ziw/new_cdx_gpt_5.4/frontend/Dockerfile)

Important environment setup:

- create or update [backend/.env](d:/Dev/Ziw/new_cdx_gpt_5.4/backend/.env)
- make sure it contains at least:

```env
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=change-me
ADMIN_NAME=Admin
OPENAI_API_KEY=your-key-if-needed
DEEPSEEK_API_KEY=your-key-if-needed
```

Then open:

- Frontend: [http://localhost](http://localhost)
- Backend API: [http://localhost:8000](http://localhost:8000)

## 2. Run with Commands

### Backend

Prerequisites:

- Python 3.12 recommended
- MongoDB running locally or reachable remotely

Install backend dependencies:

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

Set required environment variables in .env:

```powershell
ADMIN_EMAIL="admin@example.com"
ADMIN_PASSWORD="change-me"
ADMIN_NAME="Admin"
```

Run the backend:

```bash
uvicorn server:app --host 0.0.0.0 --port 8000 --reload
```

### Frontend

Prerequisites:

- Node.js 22 recommended
- npm

Install frontend dependencies:

```bash
cd frontend
npm install
```

Run the frontend in development:

```bash
npm run dev
```

Default local frontend URL:

- [http://localhost:5173](http://localhost:5173)

## Notes

- The backend auto-creates the first admin user if no admin exists and the admin bootstrap environment variables are set.
- On first login, that admin is forced to change password.
- Some scrapers depend on external services or AI APIs; if those keys are missing, related enrichment features may be skipped.
