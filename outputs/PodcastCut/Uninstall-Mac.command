#!/bin/bash
set -euo pipefail
rm -rf "$HOME/Library/Application Support/Adobe/CEP/extensions/fr.podcastcut.panel"
rm -rf "$HOME/Library/Application Support/PodcastCut"
echo "Podcast Cut désinstallé. Les projets Premiere et les médias sont conservés."
read -r
