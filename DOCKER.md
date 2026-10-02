# Running MilkOS with Docker

Three containers: `db` (Postgres 17), `backend` (FastAPI, port 8000), `frontend` (Next.js, port 3000).
The frontend proxies `/api/v1/*` to the backend, so the browser only talks to `http://localhost:3000`.

## First run

```bash
cp .env.example .env                    # Supabase values for the web app
cp backend/.env.example backend/.env    # SECRET_KEY, SUPERADMIN_PASSWORD, ...
# edit both files, then:
docker compose up -d --build
docker compose ps                       # all three should become healthy
```

Open http://localhost:3000 and log in with `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD`.

The backend container applies database migrations and creates the superadmin on every start
(both are safe to repeat). If `SECRET_KEY` is missing, or `SUPERADMIN_PASSWORD` is missing on a
fresh database, the backend stops with a clear error instead of starting half-configured.

## Things to know

- `NEXT_PUBLIC_*` values are baked into the frontend at build time. After changing them in `.env`,
  run `docker compose build frontend`.
- `POSTGRES_PASSWORD` only takes effect when the database volume is first created. To change it later,
  either change the password inside Postgres or reset the volume (`docker compose down -v`, which deletes all data).
- Google login: register `http://localhost:3000/api/v1/auth/google/callback` (your `APP_URL` plus
  `/api/v1/auth/google/callback`) as an authorized redirect URI in Google Cloud Console.
- Deploying anywhere other than localhost: set `APP_URL` and `CORS_ORIGINS` in `backend/.env`, and
  build the frontend with the real public URL for `NEXT_PUBLIC_API_URL`. Session cookies are currently
  set with `secure=False`; switch that on once the site is served over HTTPS.
- Run only one backend replica for now: migrations run at container start and two replicas starting
  together can race.

## Checks

```bash
docker compose ps
docker compose exec frontend whoami                    # node (not root)
docker compose exec backend whoami                     # app (not root)
docker compose exec backend pytest                     # backend tests (SQLite, no effect on the real database)
curl -i -X POST http://localhost:3000/api/v1/auth/login -H 'content-type: application/json' -d '{}'
                                                       # 422 JSON from FastAPI = the proxy works (a Next 404 page would mean it doesn't)
```

Reset everything, including data: `docker compose down -v`.
