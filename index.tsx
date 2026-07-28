/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import {
    ApplicationCommandInputType,
    ApplicationCommandOptionType,
    findOption,
    sendBotMessage,
} from "@api/Commands";
import { definePluginSettings } from "@api/Settings";
import { sendMessage } from "@utils/discord";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { Channel, Command, Emoji, Sticker } from "@vencord/discord-types";
import {
    ContextMenuApi,
    EmojiStore,
    FluxDispatcher,
    LocaleStore,
    Menu,
    MessageActions,
    PendingReplyStore,
    PermissionsBits,
    PermissionStore,
    showToast,
    StickersStore,
    Toasts,
    UserSettingsActionCreators,
} from "@webpack/common";

import { formatGifContent } from "./messageFormatting";
import { ShuffleBag } from "./shuffleBag";

type FavoriteKind = "all" | "gif" | "emoji" | "sticker";
type ConcreteFavoriteKind = Exclude<FavoriteKind, "all">;
type MixMode = "balanced" | "uniform";
type PoolScope = "favorites" | "all";

interface FavoriteGif {
    format?: number;
    src?: string;
    width?: number;
    height?: number;
    order?: number;
}

interface FrecencySettings {
    favoriteGifs?: {
        gifs?: Record<string, FavoriteGif>;
    };
    favoriteStickers?: {
        stickerIds?: Array<string | bigint | number>;
    };
    favoriteEmojis?: {
        emojis?: Array<string | bigint | number>;
    };
}

interface FrecencySettingsActions {
    getCurrentValue(): FrecencySettings | undefined;
}

interface FavoriteCandidate {
    kind: ConcreteFavoriteKind;
    key: string;
    label: string;
    content?: string;
    stickerId?: string;
}

interface FavoritePools {
    candidates: Record<ConcreteFavoriteKind, FavoriteCandidate[]>;
    rawCounts: Record<ConcreteFavoriteKind, number>;
}

type SendResult =
    | { ok: true; candidate: FavoriteCandidate; }
    | { ok: false; message: string; };

const logger = new Logger("RandomFavorites");
const activeChannels = new Set<string>();
const concreteKinds: ConcreteFavoriteKind[] = ["gif", "emoji", "sticker"];

const candidateBags: Record<ConcreteFavoriteKind, ShuffleBag<FavoriteCandidate>> = {
    gif: new ShuffleBag(candidate => candidate.key),
    emoji: new ShuffleBag(candidate => candidate.key),
    sticker: new ShuffleBag(candidate => candidate.key),
};
const allCandidatesBag = new ShuffleBag<FavoriteCandidate>(candidate => candidate.key);
const categoryBag = new ShuffleBag<ConcreteFavoriteKind>(kind => kind);

