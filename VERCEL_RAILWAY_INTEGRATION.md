# Vercel + Railway Integration Guide

This document describes how the Vercel frontend connects to the Railway backend.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│ Browser                                                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────────┐        ┌─────────────────────────┐   │
│  │  Vercel Frontend     │───────▶│  Railway Backend        │   │
│  │  (asj-ats-beta-     │ HTTP   │  (asj-ats-beta-222.up.  │   │
│  │  222.vercel.app)    │ API    │  railway.app)           │   │
│  │                      │        │                         │   │
│  │  - React/HTML/CSS    │        │  - Node.js + Express   │   │
│  │  - Client routing    │        │  - API endpoints       │   │
│  │  - Session mgmt      │        │  - Database (JSON/PG)  │   │
│  │                      │        │  - File storage        │   │
│  └──────────────────────┘        └─────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Frontend → Backend Communication

### 1. API Base URL Configuration

**In Vercel Environment Variables:**
```
NEXT_PUBLIC_API_URL=https://asj-ats-beta-222.up.railway.app
REACT_APP_API_URL=https://asj-ats-beta-222.up.railway.app
```

**Frontend code makes requests to:**
```javascript
const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:4200'
fetch(`${API_URL}/api/all`)
```

### 2. CORS Configuration

**Railway Backend** must allow requests from Vercel domain:

```
CORS_ORIGIN=https://asj-ats-beta-222.vercel.app
```

Backend sets headers:
```
Access-Control-Allow-Origin: https://asj-ats-beta-222.vercel.app
Access-Control-Allow-Credentials: true
```

### 3. Key API Endpoints

Frontend calls these endpoints on Railway backend:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/health` | GET | Health check |
| `/api/all` | GET | Load all data (candidates, jobs, etc) |
| `/api/dashboard` | GET | Dashboard metrics |
| `/api/candidates` | GET/POST | Candidate management |
| `/api/jobs` | GET/POST | Job management |
| `/api/applications` | GET/PATCH | Pipeline management |
| `/api/upload-resume` | POST | Resume upload |
| `/api/settings` | GET/PATCH | Settings management |
| `/auth/login` | POST | Authentication |
| `/auth/logout` | POST | Sign out |

## Session & Authentication

### Flow:
1. User logs in via `/auth/login` (credentials sent to Railway backend)
2. Backend returns JWT token in httpOnly cookie
3. Frontend automatically includes cookie in subsequent requests
4. Backend verifies token on every `/api/*` request
5. User stays authenticated across Vercel ↔ Railway

### Important:
- Cookies set with domain `.up.railway.app`
- CORS credentials enabled: `credentials: true`
- No token in localStorage (uses secure httpOnly cookies)

## Data Flow Examples

### Loading Candidates

```javascript
// Frontend (Vercel)
const response = await fetch(
  `${API_URL}/api/all`,
  { credentials: 'include' }  // Include auth cookie
)
const data = await response.json()
// data.candidates, data.jobs, data.applications, etc.
```

Railway backend responds with full ATS state filtered by user role.

### Uploading Resume

```javascript
// Frontend (Vercel)
const formData = new FormData()
formData.append('resume', file)
formData.append('jobId', jobId)

const response = await fetch(
  `${API_URL}/api/upload-resume`,
  {
    method: 'POST',
    body: formData,
    credentials: 'include'
  }
)
```

Railway backend saves to `/data/uploads/`, triggers async resume parsing.

### Creating Job

```javascript
// Frontend (Vercel)
const response = await fetch(
  `${API_URL}/api/jobs`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Backend Engineer',
      description: '...',
      skills: ['Node.js', 'Express', 'PostgreSQL']
    }),
    credentials: 'include'
  }
)
```

Railway backend creates job, runs matching against candidates, returns updated state.

## Testing the Integration

### 1. Local Testing

Terminal 1 (Railway backend simulation):
```bash
npm run dev  # Runs on http://localhost:4200
```

Terminal 2 (Test frontend calls):
```bash
curl -H "Origin: http://localhost:3000" \
  http://localhost:4200/api/health
```

### 2. Production Testing

After deploying to Railway and Vercel:

```bash
# Test backend is running
curl https://asj-ats-beta-222.up.railway.app/api/health

# Test CORS from Vercel domain
curl -H "Origin: https://asj-ats-beta-222.vercel.app" \
  https://asj-ats-beta-222.up.railway.app/api/health

# Monitor API calls
# Open Vercel project → Analytics → Logs
# Open Railway project → Logs → Backend service
```

## Troubleshooting

### Frontend can't reach backend (CORS error)

**Problem:** Browser console shows `CORS error` or `403 Forbidden`

**Solutions:**
1. Verify Railway URL in Vercel env variables:
   ```bash
   # In Vercel dashboard → Settings → Environment Variables
   # Check NEXT_PUBLIC_API_URL value matches Railway domain
   ```

2. Check Railway CORS_ORIGIN:
   ```bash
   # In Railway dashboard → Variables
   # Ensure CORS_ORIGIN includes Vercel domain exactly
   ```

3. Redeploy both services:
   ```bash
   # Push to main to trigger Railway redeploy
   # Redeploy Vercel project from dashboard
   ```

### 502 Bad Gateway from Railway

**Problem:** `502 Bad Gateway` when calling `/api/*`

**Solutions:**
1. Check Railway logs: Dashboard → Project → Service → Logs
2. Verify environment variables are set
3. Check volume is mounted: `RAILWAY_VOLUME_MOUNT_PATH=/data`
4. Restart service: Dashboard → Service → Restart

### Slow API responses

**Problem:** Frontend requests timeout or are very slow

**Solutions:**
1. Scale Railway instance: Dashboard → Service → Pricing plan
2. Check database load: Monitor `/data/db.json` size
3. Migrate to PostgreSQL for better performance
4. Add caching layer (Redis) if needed

### File uploads not persisting

**Problem:** Uploaded resumes disappear after restart

**Solutions:**
1. Verify volume created: Dashboard → Volumes → Check mount path
2. Check volume size: May need to increase if full
3. Monitor storage usage: `du -sh /data`

## Deployment Checklist

- [ ] Railway backend deployed
- [ ] Volume created at `/data` with 1GB+ space
- [ ] Environment variables configured on Railway
- [ ] Vercel environment variables updated with Railway URL
- [ ] Vercel redeployed
- [ ] Health check passing: `curl https://asj-ats-beta-222.up.railway.app/api/health`
- [ ] CORS test passing from Vercel domain
- [ ] Frontend can load data
- [ ] Resume upload works
- [ ] Monitor logs during first 24 hours

## Next Steps

1. **Scale for production:**
   - Migrate DB from JSON to PostgreSQL
   - Move file storage to S3 or Railway's object storage
   - Set up database backups

2. **Monitor & maintain:**
   - Set up Railway alerts for crashes
   - Monitor API performance
   - Review logs regularly

3. **Enhance:**
   - Add Redis caching layer
   - Implement API rate limiting at CDN level
   - Add analytics to track usage
