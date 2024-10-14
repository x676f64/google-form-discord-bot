# Use Node.js v16 as the base image
FROM node:16-alpine AS build

# Install pnpm
RUN npm install -g pnpm

# Set the working directory
WORKDIR /app

# Copy package.json and pnpm-lock.yaml (if you have one)
COPY package.json pnpm-lock.yaml* ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy the rest of the application code
COPY . .

# Build stage (if you have a build step, uncomment the following line)
# RUN pnpm run build

# Create the production image
FROM node:22-alpine

# Install pnpm
RUN npm install -g pnpm

# Set the working directory
WORKDIR /app

# Copy package.json and pnpm-lock.yaml
COPY package.json pnpm-lock.yaml* ./

# Copy the built application from the build stage
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/src ./src

# Copy the .env file (make sure to add this to .dockerignore if you don't want it in the image)
COPY .env ./

# Create a directory for the Google Cloud credentials
RUN mkdir -p /app/credentials

# Set the environment variable for the Google Cloud credentials
ENV GOOGLE_APPLICATION_CREDENTIALS=/app/credentials/credentials.json

# Expose the port the app runs on (if applicable)
# EXPOSE 3000

# Start the bot
CMD ["pnpm", "start"]