const settings = definePluginSettings({
    showChatBarButton: {
        type: OptionType.BOOLEAN,
        get displayName() {
            return localize("Chat bar button", "Bouton dans la barre de chat");
        },
        get description() {
            return localize(
                "Show the Random Favorites dice button in the chat bar.",
                "Affiche le bouton dé de Random Favorites dans la barre de chat.",
            );
        },
        default: true,
    },
    maskGifs: {
        type: OptionType.BOOLEAN,
        get displayName() {
            return localize("Mask random GIFs", "Masquer les GIFs aléatoires");
        },
        get description() {
            return localize(
                "Hide random GIFs behind Discord's native spoiler mask.",
                "Cache les GIFs aléatoires derrière le spoiler natif de Discord.",
            );
        },
        default: true,
    },
    showGifLabel: {
        type: OptionType.BOOLEAN,
        get displayName() {
            return localize("Show the GIF message", "Afficher le texte des GIFs");
        },
        get description() {
            return localize(
                "Add a short message before every random GIF.",
                "Ajoute un petit texte avant chaque GIF aléatoire.",
            );
        },
        default: true,
    },
    gifLabel: {
        type: OptionType.STRING,
        get displayName() {
            return localize("GIF message", "Texte des GIFs");
        },
        get description() {
            return localize(
                "Text displayed before random GIFs.",
                "Texte affiché avant les GIFs aléatoires.",
            );
        },
        get default() {
            return localize("Random GIF:", "Gif random :");
        },
        get placeholder() {
            return localize("Random GIF:", "Gif random :");
        },
    },
    defaultKind: {
        type: OptionType.SELECT,
        get displayName() {
            return localize("Default type", "Type par défaut");
        },
        get description() {
            return localize(
                "Type sent with a left click on the chat bar button.",
                "Type envoyé avec un clic gauche sur le bouton de la barre de chat.",
            );
        },
        get options() {
            return [
                {
                    label: localize("All configured pools", "Toutes les listes configurées"),
                    value: "all",
                    default: true,
                },
                { label: localize("Favorite GIFs", "GIFs favoris"), value: "gif" },
                { label: localize("Emojis", "Emotes"), value: "emoji" },
                { label: "Stickers", value: "sticker" },
            ] as const;
        },
    },
    mixMode: {
        type: OptionType.SELECT,
        get displayName() {
            return localize("Mixed mode distribution", "Répartition du mode mixte");
        },
        get description() {
            return localize(
                "How mixed mode distributes its random picks.",
                "Détermine comment le mode mixte répartit ses tirages aléatoires.",
            );
        },
        get options() {
            return [
                {
                    label: localize("Balance item types", "Équilibrer les types"),
                    value: "balanced",
                    default: true,
                },
                {
                    label: localize(
                        "Every item has the same chance",
                        "Chaque élément a la même chance",
                    ),
                    value: "uniform",
                },
            ] as const;
        },
    },
    emojiPool: {
        type: OptionType.SELECT,
        get displayName() {
            return localize("Emoji source", "Source des emotes");
        },
        get description() {
            return localize(
                "Choose whether random emojis come from favorites or every usable emoji.",
                "Choisis entre les emotes favorites et toutes les emotes utilisables.",
            );
        },
        get options() {
            return [
                {
                    label: localize("Favorite emojis only", "Emotes favorites uniquement"),
                    value: "favorites",
                },
                {
                    label: localize("All usable emojis", "Toutes les emotes utilisables"),
                    value: "all",
                    default: true,
                },
            ] as const;
        },
    },
    stickerPool: {
        type: OptionType.SELECT,
        get displayName() {
            return localize("Sticker source", "Source des stickers");
        },
        get description() {
            return localize(
                "Choose whether random stickers come from favorites or every usable sticker.",
                "Choisis entre les stickers favoris et tous les stickers utilisables.",
            );
        },
        get options() {
            return [
                {
                    label: localize("Favorite stickers only", "Stickers favoris uniquement"),
                    value: "favorites",
                },
                {
                    label: localize("All usable stickers", "Tous les stickers utilisables"),
                    value: "all",
                    default: true,
                },
            ] as const;
        },
    },
    avoidRepeats: {
        type: OptionType.BOOLEAN,
        get displayName() {
            return localize("Avoid repeats", "Éviter les répétitions");
        },
        get description() {
            return localize(
                "Use every available item once in a shuffled order before repeating it.",
                "Utilise chaque élément disponible une fois dans un ordre mélangé avant de le répéter.",
            );
        },
        default: true,
    },
}, {
    gifLabel: {
        disabled() { return !this.store.showGifLabel; },
    },
});

function isFrench() {
    try {
        return LocaleStore.locale?.toLowerCase().startsWith("fr") ?? false;
    } catch {
        return false;
    }
}

function localize(english: string, french: string) {
    return isFrench() ? french : english;
}

function kindLabel(kind: FavoriteKind) {
    const labels: Record<FavoriteKind, [string, string]> = {
        all: ["all favorites", "tous les favoris"],
        gif: ["favorite GIFs", "GIF favoris"],
        emoji: ["favorite emojis", "emotes favorites"],
        sticker: ["favorite stickers", "stickers favoris"],
    };

    return localize(...labels[kind]);
}

