# Random Favorites pour Vencord

[RandomFavorites](https://github.com/Yuzuctus/RandomFavorites) envoie instantanément un GIF favori, une emote ou un sticker choisi au hasard depuis Discord.

Le plugin ne maintient pas de liste externe. Les GIFs viennent de tes favoris
Discord natifs. Les emotes et stickers peuvent venir de tous les éléments
utilisables ou seulement de tes favoris, selon tes réglages.

## Fonctionnalités

- Bouton dé directement dans la barre de chat.
- Clic gauche : envoie le type configuré.
- Clic droit : choisit entre tout, GIF, emote ou sticker.
- GIFs précédés de `Gif random :` et masqués par défaut avec le spoiler natif de Discord, révélables d'un clic.
- Préfixe GIF, texte du préfixe et spoiler configurables indépendamment.
- Commandes slash dédiées.
- Mode équilibré : chaque catégorie disponible revient aussi souvent.
- Mode uniforme : chaque favori individuel a exactement la même chance.
- Toutes les emotes et tous les stickers utilisables sont inclus par défaut, avec un mode « favoris uniquement » disponible.
- Shuffle bag optionnel : tous les favoris passent une fois avant la moindre répétition.
- Filtrage des favoris supprimés, introuvables ou inutilisables dans le salon.
- Respect des permissions d'emotes/stickers externes et d'envoi de messages.
- Conservation d'une réponse Discord en cours lorsque le favori est envoyé.
- Interface et erreurs en français lorsque Discord est en français, sinon en anglais.
- Aucun serveur externe, aucune télémétrie, aucun token et aucune requête réseau ajoutée.

## Commandes

| Commande | Action |
| --- | --- |
| `/random-favorite` | Envoie un favori aléatoire ; l'option `type` permet de filtrer. |
| `/random-gif` | Envoie uniquement un GIF favori. |
| `/random-emoji` | Envoie une emote depuis la liste configurée. |
| `/random-sticker` | Envoie un sticker depuis la liste configurée. |
| `/random-favorite-stats` | Affiche le nombre de favoris enregistrés et actuellement utilisables. |

## Installation

Les userplugins Vencord doivent être compilés avec Vencord. Une installation Vencord classique obtenue uniquement avec l'installeur ne contient pas les sources nécessaires.

### Installation automatique sous Windows

1. Sur GitHub, clique sur `Code > Download ZIP`.
2. Extrais complètement le ZIP.
3. Double-clique sur **`RandomFavoritesManager.cmd`**.
4. Laisse le gestionnaire compiler, fermer Discord, injecter Vencord et le relancer.
5. Active **RandomFavorites** dans `Paramètres > Vencord > Plugins`.

Le gestionnaire :

- réutilise Git et Node.js lorsqu'ils sont déjà installés et compatibles ;
- télécharge sinon des copies portables temporaires de MinGit et Node.js ;
- vérifie les archives téléchargées avec leur empreinte SHA-256 officielle ;
- utilise temporairement la version exacte de pnpm demandée par Vencord ;
- supprime les copies temporaires de Git, Node.js et pnpm à la fin, même en cas d'erreur ;
- conserve la build dans `%LOCALAPPDATA%\RandomFavoritesVencord\Vencord` ;
- installe ou met à jour Vencord depuis son dépôt officiel ;
- installe ou met à jour RandomFavorites depuis ce dépôt ;
- refuse d'écraser des modifications Git locales ;
- compile, injecte Discord Stable et vérifie le chemin du patch ;
- écrit un journal et un état de la dernière installation réussie.

Pour toutes les mises à jour suivantes, double-clique simplement sur :

```text
%LOCALAPPDATA%\RandomFavoritesVencord\Update RandomFavorites.cmd
```

Le même programme met alors à jour **Vencord et RandomFavorites**, réinstalle
les dépendances exactes, recompile et réinjecte la build. Il peut donc réparer
automatiquement l'installation après une mise à jour de Discord qui aurait
retiré le patch.

Options utiles depuis un terminal :

```powershell
# Installer une autre branche Discord
RandomFavoritesManager.cmd -Branch ptb
RandomFavoritesManager.cmd -Branch canary

# Choisir un autre dossier persistant
RandomFavoritesManager.cmd -InstallRoot "D:\RandomFavoritesVencord"

# Compiler sans toucher à Discord
RandomFavoritesManager.cmd -SkipInject
```

Prérequis pour l'installation entièrement automatique : Windows 10/11
64 bits, connexion Internet et Discord Desktop. Git, Node.js et pnpm ne sont
pas des prérequis manuels. Le gestionnaire n'installe aucun de ces outils dans
Windows : lorsqu'ils manquent, il utilise des archives portables dans
`%LOCALAPPDATA%\RandomFavoritesVencord\.bootstrap`, puis supprime ce dossier.

Les sources Vencord, RandomFavorites, les dépendances de compilation et le
bundle `dist` restent dans le dossier géré. Elles sont nécessaires pour
recompiler rapidement lors d'une future mise à jour. Rien n'est ajouté au
`PATH` permanent de Windows.

Le gestionnaire est un script lisible. Il télécharge MinGit depuis le projet
officiel Git for Windows, Node.js depuis `nodejs.org`, Vencord depuis son dépôt
officiel et RandomFavorites depuis le dépôt Yuzuctus.

### Installation manuelle

1. Installe Vencord depuis les sources en suivant les guides officiels :
   [installation depuis les sources](https://docs.vencord.dev/installing/) et
   [installation des plugins personnalisés](https://docs.vencord.dev/installing/custom-plugins/).
2. Ouvre le dossier `Vencord/src`.
3. Crée `userplugins` s'il n'existe pas.
4. Clone ce dépôt dans un dossier directement sous `userplugins` :

   ```powershell
   cd C:\chemin\vers\Vencord\src\userplugins
   git clone https://github.com/Yuzuctus/RandomFavorites.git randomFavorites
   ```

5. Depuis la racine de Vencord :

   ```powershell
   pnpm install --frozen-lockfile
   pnpm build
   pnpm inject
   ```

6. Redémarre complètement Discord.
7. Dans `Paramètres utilisateur > Vencord > Plugins`, active **RandomFavorites**.

La structure finale doit être exactement :

```text
Vencord/
└─ src/
   └─ userplugins/
      └─ randomFavorites/
         ├─ index.tsx
         ├─ messageFormatting.ts
         └─ shuffleBag.ts
```

Pour mettre le plugin à jour plus tard :

```powershell
cd C:\chemin\vers\Vencord\src\userplugins\randomFavorites
git pull
cd ..\..\..
pnpm build
```

L'installeur officiel de Vencord n'inclut pas ce dépôt tiers. Le gestionnaire
automatique résout ce point en préparant une build Vencord persistante dans
laquelle RandomFavorites est présent au moment de la compilation.

## Réglages

- **Chat bar button / Bouton dans la barre de chat** : affiche ou masque le bouton dé.
- **Mask random GIFs / Masquer les GIFs aléatoires** : active ou désactive le spoiler. Activé par défaut.
- **Show the GIF message / Afficher le texte des GIFs** : affiche ou retire le préfixe.
- **GIF message / Texte des GIFs** : personnalise `Gif random :`.
- **Default type / Type par défaut** : type envoyé au clic gauche.
- **Mixed mode distribution / Répartition du mode mixte** :
  - l'équilibrage évite que les emotes, souvent plus nombreuses, écrasent complètement les GIFs et stickers ;
  - le mode uniforme donne la même chance à chaque élément de la liste combinée.
- **Emoji source / Source des emotes** : toutes les emotes utilisables par défaut, ou seulement les favorites.
- **Sticker source / Source des stickers** : tous les stickers utilisables par défaut, ou seulement les favoris.
- **Avoid repeats / Éviter les répétitions** : épuise un ordre mélangé avant de recommencer.

Le bouton peut aussi être masqué via le menu contextuel de la barre de chat, dans les réglages globaux des boutons Vencord.

Pour ouvrir ces options : `Paramètres utilisateur > Vencord > Plugins`, cherche
**RandomFavorites**, puis clique sur la roue dentée du plugin.

Les noms, descriptions et choix des réglages sont affichés en français lorsque
Discord utilise le français, et en anglais dans les autres langues. Un changement
de langue peut nécessiter un redémarrage de Discord pour reconstruire la fenêtre
des réglages.

## Notes de compatibilité

- Conçu et compilé contre Vencord `1.15.0`, commit `83b74e2305cb4718b3d55af5fbd93ade50d2bb50` du 26 juillet 2026.
- Le plugin utilise le `FrecencyUserSettings` natif de Discord, qui contient aujourd'hui `favoriteGifs`, `favoriteEmojis` et `favoriteStickers`.
- Un favori peut être enregistré mais inutilisable : serveur quitté, emote supprimée, permission externe absente, sticker indisponible ou accès Nitro manquant. Le plugin l'ignore sans bloquer les autres tirages.
- Les anciens GIFs Discord reposant sur des URL CDN signées peuvent expirer côté Discord.
- Les mods clients et userplugins sont à utiliser en connaissance des règles de Discord. Vencord ne fournit pas de support officiel pour les plugins tiers.

## Développement

Ce dépôt est volontairement un dossier de plugin Vencord directement clonable, et non un paquet npm autonome. Pour vérifier une modification :

```powershell
# depuis la racine du checkout Vencord qui contient ce plugin
pnpm testTsc
pnpm eslint src/userplugins/randomFavorites
pnpm exec tsx --test src/userplugins/randomFavorites/*.test.ts
pnpm build
```

Le code est sous licence `GPL-3.0-or-later`, comme Vencord.

Ce projet est un dépôt indépendant publié par **Yuzuctus**. Il ne demande
aucune contribution, pull request ou publication dans le dépôt officiel de
Vencord.
