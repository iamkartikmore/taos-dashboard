#!/bin/bash
set -e

echo "TAOS Elite Ops Dashboard — Setup"
echo "================================="

# Check for Node
if ! command -v node &>/dev/null; then
  echo "Node.js not found. Installing via nvm..."
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  nvm install --lts
  nvm use --lts
fi

echo "Node: $(node -v)"
echo "npm:  $(npm -v)"

echo ""
echo "Installing root dependencies..."
npm install

echo "Installing client dependencies..."
npm --prefix client install

echo ""
echo "Done! Run the dashboard with:"
echo "  npm run dev"
echo ""
echo "Then open: http://localhost:5173"
