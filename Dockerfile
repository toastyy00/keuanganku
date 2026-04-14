FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY . .

RUN npm run build

FROM nginx:alpine AS runner
# Copy built assets
COPY --from=builder /app/dist /usr/share/nginx/html
# Copy nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf
# Copy entrypoint for runtime env injection
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
EXPOSE 7432
ENTRYPOINT ["/docker-entrypoint.sh"]
