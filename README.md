# RandomFavorites pour Vencord

Envoie un **GIF favori**, une **emote** ou un **sticker** aléatoire directement depuis la barre de chat Discord.

## Installation

> Windows 10/11 et Discord Desktop sont nécessaires.
>
> Tu n'as pas besoin d'installer Git, Node.js ou pnpm.

1. [Télécharge RandomFavorites au format ZIP](https://github.com/Yuzuctus/RandomFavorites/archive/refs/heads/main.zip).
2. Extrais complètement le ZIP.
3. Ouvre le dossier extrait.
4. Double-clique sur **`Installer RandomFavorites.cmd`**.
5. Confirme avec `O` et attends la fin de l'installation.
6. Dans Discord, ouvre `Paramètres > Vencord > Plugins` et active **RandomFavorites**.

Discord reste ouvert pendant la préparation. Il se ferme seulement à la fin de l'installation, puis redémarre automatiquement.

## Utilisation

Un bouton en forme de dé apparaît dans la barre de chat :

- **Clic gauche** : envoie un élément aléatoire.
- **Clic droit** : permet de choisir GIF, emote, sticker et le mode d'envoi.

Deux modes sont disponibles :

- **Un élément de chaque type coché** : envoie par exemple un GIF, une emote et un sticker.
- **Un seul élément** : choisit un seul type parmi ceux cochés, puis un élément de ce type.

Avec la **répartition équitable**, chaque type possède la même chance :

- GIF + emote + sticker : environ `33 %` chacun.
- GIF + sticker : `50 %` chacun.

Tu peux aussi utiliser :

- `/random-favorite`
- `/random-gif`
- `/random-emoji`
- `/random-sticker`
- `/random-favorite-stats`

## Réglages

Ouvre `Paramètres > Vencord > Plugins`, cherche **RandomFavorites**, puis clique sur la roue dentée.

Tu peux notamment :

- masquer les GIFs aléatoires avec un spoiler ;
- afficher, modifier ou retirer le texte `Gif random :` ;
- choisir les types utilisés par le clic gauche ;
- choisir entre répartition équitable et tirage totalement aléatoire ;
- utiliser toutes les emotes et stickers disponibles ou seulement tes favoris ;
- éviter les répétitions.

Les réglages sont en français lorsque Discord est en français, sinon ils sont affichés en anglais.

## Mise à jour

Pour mettre à jour **RandomFavorites et Vencord** :

1. Appuie sur `Windows + R`.
2. Colle :

   ```text
   %LOCALAPPDATA%\RandomFavoritesVencord
   ```

3. Double-clique sur **`Update RandomFavorites.cmd`**.

Tu peux aussi relancer cette mise à jour si une mise à jour de Discord retire Vencord.

## En cas de problème

- Vérifie que **RandomFavorites** est activé dans les plugins Vencord.
- Relance `Update RandomFavorites.cmd`.
- Si l'installation affiche une erreur, garde une capture de la fenêtre.
- Le chemin du journal de diagnostic est affiché en bas de la fenêtre.

## Sécurité

- Aucun token Discord n'est lu ou enregistré.
- Aucune télémétrie n'est ajoutée.
- Aucune liste de favoris externe n'est créée.
- Les outils de compilation manquants sont utilisés temporairement puis supprimés.
- Rien n'est envoyé sans un clic sur le bouton ou une commande.

RandomFavorites est un plugin tiers indépendant publié par **Yuzuctus**. Il ne fait pas partie du dépôt officiel de Vencord.

Licence : `GPL-3.0-or-later`.
