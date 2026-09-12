# Build stage
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Runtime stage
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY --from=build /app/knowledge ./knowledge

# Cloud Run injects PORT and expects the container to listen on it;
# src/config.ts already reads process.env.PORT.
EXPOSE 8080
CMD ["npm", "start"]
