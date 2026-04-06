# Keuanganku

Keuanganku is a self-hostable personal expense tracker for logging daily spending, recurring expenses, transfers, and monthly trends.

> Screenshot placeholder: add a current application screenshot here before publishing.

## What The App Is

- Track expenses by category and type: `NEED`, `WANT`, and `TRANSFER`
- Review monthly totals, trend comparisons, and needs-vs-wants spending
- Manage recurring expense templates
- Filter expense history by month, category, type, and keyword
- Use Supabase auth with a manual admin approval step
- Fall back to local storage when a cloud session is unavailable

## Tech Stack

- React 19
- TypeScript
- Vite
- Tailwind CSS
- Zustand
- React Router
- Supabase
- `vite-plugin-pwa`

## Self-Host Instructions

### Requirements

- Node.js 18+
- npm
- A Supabase project
- Docker and Docker Compose for container deployment

### Setup

```bash
npm install
cp .env.example .env
```

Add your own Supabase values to `.env`:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

If you want `docker compose up -d` to pull your published image without editing the compose file, set:

```env
IMAGE_NAME=toastty/keuanganku:latest
```

Apply the schema from `supabase/migrations/001_init.sql`, then start the app:

```bash
npm run dev
```

For Docker deployment:

```bash
docker compose up -d
```

Additional setup notes are in `README-selfhost.md`.

## GitHub Actions Secrets

Add these repository secrets in GitHub before pushing to `main`:

- `DOCKERHUB_USERNAME`: your Docker Hub username
- `DOCKERHUB_TOKEN`: a Docker Hub access token with push permission

GitHub steps:

1. Open your repository on GitHub.
2. Go to `Settings` > `Secrets and variables` > `Actions`.
3. Click `New repository secret`.
4. Add `DOCKERHUB_USERNAME`.
5. Add `DOCKERHUB_TOKEN`.

After that, every push to `main` will build and push a multi-arch image for `linux/amd64` and `linux/arm64`.
