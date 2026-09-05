#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/Documents/PodcastCut/AI"
CEP_DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/fr.podcastcut.panel"
PYTHON="${PYTHON:-python3}"
fail() { echo "Installation impossible : $1"; echo; read -r; exit 1; }
if ! command -v "$PYTHON" >/dev/null 2>&1; then
  fail "Python 3 est requis. Installez-le depuis python.org puis relancez ce fichier."
fi
mkdir -p "$CEP_DEST"
if [ "$SCRIPT_DIR" != "$CEP_DEST" ]; then
  cp -R "$SCRIPT_DIR"/. "$CEP_DEST"/
fi
# Allow this unsigned development build to load in Premiere Pro CEP 12.
defaults write com.adobe.CSXS.12 PlayerDebugMode 1 >/dev/null 2>&1 || true
mkdir -p "$DEST"
"$PYTHON" -m venv "$DEST/runtime" || fail "La création de l'environnement Python a échoué."
"$DEST/runtime/bin/python" -m pip install --disable-pip-version-check --upgrade pip || fail "L'installation de pip a échoué."
"$DEST/runtime/bin/python" -m pip install --disable-pip-version-check -r "$CEP_DEST/ai/requirements.txt" || fail "Les dépendances IA n'ont pas pu être installées. Vérifiez votre connexion internet."
"$DEST/runtime/bin/python" "$CEP_DEST/ai/download_models.py" "$DEST/models" || fail "Le téléchargement des modèles IA a échoué. Relancez ce fichier pour reprendre."
echo "Podcast Cut est prêt sur macOS. Redémarrez Premiere Pro."
read -r
