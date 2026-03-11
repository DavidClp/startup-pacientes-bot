# Stage 1: Build
FROM node:20 AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN npx prisma generate

# Compila TypeScript e ajusta aliases
RUN npx tsc && npx tsc-alias

# Stage 2: Runtime
FROM node:20

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./

ENV NODE_ENV=production
ENV PORT=4050

EXPOSE 4050

CMD ["node", "build/index.js"]
