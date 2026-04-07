# Keuanganku

Keuanganku is a self-hostable personal expense tracker with support for daily expenses, recurring expenses, transfers, monthly summaries, and Supabase authentication.

> <div align="center">
  <table>
    <tr>
      <td valign="top" rowspan="2">
        <img src="https://github.com/user-attachments/assets/e6adfd1b-2270-4bf9-a941-f8a09f2c2d15" width="275" />
      </td>
      <td valign="top">
        <img src="https://github.com/user-attachments/assets/7aeaccae-d9d9-4566-8341-0638c2971198" width="600" />
      </td>
    </tr>
    <tr>
      <td valign="top">
        <img src="https://github.com/user-attachments/assets/d3f1a8e4-3a95-4912-b907-24d8941eca3f" width="600" />
      </td>
    </tr>
  </table>
</div>


## Live Demo

Try the public demo here:

- [https://toastyy00.github.io/keuanganku/](https://toastyy00.github.io/keuanganku/)

Notes:

- The demo runs in a safe public mode
- No login is required
- It uses local demo data only
- It does not connect to your production Supabase project


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

More deployment examples are in [DEPLOYMENT.md](https://github.com/toastyy00/keuanganku/blob/main/DEPLOYMENT.md).

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

This repository includes a GitHub Actions workflow that automatically publishes the Docker image when you push to `main`.

### What the workflow does

- Builds a multi-arch image for `linux/amd64` and `linux/arm64`
- Pushes the image to Docker Hub
- Publishes:
  - `toastty/keuanganku:latest`
  - a commit-based tag from the workflow

### Required GitHub secrets

You must add these two repository secrets in GitHub:

- `DOCKERHUB_USERNAME`
- `DOCKERHUB_TOKEN`

`DOCKERHUB_USERNAME` should be your Docker Hub username.

`DOCKERHUB_TOKEN` should be a Docker Hub access token, not your Docker Hub password.

### How to add the secrets

1. Open the GitHub repository.
2. Go to `Settings`.
3. Open `Secrets and variables` > `Actions`.
4. Click `New repository secret`.
5. Add `DOCKERHUB_USERNAME` with your Docker Hub username.
6. Add `DOCKERHUB_TOKEN` with a Docker Hub access token.

After the secrets are added, every push to `main` will trigger the publish workflow automatically.
