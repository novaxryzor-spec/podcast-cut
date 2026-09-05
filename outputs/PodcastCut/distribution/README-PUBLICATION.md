# Publication et mises à jour de Podcast Cut

`Build-Release.ps1` fabrique un installateur Windows unique et un flux de mise à jour signé. L'installateur place le panneau dans le profil Windows, enregistre sa désinstallation et lance le vérificateur au démarrage de Windows. Le panneau lance aussi une vérification discrète à son ouverture. Chaque PC vérifie au maximum toutes les six heures.

## Installation macOS

Le ZIP contient aussi `Installer-Mac.command` et `Uninstall-Mac.command`. Sur un Mac, copiez le dossier de l'extension dans `~/Library/Application Support/Adobe/CEP/extensions/fr.podcastcut.panel`, puis double-cliquez sur `Installer-Mac.command`. Le script crée l'environnement Python local et télécharge les modèles IA dans `~/Documents/PodcastCut/AI`. Le chargeur choisit automatiquement l'interface macOS au lancement de Premiere Pro.

## Première publication

1. Réserver un domaine HTTPS, par exemple `https://updates.votre-domaine.fr/podcastcut/stable`.
2. Exécuter :

   `powershell -ExecutionPolicy Bypass -File .\Build-Release.ps1 -Version 0.3.0 -BaseUrl "https://updates.votre-domaine.fr/podcastcut/stable"`

3. Envoyer sur ce chemin HTTPS les trois fichiers `manifest.json`, `manifest.sig` et `PodcastCut-0.3.0.zip`.
4. Distribuer `PodcastCut-Setup-0.3.0.exe` aux clients.

La clé privée est créée dans `Documents\PodcastCut-Publisher\keys\update-private.xml`. Elle signe chaque manifeste et ne doit jamais être envoyée sur le serveur, ajoutée au ZIP, partagée avec les clients ou placée dans un dépôt Git. Sauvegardez-la chiffrée hors ligne. Sans cette clé, les installations existantes refuseront les futures mises à jour.

## Publier une mise à jour

1. Modifier le code et mettre la même version `x.y.z` dans `CSXS\manifest.xml` et `package.json`.
2. Relancer `Build-Release.ps1` avec la nouvelle version et exactement la même URL de base.
3. Envoyer d'abord le nouveau ZIP, puis `manifest.sig`, et `manifest.json` en dernier. Cette séquence évite qu'un client voie une version dont le paquet n'est pas encore disponible.

Le programme vérifie la signature RSA du manifeste, le SHA-256 du ZIP, l'identité du produit et la version interne avant remplacement. Il conserve l'ancienne installation jusqu'à la dernière étape et la restaure si le remplacement échoue.

## Avant une vente publique

- Signer l'EXE avec un certificat Authenticode pour éviter l'avertissement Windows SmartScreen.
- Remplacer l'identifiant de développement par l'identifiant définitif de distribution.
- Migrer le panneau CEP vers UXP et produire un `.ccx` si la vente passe par Creative Cloud Marketplace. Dans ce canal, Creative Cloud gère les mises à jour.
- Ajouter le système de licence et les conditions commerciales. L'installateur actuel ne limite pas le nombre de PC et ne vérifie aucun achat.