function selectedPoolLabel(kind: FavoriteKind) {
    if (kind === "emoji" && settings.store.emojiPool === "all")
        return localize("usable emojis", "emotes utilisables");

    if (kind === "sticker" && settings.store.stickerPool === "all")
        return localize("usable stickers", "stickers utilisables");

    if (
        kind === "all"
        && (settings.store.emojiPool === "all" || settings.store.stickerPool === "all")
    ) {
        return localize(
            "items from the selected pools",
            "éléments des listes sélectionnées",
        );
    }

    return kindLabel(kind);
}

function getFrecencySettings(): FrecencySettings | undefined {
    const actions = UserSettingsActionCreators
        .FrecencyUserSettingsActionCreators as FrecencySettingsActions;

    return actions.getCurrentValue?.();
}

function canUsePermission(channel: Channel, permission: bigint) {
    return channel.isPrivate() || PermissionStore.can(permission, channel);
}

function canSendMessages(channel: Channel) {
    if (channel.isPrivate()) return true;

    const permission = channel.isThread()
        ? PermissionsBits.SEND_MESSAGES_IN_THREADS
        : PermissionsBits.SEND_MESSAGES;

    return PermissionStore.can(permission, channel);
}

function normalizeWebUrl(...values: Array<string | undefined>) {
    for (const value of values) {
        if (!value) continue;

        try {
            const url = new URL(value);
            if (url.protocol === "https:" || url.protocol === "http:")
                return url.toString();
        } catch {
            // Try the next representation. Old Discord GIF entries can have a stale key.
        }
    }

    return undefined;
}

function collectGifs(frecency: FrecencySettings): {
    candidates: FavoriteCandidate[];
    rawCount: number;
} {
    const entries = Object.entries(frecency.favoriteGifs?.gifs ?? {});
    const uniqueCandidates = new Map<string, FavoriteCandidate>();

    for (const [favoriteUrl, gif] of entries) {
        const url = normalizeWebUrl(favoriteUrl, gif?.src);
        if (!url) continue;

        const key = `gif:${url}`;
        uniqueCandidates.set(key, {
            kind: "gif",
            key,
            label: url,
            content: url,
        });
    }

    return {
        candidates: Array.from(uniqueCandidates.values()),
        rawCount: entries.length,
    };
}

function formatEmoji(emoji: Emoji) {
    if (emoji.type === 0) return emoji.surrogates;

    const name = emoji.originalName || emoji.name;
    return `<${emoji.animated ? "a" : ""}:${name}:${emoji.id}>`;
}

function isUsableEmoji(emoji: Emoji, channel: Channel): boolean {
    if (emoji.type === 0) return true;
    if (emoji.available === false) return false;
    if (!EmojiStore.getUsableCustomEmojiById(emoji.id)) return false;

    return (
        !channel.guild_id
        || emoji.guildId === channel.guild_id
        || canUsePermission(channel, PermissionsBits.USE_EXTERNAL_EMOJIS)
    );
}

