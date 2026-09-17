#!/bin/bash
# Double-click this file on a Mac to start monitoring.
cd "$(dirname "$0")" || exit 1

echo "Walmart Seller Center monitor"
echo "-----------------------------"

if ! command -v node > /dev/null 2>&1; then
  echo
  echo "Node.js is not installed on this Mac."
  echo "Install it from https://nodejs.org (pick the LTS button), then"
  echo "double-click this file again."
  echo
  read -r -p "Press Return to close."
  exit 1
fi

echo "Setting up (first time takes a few minutes)..."
npm install --silent || { echo "Setup failed."; read -r -p "Press Return to close."; exit 1; }
npx --yes playwright install chromium || { echo "Browser download failed."; read -r -p "Press Return to close."; exit 1; }

echo
echo "Starting. If a browser window opens, sign in to Seller Center —"
echo "that happens once, then it remembers you."
echo "Leave this window open. Press Control-C to stop."
echo

node monitor/run.js --hours=8

echo
read -r -p "Finished. Press Return to close."
