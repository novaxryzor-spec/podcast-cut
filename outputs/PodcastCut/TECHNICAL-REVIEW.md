# Revue technique de Podcast Cut

La référence installée par l’utilisateur est un panneau CEP distribué avec un installateur Windows et un bundle JavaScript contrôleur. Son code fourni est obfusqué ; aucune logique propriétaire n’a été copiée. Les éléments retenus au niveau architecture sont : une interface CEP unique, un pont `cep.evalScript` vers Premiere, un moteur local séparé pour l’analyse audio, et une mise à jour vérifiée par manifeste signé.

Podcast Cut suit cette architecture avec une séparation stricte :

- `panel.js` gère l’interface, les validations et l’orchestration ;
- `timeline.js` et `core.js` planifient sans modifier Premiere ;
- `ai-client.js` appelle le moteur local ;
- `host.jsx` est le seul fichier qui clone une séquence, coupe via QE, désactive les angles et règle les pistes audio ;
- `distribution` produit le ZIP, l’installateur EXE et le flux de mise à jour signé.

Les garde-fous ajoutés dans la version 0.3.4 couvrent la lecture de pistes Premiere momentanément incomplètes, la détection des transitions, la vérification de la copie, la vérification du mute audio et le retour à la séquence originale en cas d’échec. La compatibilité complète avec Premiere nécessite encore un test sur une séquence réelle après sauvegarde du projet ouvert.