function collectEmojis(frecency: FrecencySettings, channel: Channel): {
    candidates: FavoriteCandidate[];
    rawCount: number;
} {
    const favoriteKeys = frecency.favoriteEmojis?.emojis ?? [];
    const emojiContext = EmojiStore.getDisambiguatedEmojiContext(channel.guild_id ?? null);
    const scope = settings.store.emojiPool as PoolScope;
    const sourceEmojis = scope === "all"
        ? emojiContext.getDisambiguatedEmoji()
        : emojiContext.favoriteEmojisWithoutFetchingLatest;
    const uniqueCandidates = new Map<string, FavoriteCandidate>();

    for (const emoji of sourceEmojis) {
        if (!isUsableEmoji(emoji, channel)) continue;

        const content = formatEmoji(emoji);
        const identity = emoji.type === 0 ? emoji.surrogates : emoji.id;
        const key = `emoji:${identity}`;

        uniqueCandidates.set(key, {
            kind: "emoji",
            key,
            label: emoji.name,
            content,
        });
    }

    // The official context handles aliases, diversity variants and renamed emojis.
    // If its cache has not been rebuilt yet, resolve the raw setting as a fallback.
    if (scope === "favorites" && uniqueCandidates.size === 0 && favoriteKeys.length > 0) {
        for (const favoriteKey of favoriteKeys) {
            const rawKey = String(favoriteKey);
            const emoji = emojiContext.getById(rawKey) ?? emojiContext.getByName(rawKey);
            if (!emoji || !isUsableEmoji(emoji, channel)) continue;

            const content = formatEmoji(emoji);
            const identity = emoji.type === 0 ? emoji.surrogates : emoji.id;
            const key = `emoji:${identity}`;

            uniqueCandidates.set(key, {
                kind: "emoji",
                key,
                label: emoji.name,
                content,
            });
        }
    }

    return {
        candidates: Array.from(uniqueCandidates.values()),
        rawCount: scope === "all" ? sourceEmojis.length : favoriteKeys.length,
    };
}

function isUsableSticker(sticker: Sticker, channel: Channel) {
    if (sticker.available === false) return false;
    if (!("guild_id" in sticker)) return true;

    return (
        !channel.guild_id
        || sticker.guild_id === channel.guild_id
        || canUsePermission(channel, PermissionsBits.USE_EXTERNAL_STICKERS)
    );
}

function collectStickers(frecency: FrecencySettings, channel: Channel): {
    candidates: FavoriteCandidate[];
    rawCount: number;
} {
    const favoriteIds = frecency.favoriteStickers?.stickerIds ?? [];
    const uniqueCandidates = new Map<string, FavoriteCandidate>();
    const scope = settings.store.stickerPool as PoolScope;

    if (scope === "all") {
        const stickerGroups = [
            ...StickersStore.getAllGuildStickers().values(),
            ...StickersStore.getAllPackStickers().values(),
        ];
        const allStickers = stickerGroups.flat();

        for (const sticker of allStickers) {
            if (!isUsableSticker(sticker, channel)) continue;

            const key = `sticker:${sticker.id}`;
            uniqueCandidates.set(key, {
                kind: "sticker",
                key,
                label: sticker.name,
                stickerId: sticker.id,
            });
        }

        return {
            candidates: Array.from(uniqueCandidates.values()),
            rawCount: allStickers.length,
        };
    }

    for (const favoriteId of favoriteIds) {
        const stickerId = String(favoriteId);
        const sticker = StickersStore.getStickerById(stickerId);
        if (!sticker || !isUsableSticker(sticker, channel)) continue;

        const key = `sticker:${stickerId}`;
        uniqueCandidates.set(key, {
            kind: "sticker",
            key,
            label: sticker.name,
            stickerId,
        });
    }

    return {
        candidates: Array.from(uniqueCandidates.values()),
        rawCount: favoriteIds.length,
    };
}

function emptyPools(): FavoritePools {
    return {
        candidates: { gif: [], emoji: [], sticker: [] },
        rawCounts: { gif: 0, emoji: 0, sticker: 0 },
    };
}

function collectFavoritePools(kind: FavoriteKind, channel: Channel): FavoritePools | undefined {
    const frecency = getFrecencySettings();
    if (!frecency) return undefined;

    const pools = emptyPools();
    const requestedKinds = kind === "all" ? concreteKinds : [kind];

    for (const requestedKind of requestedKinds) {
        const result = requestedKind === "gif"
            ? collectGifs(frecency)
            : requestedKind === "emoji"
                ? collectEmojis(frecency, channel)
                : collectStickers(frecency, channel);

        pools.candidates[requestedKind] = result.candidates;
        pools.rawCounts[requestedKind] = result.rawCount;
    }

    return pools;
}

