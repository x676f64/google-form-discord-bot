# Makefile for Google Forms to Discord Bot

# Variables
NODE_ENV ?= development
SERVICE_NAME = google-forms-discord-bot
SERVICE_FILE = /etc/systemd/system/$(SERVICE_NAME).service
STARTUP_SCRIPT = $(HOME)/start-$(SERVICE_NAME).sh
NODE_VERSION = 20.11.1

# PHONY targets
.PHONY: all install start dev lint format clean setup install-service remove-service create-startup-script ensure-node-version

# Default target
all: install start

# Install dependencies
install:
	pnpm install

# Start the bot
start:
	NODE_ENV=$(NODE_ENV) pnpm start

# Run in development mode
dev:
	NODE_ENV=development pnpm run dev

# Lint the code
lint:
	pnpm run lint

# Lint and fix the code
format:
	pnpm run lint --fix

# Clean up
clean:
	rm -rf node_modules
	rm -f npm-debug.log pnpm-debug.log yarn-error.log
	rm -f responses.json error.log combined.log

# Setup environment
setup:
	cp .env.example .env
	@echo "Please edit .env file with your configuration"

# Create startup script
create-startup-script: ensure-node-version
	@echo "Creating startup script..."
	@tee $(STARTUP_SCRIPT) > /dev/null <<EOF
	#!/bin/bash
	export NVM_DIR="$(HOME)/.nvm"
	[ -s "$$NVM_DIR/nvm.sh" ] && \. "$$NVM_DIR/nvm.sh"  # This loads nvm

	# Use the correct Node version
	nvm use $(NODE_VERSION) || { echo "Failed to switch to Node $(NODE_VERSION)"; exit 1; }

	# Navigate to your project directory
	cd $(shell pwd)

	# Start your Node.js application
	exec pnpm start
	EOF
	@chmod +x $(STARTUP_SCRIPT)

# Install the service
install-service: install create-startup-script
	@echo "Creating service file..."
	@sudo tee $(SERVICE_FILE) > /dev/null <<EOF
	[Unit]
	Description=Google Forms to Discord Bot
	After=network.target

	[Service]
	ExecStart=$(STARTUP_SCRIPT)
	Restart=always
	User=$(shell whoami)
	Environment=NODE_ENV=$(NODE_ENV)
	WorkingDirectory=$(shell pwd)

	[Install]
	WantedBy=multi-user.target
	EOF
	@echo "Reloading systemd..."
	@sudo systemctl daemon-reload
	@echo "Enabling service..."
	@sudo systemctl enable $(SERVICE_NAME)
	@echo "Starting service..."
	@sudo systemctl start $(SERVICE_NAME)
	@echo "Service installed and started."

# Remove the service
remove-service:
	@echo "Stopping service..."
	@sudo systemctl stop $(SERVICE_NAME) || true
	@echo "Disabling service..."
	@sudo systemctl disable $(SERVICE_NAME) || true
	@echo "Removing service file..."
	@sudo rm -f $(SERVICE_FILE)
	@echo "Removing startup script..."
	@rm -f $(STARTUP_SCRIPT)
	@echo "Reloading systemd..."
	@sudo systemctl daemon-reload
	@echo "Service removed."