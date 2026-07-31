# RandomFavorites

Un plugin Vencord qui envoie un **GIF**, une **emote** ou un **sticker** aléatoire depuis Discord.

## Installer sur Windows

1. [Télécharge **RandomFavoritesSetup.exe**](https://github.com/Yuzuctus/RandomFavorites/releases/latest/download/RandomFavoritesSetup.exe).
2. Ouvre le fichier et choisis ta version de Discord.
3. Clique sur **Installer**.
4. Dans Discord, va dans `Paramètres > Vencord > Plugins` et active **RandomFavorites**.

Git, Node.js et pnpm ne sont pas nécessaires. L'installateur prépare les fichiers pendant que Discord reste ouvert, ferme Discord seulement au moment de l'installation, puis le redémarre.

> L'application n'est pas encore signée. Si Windows SmartScreen apparaît, vérifie que le fichier vient bien de la page [Releases officielle](https://github.com/Yuzuctus/RandomFavorites/releases), puis choisis **Informations complémentaires > Exécuter quand même**.

## Utiliser le plugin

- **Clic gauche sur le dé** : effectue le tirage configuré.
- **Clic droit sur le dé** : choisit GIF, emote, sticker et le mode de tirage.
- **Aperçu sécurisé** : affiche le résultat dans une fenêtre privée avant tout envoi. Rien n'est envoyé tant que tu ne confirmes pas.

Les réglages sont en français si Discord est en français, sinon en anglais. Ils permettent notamment de choisir :

- un élément de chaque type ou un seul élément parmi les types cochés ;
- une répartition équitable (`33/33/33`, ou `50/50` avec deux types) ;
- les spoilers et le texte `Gif random :` ;
- toutes les emotes/stickers disponibles ou seulement les favoris ;
- l'aperçu avant envoi et l'anti-répétition.

## Mettre à jour, réparer ou désinstaller

Rouvre le même EXE :

- **Installer / Mettre à jour** récupère la dernière version stable ;
- **Réparer** réapplique les fichiers après une mise à jour de Discord ;
- **Désinstaller** peut retirer seulement RandomFavorites, Vencord en conservant ses données, ou tout supprimer.

Les réglages non concernés sont conservés. Une sauvegarde est créée avant de retirer les réglages RandomFavorites.

## Sécurité

- aucun token Discord lu, stocké ou transmis ;
- aucune télémétrie ni publicité ;
- rien n'est envoyé sans clic, commande ou confirmation explicite ;
- les téléchargements de l'installateur sont vérifiés par SHA-256.

RandomFavorites est un plugin tiers indépendant de Vencord, publié sous licence `GPL-3.0-or-later`.

### Ancienne installation par script

Le fichier `Installer RandomFavorites.cmd` reste disponible comme méthode de secours pour les développeurs et le dépannage. La méthode recommandée pour les utilisateurs est l'EXE de la page Releases.
