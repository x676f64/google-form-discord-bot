# Use Node.js v22 as the base image
FROM node:22-alpine AS build

# Install pnpm
RUN npm install -g pnpm

# Set the working directory
WORKDIR /app

# Copy package.json and pnpm-lock.yaml (if you have one)
COPY package.json pnpm-lock.yaml* ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy the source code
COPY src ./src

# Final stage
FROM node:22-alpine

# Install pnpm
RUN npm install -g pnpm

# Set the working directory
WORKDIR /app

# Copy package.json and pnpm-lock.yaml
COPY --from=build /app/package.json /app/pnpm-lock.yaml* ./

# Copy the built application from the build stage
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/src ./src

# Start the bot
CMD ["pnpm", "start"]