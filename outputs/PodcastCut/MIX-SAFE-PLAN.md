# Mode mix audio sécurisé

## Pourquoi le mode actuel se trompe

La diarisation répond à « qui parle quand ? » avec des identifiants anonymes. Le premier identifiant retourné n’est pas forcément l’intervenant de la caméra 1. Une moyenne mono supprime aussi une éventuelle séparation gauche/droite du mix. Enfin, le modèle actuel ne fournit pas de score de confiance exploité par le montage.

## Solution retenue

Le mode mix doit fonctionner en deux phases, sans écran de confirmation après l’analyse :

1. **Enrôlement avant analyse.** Pour chaque intervenant, l’utilisateur indique un extrait propre de 5 à 10 secondes dans le mix, ou importe un court extrait micro. Le moteur calcule une empreinte vocale persistante pour chaque intervenant.
2. **Diarisation contrainte.** Le moteur détecte les tours de parole, calcule les empreintes des tours propres, puis associe les tours aux profils par similarité cosinus et appariement global. Les labels anonymes du clustering ne sont jamais utilisés directement pour choisir une caméra.
3. **Décision prudente.** Une coupe n’est autorisée que si la marge entre le meilleur et le deuxième profil dépasse un seuil. Les chevauchements, les segments courts et les scores faibles conservent le plan courant ou passent au plan large. Le plugin ne fabrique jamais un changement de caméra à partir d’une identité incertaine.
4. **Prévisualisation avant mutation.** Le plugin affiche les coupes proposées sur une bande temporelle et indique les zones sûres, incertaines et en chevauchement. L’application à la copie Premiere reste une action séparée.

## Cas où aucune référence vocale n’est disponible

Le mix peut encore être analysé pour détecter les silences et les chevauchements, mais le changement automatique de caméra doit rester désactivé. Le plan large ou le plan courant est alors utilisé. C’est le seul comportement sûr avec un mix totalement inconnu.

## Implémentation locale

Le moteur actuel sherpa-onnx fournit déjà la diarisation et un extracteur d’empreintes vocales. Son API officielle expose l’extraction d’embeddings et la recherche par seuil ; ces fonctions peuvent être utilisées localement, sans envoyer le mix sur un serveur. Le pipeline doit conserver les canaux originaux avant toute conversion mono et exploiter les fenêtres multi-échelles pour les chevauchements.

## Références techniques

- pyannote distingue explicitement diarisation et identification par voiceprints et recommande des scores de confiance pour une correction humaine ciblée.
- sherpa-onnx expose un extracteur d’embeddings et un gestionnaire d’identités avec recherche par seuil.
- NVIDIA NeMo décrit MSDD, TitaNet et la segmentation multi-échelle pour les conversations avec chevauchements.
