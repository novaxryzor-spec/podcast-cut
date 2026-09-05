# Validation — 5 septembre 2026

- 16 tests automatiques réussis avec Node : PCM 16/24/32 bits, float 32, canaux en opposition de phase, alternance, plan large, durée minimale, suppressions synchronisées, grandes marges, rejet des fichiers tronqués et durées incompatibles, validation des réglages, XML échappé, identifiants uniques, NTSC et parcours WAV → montage → XML.
- XML généré lu avec le parseur XML .NET ; séquence synthétique de 186 images après réduction d’une source de 250 images.
- Syntaxe JavaScript du moteur et du panneau vérifiée ; manifeste XML et script PowerShell d’installation analysés sans erreur.
- Interface affichée dans le navigateur : contrôle visuel, ajout/retrait d’un intervenant, sauvegarde/rappel des réglages. Aucune erreur console observée.
- 13 tests du mode timeline réussis : plages décalées, trous et audio accéléré refusés, piste imbriquée, plan large, conservation de l’audio, duplication, activation des angles, rotation de plusieurs caméras par intervenant, retour à l’original après erreur et blocage si la timeline change.
- 8 tests du mode audio mixé réussis. Une diarisation réelle du fichier public à quatre voix de sherpa-onnx a bien trouvé quatre voix avec le moteur installé.
- Extension 0.3.4 et moteur IA installés sur le poste. **Premiere était ouvert avec un projet modifié : il n’a pas été redémarré et le clic de montage réel reste à confirmer après sauvegarde et redémarrage.** Les mutations Premiere ont été testées avec un simulateur de l’API ExtendScript/QE.
- Détection évaluée sur signaux synthétiques, pas sur une conversation réelle ni sur des micros avec repisse. La qualité éditoriale et les performances sur plusieurs heures restent à mesurer.

Le plugin crée lui-même une copie de la séquence, mais cette bêta doit rester utilisée avec des sauvegardes de projet régulières.
