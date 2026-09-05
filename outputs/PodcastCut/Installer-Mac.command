#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/Documents/PodcastCut/AI"
PYTHON="${PYTHON:-python3}"
if ! command -v "$PYTHON" >/dev/null 2>&1; then
  echo "Python 3 est requis. Installez-le depuis python.org puis relancez ce fichier."
  read -r
  exit 1
fi
mkdir -p "$DEST"
"$PYTHON" -m venv "$DEST/runtime"
"$DEST/runtime/bin/python" -m pip install --disable-pip-version-check -r "$SCRIPT_DIR/ai/requirements.txt"
"$DEST/runtime/bin/python" "$SCRIPT_DIR/ai/download_models.py" "$DEST/models"
echo "Podcast Cut est prêt sur macOS. Redémarrez Premiere Pro."
read -r
