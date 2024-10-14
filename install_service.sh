#!/bin/bash

SERVICE_NAME="google-form-discord-bot"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
NODE_VERSION="20.11.1"
NVM_DIR="$HOME/.nvm"
WORK_DIR=$(pwd)

# Create the service file
cat << EOF | sudo tee $SERVICE_FILE > /dev/null
[Unit]
Description=Google Forms to Discord Bot
After=network.target

[Service]
Environment=NODE_VERSION=$NODE_VERSION
Environment=NODE_ENV=production
WorkingDirectory=$WORK_DIR
ExecStart=$NVM_DIR/nvm-exec npm run start
Restart=always
User=$(whoami)

[Install]
WantedBy=multi-user.target
EOF

# Reload systemd, enable and start the service
sudo systemctl daemon-reload
sudo systemctl enable $SERVICE_NAME
sudo systemctl start $SERVICE_NAME

echo "Service installed and started."
