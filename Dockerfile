FROM node:22-slim

WORKDIR /app

# Install root dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Build dashboard (fresh install for Linux native bindings)
COPY dashboard/package.json dashboard/
RUN cd dashboard && npm install
COPY dashboard/ dashboard/
RUN cd dashboard && npx vite build

# Copy server source
COPY . .

EXPOSE 6745

CMD ["npm", "run", "start"]
