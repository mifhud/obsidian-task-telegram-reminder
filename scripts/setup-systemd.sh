#!/bin/bash
#
# Setup script for Obsidian Telegram Reminder systemd service
# This script installs and enables the service to run as a background process
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="obsidian-reminder"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

echo -e "${GREEN}Obsidian Telegram Reminder - Systemd Setup${NC}"
echo ""

# Check if running as root for systemd installation
if [[ $EUID -ne 0 ]]; then
    echo -e "${YELLOW}Note: This script needs sudo privileges to install the systemd service.${NC}"
    echo ""
fi

# Determine the user to run the service as
if [[ -n "$SUDO_USER" ]]; then
    SERVICE_USER="$SUDO_USER"
else
    SERVICE_USER="$(whoami)"
fi

echo "Configuration:"
echo "  Install directory: ${SCRIPT_DIR}"
echo "  Service user: ${SERVICE_USER}"
echo ""

# Check if .env exists
if [[ ! -f "${SCRIPT_DIR}/.env" ]]; then
    echo -e "${RED}Error: .env file not found!${NC}"
    echo ""
    echo "Please create a .env file with the following variables:"
    echo "  TELEGRAM_BOT_TOKEN=your_bot_token"
    echo "  TELEGRAM_CHAT_ID=your_chat_id"
    echo "  VAULT_PATH=/path/to/your/obsidian/vault"
    echo ""
    echo "You can copy .env.example as a starting point:"
    echo "  cp ${SCRIPT_DIR}/.env.example ${SCRIPT_DIR}/.env"
    exit 1
fi

# Check if dist/index.js exists
if [[ ! -f "${SCRIPT_DIR}/dist/index.js" ]]; then
    echo -e "${YELLOW}Building the project...${NC}"
    cd "${SCRIPT_DIR}"
    npm run build
fi

# Create the service file from template
echo "Creating systemd service file..."
SERVICE_CONTENT=$(cat "${SCRIPT_DIR}/obsidian-reminder.service.template" \
    | sed "s|%USER%|${SERVICE_USER}|g" \
    | sed "s|%INSTALL_DIR%|${SCRIPT_DIR}|g")

# Write the service file (requires sudo)
if [[ $EUID -ne 0 ]]; then
    echo "$SERVICE_CONTENT" | sudo tee "$SERVICE_FILE" > /dev/null
    sudo chmod 644 "$SERVICE_FILE"
else
    echo "$SERVICE_CONTENT" > "$SERVICE_FILE"
    chmod 644 "$SERVICE_FILE"
fi

echo -e "${GREEN}Service file created at ${SERVICE_FILE}${NC}"

# Reload systemd
echo "Reloading systemd daemon..."
if [[ $EUID -ne 0 ]]; then
    sudo systemctl daemon-reload
else
    systemctl daemon-reload
fi

# Enable the service
echo "Enabling service to start on boot..."
if [[ $EUID -ne 0 ]]; then
    sudo systemctl enable "${SERVICE_NAME}"
else
    systemctl enable "${SERVICE_NAME}"
fi

echo ""
echo -e "${GREEN}Setup complete!${NC}"
echo ""
echo "Commands you can use:"
echo "  Start the service:   sudo systemctl start ${SERVICE_NAME}"
echo "  Stop the service:    sudo systemctl stop ${SERVICE_NAME}"
echo "  Restart the service: sudo systemctl restart ${SERVICE_NAME}"
echo "  Check status:        sudo systemctl status ${SERVICE_NAME}"
echo "  View logs:           sudo journalctl -u ${SERVICE_NAME} -f"
echo ""
echo "To start the service now, run:"
echo "  sudo systemctl start ${SERVICE_NAME}"
