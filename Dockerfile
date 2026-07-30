# ===== STAGE 1: Build Frontend UI =====
FROM node:22-alpine AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ===== STAGE 2: Production App =====
FROM node:22-alpine
WORKDIR /app

# Install compilation tools for native SQLite module
RUN apk add --no-cache python3 make g++

# Install production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled frontend build assets
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Copy application source files
COPY . .

EXPOSE 1784
CMD ["node", "index.js"]
