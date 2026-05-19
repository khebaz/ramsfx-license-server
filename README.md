# Rams FX — License Server

## Quick Start

```bash
npm install
npm start
```

Server runs on `http://localhost:3000`

## URLs

| Page | URL |
|------|-----|
| Store (buy bots) | `http://localhost:3000/` |
| Admin dashboard | `http://localhost:3000/admin` |
| License check API | `http://localhost:3000/api/check-license?key=RFB-XXXX&account=1234` |

## Default Admin Login

```
Username: admin
Password: admin123
```

## PayPal

Your live PayPal credentials are already configured in `.env`. For production:
1. Verify credentials work with a test payment
2. Set env vars on your production server instead of .env file

## API Endpoints

### Public
- `GET /api/products` — List active products
- `POST /api/validate` — Check license key validity
- `POST /api/create-paypal-order` — Create PayPal order
- `POST /api/capture-paypal-order` — Capture payment + generate license
- `GET /api/check-license` — EA startup validation

### Admin (requires Bearer token from login)
- `POST /api/admin/login` — Get JWT token
- `GET /api/admin/stats` — Dashboard metrics
- `GET|POST /api/admin/products` — Product CRUD
- `GET|POST /api/admin/files/upload` — File management
- `GET|POST /api/admin/licenses` — License management
- `GET|POST /api/admin/orders/refund` — Order management

## Deploying to Production

1. Upload all files to Node.js hosting (Railway, Render, VPS, etc.)
2. Set environment variables: `JWT_SECRET`, `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`
3. Run `npm install && npm start`
4. Point your domain DNS to the server

## Files

| File | Purpose |
|------|---------|
| `server.js` | Backend (Express + SQLite) |
| `index.html` | Customer storefront |
| `admin.html` | Admin dashboard |
| `uploads/` | Uploaded EA files |
| `ramsfx.db` | SQLite database (auto-created) |
| `.env` | Environment config |
