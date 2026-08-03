# RandomFavorites

Un plugin Vencord qui envoie un **GIF**, une **emote**, un **sticker** ou un **son de soundboard** aléatoire depuis Discord.

## Installer sur Windows

1. [Télécharge **RandomFavoritesSetup.exe**](https://github.com/Yuzuctus/RandomFavorites/releases/latest/download/RandomFavoritesSetup.exe).
2. Ouvre le fichier et choisis ta version de Discord.
3. Coche **OpenAsar** si tu veux aussi installer cette optimisation facultative.
4. Clique sur **Installer**.
5. Dans Discord, va dans `Paramètres > Vencord > Plugins` et active **RandomFavorites**.

Git, Node.js et pnpm ne sont pas nécessaires. L'installateur prépare les fichiers pendant que Discord reste ouvert, puis le ferme seulement au moment de l'installation. L'option avancée **Relancer Discord une fois terminé** est activée par défaut et peut être décochée avant l'opération.

> L'application n'est pas encore signée. Si Windows SmartScreen apparaît, vérifie que le fichier vient bien de la page [Releases officielle](https://github.com/Yuzuctus/RandomFavorites/releases), puis choisis **Informations complémentaires > Exécuter quand même**.

## Utiliser le plugin

- **Clic gauche sur le dé** : effectue le tirage configuré.
- **Clic droit sur le dé** : choisit GIF, emote, sticker et le mode de tirage.
- **Aperçu sécurisé** : affiche le GIF, l'emote ou le sticker dans une fenêtre privée avant tout envoi. Rien n'est envoyé tant que tu ne confirmes pas.
- **Soundboard aléatoire** : le sélecteur contient un serveur virtuel **FavoriteRandom**, juste sous les favoris. **Lecture directe** joue immédiatement un son aléatoire ; **Aperçu sécurisé** permet de l'écouter localement avant de confirmer sa lecture dans le vocal. Ces deux actions sont indépendantes du réglage d'aperçu des GIFs, emotes et stickers.

Les réglages sont en français si Discord est en français, sinon en anglais. Ils permettent notamment de choisir :

- un élément de chaque type ou un seul élément parmi les types cochés ;
- une répartition équilibrée sur la durée (base `33/33/33`, ou `50/50` avec deux types) ;
- les spoilers et le texte `Gif random :` ;
- toutes les emotes/stickers disponibles ou seulement les favoris ;
- l'aperçu avant envoi et une réduction probabiliste des répétitions, avec une intensité légère, équilibrée ou forte.

Le tirage utilise la source aléatoire cryptographique de l'environnement Discord. L'anti-répétition ne bloque jamais totalement un résultat : il réduit temporairement le poids des éléments récents, puis leur rend progressivement leur probabilité normale.

## Mettre à jour, réparer ou désinstaller

Rouvre le même EXE :

- **Installer / Mettre à jour** récupère la dernière version stable et actualise OpenAsar lorsqu'il est actif ;
- **Réparer** réapplique les fichiers après une mise à jour de Discord et revérifie OpenAsar ;
- **Désinstaller** peut retirer seulement RandomFavorites, Vencord en conservant ses données, ou tout supprimer.

OpenAsar reste entièrement facultatif. Lorsqu'il est actif, chaque opération **Installer / Mettre à jour** ou **Réparer** récupère la release nightly officielle, vérifie l'empreinte SHA-256 publiée par GitHub et compare son contenu à la copie installée. Une mise à jour remplace uniquement OpenAsar : l'archive Discord d'origine reste intacte pour permettre sa restauration. Désactiver son interrupteur puis appliquer les changements le retire proprement. Le menu **Désinstaller** permet aussi de choisir explicitement de le conserver ou de le retirer.

GitHub compare chaque heure le commit Vencord officiel et le digest SHA-256 de la nightly OpenAsar aux valeurs du manifeste publié. Si l'un des deux change, le bundle et l'EXE de la dernière release sont reconstruits, les tests sont relancés, puis tous les assets sont remplacés seulement en cas de succès. L'EXE récupère donc le **dernier build Vencord vérifié compatible avec RandomFavorites** et connaît la release OpenAsar testée, même si le numéro de version du plugin n'a pas changé. Si une mise à jour casse la compilation ou les tests, GitHub conserve la dernière publication fonctionnelle.

La surveillance GitHub ne modifie pas silencieusement Discord sur les PC déjà installés : il faut rouvrir l'EXE et cliquer sur **Mettre à jour** ou **Réparer** pour appliquer les nouvelles versions localement.

Les réglages non concernés sont conservés. Une sauvegarde est créée avant de retirer les réglages RandomFavorites.

## Sécurité

- aucun token Discord lu, stocké ou transmis ;
- aucune télémétrie ni publicité ;
- rien n'est envoyé sans clic, commande ou confirmation explicite ;
- les téléchargements de l'installateur sont vérifiés par SHA-256.

RandomFavorites est un plugin tiers indépendant de Vencord et d'OpenAsar, publié sous licence `GPL-3.0-or-later`.

### Ancienne installation par script

Le fichier `Installer RandomFavorites.cmd` reste disponible comme méthode de secours pour les développeurs et le dépannage. La méthode recommandée pour les utilisateurs est l'EXE de la page Releases.
