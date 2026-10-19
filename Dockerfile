# LiveCraft 前端生产镜像（阶段五）
#
# 构建（后端公网地址在构建时注入，前端静态化需要）：
#   docker build \
#     --build-arg NEXT_PUBLIC_MEDIA_SERVICE_URL=https://api.example.com \
#     -t livecraft-web .
#
# 本地冒烟：
#   docker run -p 3000:3000 livecraft-web

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_MEDIA_SERVICE_URL=http://localhost:8000
ENV NEXT_PUBLIC_MEDIA_SERVICE_URL=${NEXT_PUBLIC_MEDIA_SERVICE_URL}
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
