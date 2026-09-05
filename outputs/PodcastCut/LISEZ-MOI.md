# Podcast Cut — bêta 0.3

Extension originale pour **Premiere Pro 2026 sur Windows**, inspirée du principe de montage podcast automatisé. Le code est fourni et modifiable. Aucune dépendance à PremiereGPT. L'analyse reste locale ; seule la recherche de mises à jour utilise le réseau lorsqu'un serveur de publication est configuré.

## Installation

1. Double-cliquer sur **PodcastCut-Setup-x.y.z.exe**. Aucun droit administrateur n'est requis pour cette bêta.
2. Redémarrer Premiere Pro 2026.
3. Ouvrir **Fenêtre → Extensions → Podcast Cut** (le libellé peut inclure « héritées » selon la version).

L'installateur accepte une version déjà présente et la remplace. Il ajoute Podcast Cut à la liste de désinstallation de Windows et installe le vérificateur de mises à jour dans `%LOCALAPPDATA%\PodcastCut`. Une recherche discrète a lieu à la connexion Windows et à l'ouverture du panneau, au maximum toutes les six heures. Chaque mise à jour doit provenir du flux HTTPS configuré, porter une signature RSA valide et correspondre à l'empreinte SHA-256 annoncée.

Node est intégré au moteur CEP de Premiere. Pour le mode « un seul mix audio », lancez ensuite **Installer-IA.cmd** : il installe un environnement Python privé et les modèles dans `Documents\PodcastCut\AI`. Aucune clé API n’est nécessaire. Cette étape sera intégrée à l'installateur commercial final.

## Préparer les médias

- Préparer une vidéo continue par caméra, avec la **même cadence constante**, la même résolution et le même instant de départ. Utiliser des médias progressifs à pixels carrés.
- Exporter **un WAV par micro/intervenant**, avec exactement le même début et la même durée. PCM 16/24/32 bits et float 32 bits, RIFF, de 8 à 384 kHz. Mono recommandé. Les canaux stéréo sont conservés séparément dans le XML. RF64 et audio compressé non pris en charge.
- Les caméras doivent couvrir toute la durée des WAV. La version 0.1 ne vérifie pas la durée ni les métadonnées des vidéos : contrôler ce point avant import. Aucune synchronisation automatique ou compensation de décalage.
- Une seule voix par micro donne les meilleurs résultats. Un mix contenant toutes les voix ne permet pas d’identifier fiablement les intervenants.

## Monter

### Depuis la timeline Premiere

1. Dans une séquence de rushes, placer les caméras synchronisées sur des pistes vidéo séparées, par exemple V1 à V4. Chaque piste choisie doit couvrir toute la plage du mix, sans trou ni transition.
2. Placer le mix audio continu sur une piste dédiée, par exemple A1. Il peut être constitué de plusieurs clips consécutifs, sans chevauchement, à vitesse normale.
3. Ouvrir **Podcast Cut**, conserver **Timeline Premiere active**, puis cliquer sur **Lire la timeline active**.
4. Cocher les quatre pistes caméra, choisir la piste audio et éventuellement une piste de plan large distincte.
5. Indiquer le nombre de personnes, cliquer sur **Détecter les voix du mix**, écouter les extraits et associer chaque voix à sa piste vidéo.
6. Cliquer sur **Analyser et préparer les coupes**, puis sur **Monter la copie de la timeline**.

Le plugin duplique la séquence, coupe les pistes vidéo aux changements de caméra, désactive les angles non retenus et garde la piste du mix. La séquence originale reste intacte. Les autres pistes audio sont rendues muettes dans la copie. Si la timeline change après sa lecture, l’opération est bloquée jusqu’à une nouvelle lecture.

La suppression des silences n’est pas encore disponible dans le mode timeline : les positions du son, des effets et des caméras sont conservées.

### Depuis des fichiers

