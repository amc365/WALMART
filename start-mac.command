#!/bin/bash
# Double-click this file on a Mac to start monitoring.
cd "$(dirname "$0")" || exit 1

echo "Walmart Seller Center monitor"
echo "-----------------------------"

# macOS can run this file from inside the .zip, leaving the rest of the program
# behind. Catch that before it turns into a stack trace.
if [ ! -f "$(dirname "$0")/monitor/run.js" ]; then
  echo
  echo "THE ZIP WAS NOT UNPACKED."
  echo "This file is running on its own, without the rest of the program."
  echo "Double-click the .zip first, then run start-mac.command from the folder it makes."
  echo
  read -r -p "Press Return to close."
  exit 1
fi

if ! command -v node > /dev/null 2>&1; then
  echo
  echo "Node.js is not installed on this Mac."
  echo "Install it from https://nodejs.org (pick the LTS button), then"
  echo "double-click this file again."
  echo
  read -r -p "Press Return to close."
  exit 1
fi

LOG="$(pwd)/setup-log.txt"
echo "Setting up (first time takes a few minutes)..."
echo "--- npm install ---" > "$LOG"
npm install >> "$LOG" 2>&1 || {
  echo "SETUP FAILED. The reason is at the bottom of $LOG"
  echo "Open that file, copy the last few lines, and send them over."
  read -r -p "Press Return to close."
  exit 1
}

# A large download that slow or filtered connections often kill. Not fatal: an
# installed Chrome is used instead when this does not finish.
echo "Downloading a browser (optional — Chrome is used if this fails)..."
npx --yes playwright install chromium >> "$LOG" 2>&1 || echo "   Download did not finish — your Chrome will be used instead. That is fine."

echo
echo "Starting. If a browser window opens, sign in to Seller Center —"
echo "that happens once, then it remembers you."
echo "Leave this window open. Press Control-C to stop."
echo

# --headed shows the browser doing the work. Delete it to hide the window.
node monitor/run.js --hours=8 --headed

echo
read -r -p "Finished. Press Return to close."
