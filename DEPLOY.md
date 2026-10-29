# Deploying MilkOS: database on Supabase, API on Render, web app on Netlify

```
browser ──> Netlify (Next.js)  ──/api/v1/* proxied──>  Render (FastAPI)  ──>  Supabase Postgres
```

The browser only talks to the Netlify site. `netlify.toml` proxies `/api/v1/*` to Render, so the session
cookie stays first-party and no CORS setup is needed.

## 1. Supabase connection string

In Supabase: **Connect** (top bar) > **Session pooler**. Copy that string, not "Direct connection": the direct
host `db.<ref>.supabase.co` is IPv6-only and Render can't reach it. Then:

- keep the scheme `postgresql://` (never `postgresql+asyncpg://`: the backend is synchronous and asyncpg isn't installed),
- put your database password in place of `[YOUR-PASSWORD]` (URL-encode characters like `@`, `#`, `/`),
- add `?sslmode=require` at the end.

```
postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require
```

Use port 5432 (session mode). The transaction pooler (6543) can break migrations.

## 2. Render (API)

1. Push this repository to GitHub.
2. Render dashboard: **New > Blueprint**, pick the repository. Render reads `render.yaml` and creates `milkos-api`.
3. Fill in the values it asks for:
   - `DATABASE_URL`: the Supabase string from step 1.
   - `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD`: the first platform admin account. Use a strong password.
   - `APP_URL`: your Netlify URL, e.g. `https://milkos.netlify.app`. If you don't know it yet, enter a
     placeholder and change it after step 3.
   - `CORS_ORIGINS`: the same URL as `APP_URL`.
4. Wait for the deploy. Each start runs `alembic upgrade head` against Supabase (creating the tables on the
   first deploy), creates the superadmin if it's missing, then serves on Render's port. `https://<your-service>.onrender.com/api/v1/health` should return `{"status":"ok"}`.

Note the service URL. If it isn't `https://milkos-api.onrender.com` (Render adds a suffix when the name is
taken), put the real one in `netlify.toml`.

## 3. Netlify (web app)

1. Netlify dashboard: **Add new site > Import an existing project**, pick the repository.
2. Netlify reads `netlify.toml` (build `pnpm build`, Node 22) and detects Next.js. Keep the defaults.
3. Optional environment variable: `NEXT_PUBLIC_SCALE_SIMULATOR=1` offers the scale simulator in production.
   Leave it unset for real cooperatives.
4. Deploy, then set `APP_URL` and `CORS_ORIGINS` on Render to the final Netlify URL (or your custom domain).

## 4. After the first deploy

- Sign in at the Netlify URL with `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD`.
- Google sign-in: add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on Render and register
  `<APP_URL>/api/v1/auth/google/callback` as a redirect URI in Google Cloud Console.
- SMS, MFA key and delivery reports: add the variables from `backend/.env.example` on Render.

## Free plan limits

- Render's free web service sleeps after 15 idle minutes. The first request after that takes about a minute,
  and Netlify's proxy may give up first (the browser sees an error, and a retry then works). Use a paid
  instance for real use.
- Supabase pauses free projects after a week without activity. Restore it from the Supabase dashboard if the
  API starts failing to connect.