1. Ouvrir et enregistrer un projet Premiere, puis choisir **Fichiers synchronisés**.
2. Associer caméra et WAV pour chaque intervenant (1 à 6).
3. Ajouter éventuellement une caméra de plan large. Elle est choisie quand plusieurs micros dépassent le seuil.
4. Choisir la cadence et les dimensions exactes des caméras. Le montage commence à zéro ; le timecode intégré des rushes n’est pas utilisé.
5. Commencer avec le seuil **−35 dBFS**, une durée minimale de plan de **2,5 s** et une confirmation de **0,2 s**. Le gain individuel ne modifie que la sensibilité de détection.
6. Activer au besoin la suppression des silences. Une pause doit dépasser « Silence minimal » et deux fois la marge pour être retirée. Les marges conservent le début et la fin des paroles.
7. Cliquer sur **Analyser et préparer les coupes**, examiner la répartition des plans et le tableau.
8. Cliquer sur **Créer dans Premiere**, ou **Exporter XML** puis importer le XML via Fichier → Importer. Chaque import crée une nouvelle séquence, avec une piste vidéo montée et les pistes audio séparées.
9. Écouter les raccords, vérifier la synchro et affiner le montage. Les changements de caméra ne recoupent pas inutilement l’audio. Les suppressions de silence font des coupes franches : ajouter de courts fondus si des clics sont audibles.

Les XML utilisés par l’import direct restent dans `%TEMP%\PodcastCut`. Le montage référence les fichiers sources d’origine : conserver les médias à leur emplacement, ou les relier dans Premiere après déplacement.

## Ce que cette version fait

- Mesure RMS locale par image, lissage, seuil, gain de détection par micro.
- Choix de caméra, confirmation de changement, durée minimale du plan ; les raccords après suppression d’un silence peuvent produire un plan plus court.
- Plan large en cas de plusieurs micros actifs ; maintien du plan courant pendant les pauses conservées.
- Suppression des silences avec les mêmes coupes temporelles pour vidéo et audio.
- Aperçu graphique des coupes, tableau des 250 premiers plans, statistiques ; l’export inclut tous les plans.
- Enregistrement d’un jeu de réglages dans le panneau (sans chemins de médias).
- Export Final Cut Pro 7 XML et import dans Premiere par l’API officielle.
- Lecture de la timeline active, sélection des pistes V/A, duplication de la séquence et montage direct des pistes caméra dans la copie.

## Limites connues

Le mode à micros séparés utilise les niveaux audio. Le mode à piste mixée utilise une identification locale des voix, puis demande d'associer chaque voix à sa caméra. Bruit, musique, rires et repisse peuvent influencer le choix. Pas de transcription, sous-titres, cadrage automatique, débruitage ou synchronisation automatique.

La version cible Premiere Pro 26.x / CEP 12. Avant une vente, le panneau doit passer au format UXP/CCX actuel de Premiere, recevoir un identifiant Adobe définitif, être testé avec des médias réels et faire l'objet d'une signature Authenticode pour l'installateur EXE.

## Développement et tests

Avec Node 18 ou plus récent : `npm test` depuis ce dossier. Aucune installation npm nécessaire.

- `core.js` : lecteur WAV, moteur de décision, export XML.
- `panel.js`, `index.html`, `style.css` : interface CEP.
- `host.jsx` : dialogues et import Premiere via ExtendScript.
- `CSXS/manifest.xml` : déclaration du panneau.
- `tests/run.js` : tests audio synthétique, coupes, synchro et XML.

## Désinstallation

Fermer Premiere puis supprimer uniquement le dossier `%APPDATA%\Adobe\CEP\extensions\fr.podcastcut.panel`. Le mode développeur CEP peut être désactivé en remettant `PlayerDebugMode` à `0` dans la clé ci-dessus si aucune autre extension de développement n’en a besoin. Les projets et médias ne sont pas affectés.

## Références publiques

- Fonctions du produit de référence : https://aescripts.com/premieregpt-podcast-bundle/
- Exemples et API Adobe : https://github.com/Adobe-CEP/Samples/tree/master/PProPanel
- CEP 12 : https://github.com/Adobe-CEP/CEP-Resources
- Format XML : https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/FinalCutPro_XML/Elements/Elements.html