function randomItem<T>(items: readonly T[]): T | undefined {
    return items.length === 0
        ? undefined
        : items[Math.floor(Math.random() * items.length)];
}

function pickFromKind(kind: ConcreteFavoriteKind, pools: FavoritePools) {
    const candidates = pools.candidates[kind];
    return settings.store.avoidRepeats
        ? candidateBags[kind].take(candidates)
        : randomItem(candidates);
}

function pickCandidate(kind: FavoriteKind, pools: FavoritePools): FavoriteCandidate | undefined {
    if (kind !== "all") return pickFromKind(kind, pools);

    const availableKinds = concreteKinds.filter(
        candidateKind => pools.candidates[candidateKind].length > 0,
    );
    if (availableKinds.length === 0) return undefined;

    if (settings.store.mixMode === "balanced") {
        const selectedKind = settings.store.avoidRepeats
            ? categoryBag.take(availableKinds)
            : randomItem(availableKinds);

        return selectedKind ? pickFromKind(selectedKind, pools) : undefined;
    }

    const allCandidates = availableKinds.flatMap(
        candidateKind => pools.candidates[candidateKind],
    );

    return settings.store.avoidRepeats
        ? allCandidatesBag.take(allCandidates)
        : randomItem(allCandidates);
}

function noCandidateMessage(kind: FavoriteKind, pools: FavoritePools) {
    const requestedKinds = kind === "all" ? concreteKinds : [kind];
    const rawCount = requestedKinds.reduce(
        (total, requestedKind) => total + pools.rawCounts[requestedKind],
        0,
    );

    if (rawCount === 0) {
        return localize(
            `No ${selectedPoolLabel(kind)} were found. Add some favorites in Discord's expression picker or change the pool settings.`,
            `Aucun ${selectedPoolLabel(kind)} trouvé. Ajoute des favoris dans le sélecteur d'expressions de Discord ou modifie les listes dans les réglages.`,
        );
    }

    return localize(
        `${rawCount} ${selectedPoolLabel(kind)} were detected, but none can be used in this channel. Check server permissions, Nitro access, or deleted favorites.`,
        `${rawCount} ${selectedPoolLabel(kind)} détecté(s), mais aucun n'est utilisable dans ce salon. Vérifie les permissions du serveur, l'accès Nitro ou les favoris supprimés.`,
    );
}

function buildReplyOptions(channelId: string) {
    return MessageActions.getSendMessageOptionsForReply(
        PendingReplyStore.getPendingReply(channelId),
    ) ?? {};
}

async function sendCandidate(candidate: FavoriteCandidate, channel: Channel) {
    const options = buildReplyOptions(channel.id);
    const rawContent = candidate.content ?? "";
    const content = candidate.kind === "gif"
        ? formatGifContent(rawContent, {
            label: settings.store.gifLabel,
            maskWithSpoiler: settings.store.maskGifs,
            showLabel: settings.store.showGifLabel,
        })
        : rawContent;

    if (candidate.stickerId)
        options.stickerIds = [candidate.stickerId];

    await sendMessage(
        channel.id,
        { content },
        false,
        options,
    );

    FluxDispatcher.dispatch({
        type: "DELETE_PENDING_REPLY",
        channelId: channel.id,
    });
}

