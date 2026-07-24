# Vercel + Railway Integration Guide

The Vercel frontend is static. During Vercel deploy, `npm run build` writes `public/config.js` from one of these environment variables:

```env
ASJ_ATS_API_BASE_URL=https://your-railway-public-domain.up.railway.app
# or
NEXT_PUBLIC_API_URL=https://your-railway-public-domain.up.railway.app
# or
REACT_APP_API_URL=https://your-railway-public-domain.up.railway.app
```

Railway must allow the Vercel origin:

```env
CORS_ORIGIN=https://asj-ats-beta-222.vercel.app
NODE_ENV=production
COOKIE_SAMESITE=none
```

Verify after deploy:

```bash
curl https://your-railway-public-domain.up.railway.app/api/health
```

If Vercel shows “We couldn't reach the server,” the static `public/config.js` in the deployed site is still empty or points to the wrong Railway domain. Set `ASJ_ATS_API_BASE_URL` in Vercel and redeploy.
