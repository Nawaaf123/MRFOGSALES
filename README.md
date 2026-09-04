# Concept Foundry (Production)

New production app for MR FOG Sales Manager.

- **Frontend:** React + Vite + shadcn (UI ported from Lovable)
- **API:** FastAPI
- **DB:** PostgreSQL
- **Lovable app:** untouched — this is a separate project

## Project layout

```
concept-foundry/
  frontend/     # React SPA
  backend/      # FastAPI API
  docker-compose.yml
```

## Quick start (local)

### 1. Start Postgres

```bash
docker compose up -d db
```

### 2. Start API

```bash
cd backend
python -m venv .venv
# Windows:
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload --port 8000
```

API docs: http://localhost:8000/docs  
Health: http://localhost:8000/health

Default admin (from `.env`):
- Email: `admin@example.com`
- Password: `ChangeMe123!`

### 3. Start frontend

```bash
cd frontend
npm install
npm run dev
```

App: http://localhost:8080

## What works now

- JWT auth (signup/login/me)
- Dashboard stats (SQL aggregates on the API)
- Products CRUD (list/create)
- Shops CRUD (list/create)
- Invoices / Orders / Users list endpoints
- Same navigation shell and branding as the Lovable UI

## Still to port (exact Lovable feature parity)

- Full invoice composer, payments, credits, PDF/Excel
- Bulk uploads
- Mapbox sales locations
- Deep analytics / sales performance charts
- All advanced dialogs from the original components

Original UI components remain under `frontend/src/components/*` for porting.

## AWS deploy (target)

| Piece | Service |
|---|---|
| Frontend | S3 + CloudFront |
| API | App Runner (Docker) |
| Database | RDS PostgreSQL |
| Secrets | Secrets Manager |

## Important

This repo does **not** modify https://github.com/Nawaaf123/concept-foundry (Lovable). Keep that running until you cut over.