async function sendRandomFavorite(
    kind: FavoriteKind,
    channel: Channel,
): Promise<SendResult> {
    if (activeChannels.has(channel.id)) {
        return {
            ok: false,
            message: localize(
                "A random favorite is already being sent in this channel.",
                "Un favori aléatoire est déjà en cours d'envoi dans ce salon.",
            ),
        };
    }

    if (!canSendMessages(channel)) {
        return {
            ok: false,
            message: localize(
                "You do not have permission to send messages in this channel.",
                "Tu n'as pas la permission d'envoyer des messages dans ce salon.",
            ),
        };
    }

    activeChannels.add(channel.id);

    try {
        const pools = collectFavoritePools(kind, channel);
        if (!pools) {
            return {
                ok: false,
                message: localize(
                    "Discord has not loaded your synced favorites yet. Open an expression picker once, then try again.",
                    "Discord n'a pas encore chargé tes favoris synchronisés. Ouvre une fois un sélecteur d'expressions, puis réessaie.",
                ),
            };
        }

        const candidate = pickCandidate(kind, pools);
        if (!candidate)
            return { ok: false, message: noCandidateMessage(kind, pools) };

        await sendCandidate(candidate, channel);
        return { ok: true, candidate };
    } catch (error) {
        logger.error(`Failed to send a random ${kind}`, error);

        return {
            ok: false,
            message: localize(
                "Discord refused to send this favorite. It may have been deleted or become unavailable.",
                "Discord a refusé d'envoyer ce favori. Il a peut-être été supprimé ou n'est plus disponible.",
            ),
        };
    } finally {
        activeChannels.delete(channel.id);
    }
}

async function runFromCommand(kind: FavoriteKind, channel: Channel) {
    const result = await sendRandomFavorite(kind, channel);
    if (!result.ok)
        sendBotMessage(channel.id, { content: `🎲 ${result.message}` });
}

async function runFromButton(kind: FavoriteKind, channel: Channel) {
    const result = await sendRandomFavorite(kind, channel);
    if (!result.ok)
        showToast(result.message, Toasts.Type.FAILURE);
}

function favoriteStats(channel: Channel) {
    const pools = collectFavoritePools("all", channel);
    if (!pools) {
        return localize(
            "Discord has not loaded the synced favorites settings yet.",
            "Discord n'a pas encore chargé les réglages de favoris synchronisés.",
        );
    }

    const line = (kind: ConcreteFavoriteKind, icon: string) =>
        `${icon} ${kindLabel(kind)}: **${pools.candidates[kind].length}** / ${pools.rawCounts[kind]}`;

    return [
        localize(
            "**Random Favorites — usable / detected**",
            "**Random Favorites — utilisables / détectés**",
        ),
        line("gif", "🖼️"),
        line("emoji", "😄"),
        line("sticker", "🏷️"),
    ].join("\n");
}

function RandomFavoritesIcon({
    height = 24,
    width = 24,
}: {
    height?: number | string;
    width?: number | string;
}) {
    return (
        <svg
            aria-hidden="true"
            role="img"
            viewBox="0 0 24 24"
            height={height}
            width={width}
            fill="none"
        >
            <rect
                x="3.25"
                y="3.25"
                width="17.5"
                height="17.5"
                rx="4"
                stroke="currentColor"
                strokeWidth="2"
            />
            <circle cx="8" cy="8" r="1.35" fill="currentColor" />
            <circle cx="16" cy="8" r="1.35" fill="currentColor" />
            <circle cx="12" cy="12" r="1.35" fill="currentColor" />
            <circle cx="8" cy="16" r="1.35" fill="currentColor" />
            <circle cx="16" cy="16" r="1.35" fill="currentColor" />
        </svg>
    );
}

function RandomFavoritesMenu({ channel }: { channel: Channel; }) {
    return (
        <Menu.Menu
            navId="random-favorites"
            onClose={ContextMenuApi.closeContextMenu}
            aria-label="Random Favorites"
        >
            <Menu.MenuGroup
                label={localize("Send a random favorite", "Envoyer un favori aléatoire")}
            >
                <Menu.MenuItem
                    id="random-favorites-all"
                    label={localize("Anything", "Tout")}
                    action={() => void runFromButton("all", channel)}
                />
                <Menu.MenuItem
                    id="random-favorites-gif"
                    label="GIF"
                    action={() => void runFromButton("gif", channel)}
                />
                <Menu.MenuItem
                    id="random-favorites-emoji"
                    label={localize("Emoji", "Emote")}
                    action={() => void runFromButton("emoji", channel)}
                />
                <Menu.MenuItem
                    id="random-favorites-sticker"
                    label="Sticker"
                    action={() => void runFromButton("sticker", channel)}
                />
            </Menu.MenuGroup>
            <Menu.MenuSeparator />
            <Menu.MenuItem
                id="random-favorites-stats"
                label={localize("Show favorite counts", "Afficher le nombre de favoris")}
                action={() => sendBotMessage(channel.id, { content: favoriteStats(channel) })}
            />
        </Menu.Menu>
    );
}

