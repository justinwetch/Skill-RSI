#!/bin/bash
# Double-click this file to (re)start the Skill RSI server.
# Keep the window that opens — closing it stops the server.

cd "/Users/justinwetch/Documents/ClaudeCode/Skill RSI" || exit 1

# Make sure node is findable even when launched from Finder (minimal PATH).
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.nvm/versions/node/*/bin:$PATH"
for profile in "$HOME/.zprofile" "$HOME/.zshrc" "$HOME/.bash_profile" "$HOME/.profile"; do
  [ -f "$profile" ] && source "$profile" >/dev/null 2>&1
done

if ! command -v node >/dev/null 2>&1; then
  echo "Could not find 'node' on PATH. Open a terminal where 'node' works and run: node src/server.js"
  echo "Press any key to close."; read -n 1; exit 1
fi

echo "Stopping any running Skill RSI server..."
pkill -f "node src/server.js" 2>/dev/null
# also free port 8765 if something is holding it
PIDS=$(lsof -ti tcp:8765 2>/dev/null)
[ -n "$PIDS" ] && kill -9 $PIDS 2>/dev/null
sleep 1

echo "Starting Skill RSI server on http://127.0.0.1:8765"
echo "(Leave this window open. Press Ctrl+C or close it to stop.)"
echo "--------------------------------------------------------"
node src/server.js
