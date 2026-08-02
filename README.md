# RandomFavorites

Un plugin Vencord qui envoie un **GIF**, une **emote** ou un **sticker** aléatoire depuis Discord.

## Installer sur Windows

1. [Télécharge **RandomFavoritesSetup.exe**](https://github.com/Yuzuctus/RandomFavorites/releases/latest/download/RandomFavoritesSetup.exe).
2. Ouvre le fichier et choisis ta version de Discord.
3. Coche **OpenAsar** si tu veux aussi installer cette optimisation facultative.
4. Clique sur **Installer**.
5. Dans Discord, va dans `Paramètres > Vencord > Plugins` et active **RandomFavorites**.

Git, Node.js et pnpm ne sont pas nécessaires. L'installateur prépare les fichiers pendant que Discord reste ouvert, puis le ferme seulement au moment de l'installation. **Discord n'est jamais relancé automatiquement** : tu le rouvres toi-même quand l'opération est terminée.

> L'application n'est pas encore signée. Si Windows SmartScreen apparaît, vérifie que le fichier vient bien de la page [Releases officielle](https://github.com/Yuzuctus/RandomFavorites/releases), puis choisis **Informations complémentaires > Exécuter quand même**.

## Utiliser le plugin

- **Clic gauche sur le dé** : effectue le tirage configuré.
- **Clic droit sur le dé** : choisit GIF, emote, sticker et le mode de tirage.
- **Aperçu sécurisé** : affiche le résultat dans une fenêtre privée avant tout envoi. Rien n'est envoyé tant que tu ne confirmes pas.

Les réglages sont en français si Discord est en français, sinon en anglais. Ils permettent notamment de choisir :

- un élément de chaque type ou un seul élément parmi les types cochés ;
- une répartition équilibrée sur la durée (base `33/33/33`, ou `50/50` avec deux types) ;
- les spoilers et le texte `Gif random :` ;
- toutes les emotes/stickers disponibles ou seulement les favoris ;
- l'aperçu avant envoi et une réduction probabiliste des répétitions, avec une intensité légère, équilibrée ou forte.

Le tirage utilise la source aléatoire cryptographique de l'environnement Discord. L'anti-répétition ne bloque jamais totalement un résultat : il réduit temporairement le poids des éléments récents, puis leur rend progressivement leur probabilité normale.

## Mettre à jour, réparer ou désinstaller

Rouvre le même EXE :

- **Installer / Mettre à jour** récupère la dernière version stable ;
- **Réparer** réapplique les fichiers après une mise à jour de Discord ;
- **Désinstaller** peut retirer seulement RandomFavorites, Vencord en conservant ses données, ou tout supprimer.

OpenAsar reste entièrement facultatif. Lorsqu'il est demandé, l'installateur récupère la release nightly officielle au moment de l'opération, vérifie l'empreinte SHA-256 publiée par GitHub, puis conserve l'archive Discord d'origine pour permettre sa restauration. Le menu **Désinstaller** permet de choisir explicitement de conserver ou de retirer OpenAsar.

Le bundle de la dernière release est automatiquement recompilé lorsque le Vencord officiel change. L'EXE récupère donc le **dernier build Vencord vérifié compatible avec RandomFavorites**, même si le numéro de version du plugin n'a pas changé. Si une mise à jour Vencord casse la compilation, GitHub conserve le dernier bundle fonctionnel au lieu de distribuer une installation cassée.

Les réglages non concernés sont conservés. Une sauvegarde est créée avant de retirer les réglages RandomFavorites.

## Sécurité

- aucun token Discord lu, stocké ou transmis ;
- aucune télémétrie ni publicité ;
- rien n'est envoyé sans clic, commande ou confirmation explicite ;
- les téléchargements de l'installateur sont vérifiés par SHA-256.

RandomFavorites est un plugin tiers indépendant de Vencord et d'OpenAsar, publié sous licence `GPL-3.0-or-later`.

### Ancienne installation par script

Le fichier `Installer RandomFavorites.cmd` reste disponible comme méthode de secours pour les développeurs et le dépannage. La méthode recommandée pour les utilisateurs est l'EXE de la page Releases.