const RandomFavoritesButton: ChatBarButtonFactory = ({
    channel,
    disabled,
    isAnyChat,
}) => {
    const pluginSettings = settings.use(["showChatBarButton", "defaultKind"]);

    if (
        !isAnyChat
        || disabled
        || !pluginSettings.showChatBarButton
        || !canSendMessages(channel)
    ) return null;

    const defaultKind = pluginSettings.defaultKind as FavoriteKind;
    const tooltip = localize(
        `Send random ${kindLabel(defaultKind)} · Right-click to choose`,
        `Envoyer ${kindLabel(defaultKind)} au hasard · Clic droit pour choisir`,
    );

    return (
        <ChatBarButton
            tooltip={tooltip}
            onClick={() => void runFromButton(defaultKind, channel)}
            onContextMenu={event => {
                event.preventDefault();
                ContextMenuApi.openContextMenu(
                    event,
                    () => <RandomFavoritesMenu channel={channel} />,
                );
            }}
        >
            <RandomFavoritesIcon />
        </ChatBarButton>
    );
};

function makeFixedKindCommand(
    name: string,
    description: string,
    kind: ConcreteFavoriteKind,
): Command {
    return {
        name,
        description,
        inputType: ApplicationCommandInputType.BUILT_IN,
        execute: async (_, { channel }) => runFromCommand(kind, channel),
    };
}

const commands: Command[] = [
    {
        name: "random-favorite",
        description: "Send a random item from your Discord favorites",
        inputType: ApplicationCommandInputType.BUILT_IN,
        options: [{
            name: "type",
            description: "Limit the random selection to one favorite type",
            type: ApplicationCommandOptionType.STRING,
            required: false,
            choices: [
                { name: "All favorites", label: "All favorites", value: "all" },
                { name: "GIF", label: "GIF", value: "gif" },
                { name: "Emoji", label: "Emoji", value: "emoji" },
                { name: "Sticker", label: "Sticker", value: "sticker" },
            ],
        }],
        execute: async (args, { channel }) => {
            const kind = findOption<FavoriteKind>(args, "type", "all");
            await runFromCommand(kind, channel);
        },
    },
    makeFixedKindCommand(
        "random-gif",
        "Send a random GIF from your Discord favorites",
        "gif",
    ),
    makeFixedKindCommand(
        "random-emoji",
        "Send a random emoji from your Discord favorites",
        "emoji",
    ),
    makeFixedKindCommand(
        "random-sticker",
        "Send a random sticker from your Discord favorites",
        "sticker",
    ),
    {
        name: "random-favorite-stats",
        description: "Show how many saved favorites are currently usable",
        inputType: ApplicationCommandInputType.BUILT_IN,
        execute: (_, { channel }) => {
            sendBotMessage(channel.id, { content: favoriteStats(channel) });
        },
    },
];

export default definePlugin({
    name: "RandomFavorites",
    description: "Send a random favorite GIF, emoji, sticker, or a balanced mix.",
    authors: [{ name: "Yuzuctus", id: 0n }],
    tags: ["Chat", "Commands", "Emotes", "Fun", "Media"],
    settings,
    commands,

    chatBarButton: {
        icon: RandomFavoritesIcon,
        render: RandomFavoritesButton,
    },

    stop() {
        activeChannels.clear();
        allCandidatesBag.clear();
        categoryBag.clear();
        concreteKinds.forEach(kind => candidateBags[kind].clear());
    },
});
