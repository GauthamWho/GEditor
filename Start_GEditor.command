#!/bin/bash
# Start GEditor: opens the editor in your browser. Other devices on your Wi-Fi use the link shown in the Share button.
cd "$(dirname "$0")"
if [ ! -x ".venv/bin/python" ]; then
  echo "GEditor is not set up yet. Double-click setup_mac.command first."
  read -n 1 -s -r -p "Press any key to close"; exit 1
fi
echo "GEditor is running. Close this window to stop it."
.venv/bin/python -u server.py --last
