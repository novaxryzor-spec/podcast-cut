#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/Documents/PodcastCut/AI"
CEP_DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/fr.podcastcut.panel"
PYTHON="${PYTHON:-python3}"
if ! command -v "$PYTHON" >/dev/null 2>&1; then
  echo "Python 3 est requis. Installez-le depuis python.org puis relancez ce fichier."
  read -r
  exit 1
fi
mkdir -p "$CEP_DEST"
if [ "$SCRIPT_DIR" != "$CEP_DEST" ]; then
  cp -R "$SCRIPT_DIR"/. "$CEP_DEST"/
fi
# Allow this unsigned development build to load in Premiere Pro CEP 12.
defaults write com.adobe.CSXS.12 PlayerDebugMode 1 >/dev/null 2>&1 || true
mkdir -p "$DEST"
"$PYTHON" -m venv "$DEST/runtime"
"$DEST/runtime/bin/python" -m pip install --disable-pip-version-check -r "$SCRIPT_DIR/ai/requirements.txt"
"$DEST/runtime/bin/python" "$SCRIPT_DIR/ai/download_models.py" "$DEST/models"
echo "Podcast Cut est prêt sur macOS. Redémarrez Premiere Pro."
read -r
