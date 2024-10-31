# Makefile for Google Forms to Discord Bot

# Variables
NODE_ENV ?= development
SERVICE_NAME = google-forms-discord-bot
SERVICE_FILE = /etc/systemd/system/$(SERVICE_NAME).service
NODE_VERSION = 20.11.1
NVM_DIR = $(HOME)/.nvm
NVM_SCRIPT = $(NVM_DIR)/nvm.sh

# Detect the available package manager
PACKAGE_MANAGER := $(shell \
    if command -v pnpm >/dev/null 2>&1; then \
        echo "pnpm"; \
    elif command -v bun >/dev/null 2>&1; then \
        echo "bun"; \
    elif command -v yarn >/dev/null 2>&1; then \
        echo "yarn"; \
    elif command -v npm >/dev/null 2>&1; then \
        echo "npm"; \
    else \
        echo "No supported package manager found"; \
        exit 1; \
    fi \
)

# Define commands based on the detected package manager
ifeq ($(PACKAGE_MANAGER),pnpm)
    INSTALL_CMD := pnpm install
    RUN_CMD := pnpm run
else ifeq ($(PACKAGE_MANAGER),bun)
    INSTALL_CMD := bun install
    RUN_CMD := bun run
else ifeq ($(PACKAGE_MANAGER),yarn)
    INSTALL_CMD := yarn
    RUN_CMD := yarn
else ifeq ($(PACKAGE_MANAGER),npm)
    INSTALL_CMD := npm install
    RUN_CMD := npm run
endif

# Function to create service file
define create_service_file
	@echo "Creating service file..."
	@sudo bash -c 'cat > $(SERVICE_FILE) << EOF
[Unit]
Description=Google Forms to Discord Bot
After=network.target

[Service]
Environment=NODE_VERSION=$(NODE_VERSION)
Environment=NODE_ENV=$(NODE_ENV)
WorkingDirectory=$(shell pwd)
ExecStart=$(NVM_DIR)/nvm-exec $(RUN_CMD) start
Restart=always
User=$(shell whoami)

[Install]
WantedBy=multi-user.target
EOF'
endef

# PHONY targets
.PHONY: all install start dev lint format clean setup install-service remove-service install-nvm ensure-nvm help

# Default target
all: install start

# Install dependencies
install: ensure-nvm
	@echo "Installing dependencies using $(PACKAGE_MANAGER)..."
	@. $(NVM_SCRIPT) && nvm use $(NODE_VERSION) && $(INSTALL_CMD)

# Start the bot
start: ensure-nvm
	@. $(NVM_SCRIPT) && nvm use $(NODE_VERSION) && NODE_ENV=$(NODE_ENV) $(RUN_CMD) start

# Run in development mode
dev: ensure-nvm
	@. $(NVM_SCRIPT) && nvm use $(NODE_VERSION) && NODE_ENV=development $(RUN_CMD) dev

# Lint the code
lint: ensure-nvm
	@. $(NVM_SCRIPT) && nvm use $(NODE_VERSION) && $(RUN_CMD) lint

# Lint and fix the code
format: ensure-nvm
	@. $(NVM_SCRIPT) && nvm use $(NODE_VERSION) && $(RUN_CMD) lint --fix

# Clean up
clean:
	rm -rf node_modules
	rm -f npm-debug.log pnpm-debug.log yarn-error.log
	rm -f responses.json error.log combined.log

# Setup environment
setup:
	cp .env.example .env
	@echo "Please edit .env file with your configuration"

# Install nvm
install-nvm:
	@echo "Installing nvm..."
	@curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.3/install.sh | bash
	@echo "Please restart your terminal or run 'source ~/.bashrc' to use nvm"

# Ensure nvm is installed and the correct Node version is used
ensure-nvm:
	@if [ ! -f "$(NVM_SCRIPT)" ]; then \
		echo "nvm is not installed. Please run 'make install-nvm' first."; \
		exit 1; \
	fi
	@. $(NVM_SCRIPT) && nvm install $(NODE_VERSION)

# Install the service
install-service: install
	@echo "Installing service..."
	@chmod +x install_service.sh
	@./install_service.sh


# Remove the service
remove-service:
	@echo "Stopping service..."
	@sudo systemctl stop $(SERVICE_NAME) || true
	@echo "Disabling service..."
	@sudo systemctl disable $(SERVICE_NAME) || true
	@echo "Removing service file..."
	@sudo rm -f $(SERVICE_FILE)
	@echo "Reloading systemd..."
	@sudo systemctl daemon-reload
	@echo "Service removed."


help: ## Show this help message
	@echo "Google Forms to Discord Bot Makefile Commands:"
	@echo
	@echo "Usage: make [target]"
	@echo
	@echo "Targets:"
	@echo "  all                  Install dependencies and start the bot"
	@echo "  clean               Remove build artifacts, logs, and node_modules"
	@echo "  dev                 Run the bot in development mode"
	@echo "  ensure-nvm          Verify nvm is installed and set correct Node version"
	@echo "  format              Automatically fix code style issues"
	@echo "  help                Show this help message"
	@echo "  install             Install project dependencies using detected package manager"
	@echo "  install-nvm         Install Node Version Manager (nvm)"
	@echo "  install-service     Install and enable systemd service"
	@echo "  lint                Check code for style issues"
	@echo "  remove-service      Stop and remove systemd service"
	@echo "  setup               Create initial configuration from template"
	@echo "  start               Start the bot in production mode"
	@echo
	@echo "Environment Variables:"
	@echo "  NODE_ENV         Development environment (default: development)"
	@echo "  SERVICE_NAME     Name of the systemd service (default: google-forms-discord-bot)"
	@echo "  NODE_VERSION     Node.js version to use (default: 20.11.1)"