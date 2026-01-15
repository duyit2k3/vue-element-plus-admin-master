# Build stage
FROM node:18-alpine AS build
ENV NODE_OPTIONS=--max_old_space_size=4096
WORKDIR /app

COPY package.json ./

# Cài pnpm đúng version mà project yêu cầu và cài dependency bằng pnpm
RUN npm install -g pnpm@9.15.3 \
  && pnpm install

COPY . .
# Build production (có thể đổi sang build:dev / build:test tuỳ môi trường bạn muốn)
RUN pnpm run build:pro

# Runtime: Nginx serve file tĩnh
FROM nginx:alpine
COPY --from=build /app/dist-pro /usr/share/nginx/html

# Nếu dùng history mode, có thể cần config nginx riêng (optional)
# COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80