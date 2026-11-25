#!/bin/bash
# GEditor one-click setup for Mac. Double-click this file (first time: right-click, Open).
cd "$(dirname "$0")"
if command -v python3 >/dev/null 2>&1; then
  python3 setup.py "$@"
else
  echo "Python 3 is not installed. Opening the download page."
  echo "Install it, then double-click this file again."
  open https://www.python.org/downloads/
fi
echo
read -n 1 -s -r -p "Press any key to close"
