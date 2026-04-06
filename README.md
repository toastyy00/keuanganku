# Keuanganku

Keuanganku is a self-hostable personal expense tracker with support for daily expenses, recurring expenses, transfers, monthly summaries, and Supabase authentication.

> Screenshot placeholder: add a current application screenshot here before publishing.

## Features

- Expense tracking with `NEED`, `WANT`, and `TRANSFER`
- Recurring expense templates
- Monthly dashboard and spending trends
- Filterable transaction history
- Supabase auth with admin approval
- Docker-ready deployment

## Quick Start With Docker

This project is set up so users do not need to build the image locally.

### 1. Requirements

- Docker
- Docker Compose
- A Supabase project

### 2. Clone the repository

```bash
git clone https://github.com/toastyy00/keuanganku.git
cd keuanganku
```

### 3. Copy `.env.example` to `.env`

```bash
cp .env.example .env
```

Then edit `.env` beside `docker-compose.yml`:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
IMAGE_NAME=toastty/keuanganku:latest
```

Notes:

- `IMAGE_NAME` is optional because the compose file already defaults to `toastty/keuanganku:latest`
- `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are still required

### 4. Apply Supabase schema

Run the SQL from `supabase/migrations/001_init.sql` in your Supabase SQL editor.

### 5. Start the app

```bash
docker compose up -d
```

### 6. Open the app

- Local machine: `http://localhost:7432`
- Another device on the same network: `http://YOUR_SERVER_IP:7432`

More deployment examples are in `DEPLOYMENT.md`.

## Local Development

Use this if you want to run the app directly with Node instead of Docker.

### 1. Requirements

- Node.js 18+
- npm
- A Supabase project

### 2. Clone the repository

```bash
git clone https://github.com/toastyy00/keuanganku.git
cd keuanganku
```

### 3. Install dependencies

```bash
npm install
```

### 4. Copy `.env.example` to `.env`

```bash
cp .env.example .env
```

Then update the values:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### 5. Run the dev server

```bash
npm run dev
```

## Tech Stack

- React 19
- TypeScript
- Vite
- Tailwind CSS
- Zustand
- React Router
- Supabase
- `vite-plugin-pwa`

## For Maintainers

This repository includes a GitHub Actions workflow that builds and pushes a multi-arch Docker image to Docker Hub on every push to `main`.

### Required GitHub Actions secrets

- `DOCKERHUB_USERNAME`
- `DOCKERHUB_TOKEN`

### How to add them

1. Open the GitHub repository.
2. Go to `Settings`.
3. Open `Secrets and variables` > `Actions`.
4. Click `New repository secret`.
5. Add `DOCKERHUB_USERNAME` with your Docker Hub username.
6. Add `DOCKERHUB_TOKEN` with a Docker Hub access token.

After that, pushes to `main` will publish:

- `toastty/keuanganku:latest`
- a commit-based image tag from the workflow
