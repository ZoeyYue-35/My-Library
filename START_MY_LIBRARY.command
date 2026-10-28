#!/bin/zsh
# Starts the clean My Library release on a port separate from an older local copy.
set -e
cd "$(dirname "$0")"

echo "Preparing My Library…"
python3 -m pip install -r requirements.txt
echo ""
echo "My Library will be available at http://127.0.0.1:8011"
echo "Keep this Terminal window open while using the app."
MY_LIBRARY_PORT=8011 python3 server.py
