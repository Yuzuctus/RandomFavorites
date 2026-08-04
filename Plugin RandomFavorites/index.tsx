/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

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
import {
    Channel,
    Command,
    Emoji,
    RenderModalProps,
    SoundboardSound,
    Sticker,
} from "@vencord/discord-types";
import { findByCodeLazy, findByPropsLazy } from "@webpack";
import {
    ChannelStore,
    ContextMenuApi,
    EmojiStore,
    FluxDispatcher,
    GuildStore,
    LocaleStore,
    Menu,
    MessageActions,
    Modal,
    openModal,
    Parser,
    PendingReplyStore,
    PermissionsBits,
    PermissionStore,
    SelectedChannelStore,
    SelectedGuildStore,
    showToast,
    SoundboardStore,
    StickersStore,
    Toasts,
    useEffect,
    useRef,
    UserSettingsActionCreators,
    UserStore,
    useState,
} from "@webpack/common";
import type { ComponentProps, ReactNode, Ref } from "react";

import { AdaptiveRandomPicker, type RepeatStrength } from "./adaptiveRandom";
import { formatGifContent } from "./messageFormatting";
import {
    buildGifPreviewSources,
    type FavoriteGifMedia,
    type PreviewSource,
    resolveGifContentUrl,
} from "./previewMedia";
import { buildSelectionPlan } from "./selectionPlan";
import {
    collectUsableSoundboardSounds,
    insertRandomSoundboardCategory,
    RANDOM_SOUNDBOARD_CATEGORY_KEY,
    soundboardCandidateKey,
    type SoundboardCategory,
} from "./soundboardPool";
import { pickUniform } from "./uniformRandom";

type FavoriteKind = "all" | "gif" | "emoji" | "sticker";
type ConcreteFavoriteKind = Exclude<FavoriteKind, "all">;
type MixMode = "balanced" | "uniform";
type PoolScope = "favorites" | "all";

interface FavoriteGif extends FavoriteGifMedia {
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
    previewType?: "image" | "lottie";
    previewUrl?: string;
    previewSources?: PreviewSource[];
    stickerId?: string;
}

interface FavoritePools {
    candidates: Record<ConcreteFavoriteKind, FavoriteCandidate[]>;
    rawCounts: Record<ConcreteFavoriteKind, number>;
}

type SendResult =
    | { ok: true; candidate: FavoriteCandidate; }
    | { ok: false; message: string; };

interface SelectedSendResult {
    sentCount: number;
    errors: string[];
}

interface FavoriteDrawResult {
    candidates: FavoriteCandidate[];
    errors: string[];
}

interface SoundboardDrawResult {
    error?: string;
    sound?: SoundboardSound;
}

interface SoundboardSendPreparation {
    channel?: Channel;
    error?: string;
    sound?: SoundboardSound;
}

type RandomSoundboardAction = "direct" | "preview";

interface RandomSoundboardGridItem {
    randomFavoritesAction: RandomSoundboardAction;
    type: number;
}

interface RandomSoundboardRowDescriptor {
    item?: RandomSoundboardGridItem;
}

type RandomSoundboardGridItemProps = Omit<ComponentProps<"button">, "ref"> & {
    ref?: Ref<HTMLLIElement>;
};

type CanUseSoundboardSound = (
    user: unknown,
    sound: SoundboardSound,
    channel: Channel,
    requireAvailable?: boolean,
) => boolean;

type SendSoundboardSound = (
    sound: SoundboardSound,
    channelId: string,
    analyticsLocations: unknown[],
    sequenceNumber?: number,
) => void;

type GetSoundboardSoundUrl = (soundId: string) => string;

const logger = new Logger("RandomFavorites");
const LottiePlayer = findByPropsLazy("loadAnimation") as {
    loadAnimation(options: {
        autoplay: boolean;
        container: HTMLElement;
        loop: boolean;
        path: string;
        renderer: "svg";
    }): { destroy(): void; };
};
const canUseSoundboardSound = findByCodeLazy(
    ".canUseSoundboardEverywhere(",
    ".guildId===",
    ".available",
) as CanUseSoundboardSound;
const sendSoundboardSound = findByCodeLazy(
    "SOUNDBOARD_TRACK_USAGE",
    "source_guild_id",
    "SEND_SOUNDBOARD_SOUND",
) as SendSoundboardSound;
const getSoundboardSoundUrl = findByCodeLazy(
    "CDN_HOST",
    ".SOUNDBOARD_SOUND(",
) as GetSoundboardSoundUrl;
const activeChannels = new Set<string>();
const concreteKinds: ConcreteFavoriteKind[] = ["gif", "emoji", "sticker"];
const randomSoundboardGridItems: RandomSoundboardGridItem[] = [
    { type: -1, randomFavoritesAction: "direct" },
    { type: -1, randomFavoritesAction: "preview" },
];

const candidatePicker = new AdaptiveRandomPicker<FavoriteCandidate>(candidate => candidate.key);
const kindPicker = new AdaptiveRandomPicker<ConcreteFavoriteKind>(kind => kind);
const soundboardPicker = new AdaptiveRandomPicker<SoundboardSound>(soundboardCandidateKey);

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
    previewBeforeSend: {
        type: OptionType.BOOLEAN,
        get displayName() {
            return localize("Safe preview before sending", "Aperçu sécurisé avant envoi");
        },
        get description() {
            return localize(
                "Show random GIFs, emojis, and stickers privately before sending them.",
                "Affiche les GIFs, emotes et stickers aléatoires en privé avant de les envoyer.",
            );
        },
        default: false,
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
    sendEachSelectedType: {
        type: OptionType.BOOLEAN,
        get displayName() {
            return localize(
                "One item from each selected type",
                "Un élément de chaque type coché",
            );
        },
        get description() {
            return localize(
                "When enabled, a left click sends one item from every selected type. When disabled, it sends only one item chosen from all selected types.",
                "Activé, le clic gauche envoie un élément de chaque type coché. Désactivé, il envoie un seul élément choisi parmi tous les types cochés.",
            );
        },
        default: true,
    },
    sendGifsOnLeftClick: {
        type: OptionType.BOOLEAN,
        get displayName() {
            return localize("GIFs on left click", "GIFs au clic gauche");
        },
        get description() {
            return localize(
                "Send one random favorite GIF when left-clicking the chat bar button.",
                "Envoie un GIF favori aléatoire avec le clic gauche sur le bouton de la barre de chat.",
            );
        },
        default: true,
    },
    sendEmojisOnLeftClick: {
        type: OptionType.BOOLEAN,
        get displayName() {
            return localize("Emojis on left click", "Emotes au clic gauche");
        },
        get description() {
            return localize(
                "Send one random emoji when left-clicking the chat bar button.",
                "Envoie une emote aléatoire avec le clic gauche sur le bouton de la barre de chat.",
            );
        },
        default: true,
    },
    sendStickersOnLeftClick: {
        type: OptionType.BOOLEAN,
        get displayName() {
            return localize("Stickers on left click", "Stickers au clic gauche");
        },
        get description() {
            return localize(
                "Send one random sticker when left-clicking the chat bar button.",
                "Envoie un sticker aléatoire avec le clic gauche sur le bouton de la barre de chat.",
            );
        },
        default: true,
    },
    mixMode: {
        type: OptionType.SELECT,
        get displayName() {
            return localize(
                "Mixed-mode type distribution",
                "Répartition des types en mode mixte",
            );
        },
        get description() {
            return localize(
                "How single-item mode and /random-favorite choose between the allowed types.",
                "Détermine comment le mode unique et /random-favorite choisissent entre les types autorisés.",
            );
        },
        get options() {
            return [
                {
                    label: localize(
                        "Balanced distribution (equal base weight per type)",
                        "Répartition équilibrée (même poids de base par type)",
                    ),
                    value: "balanced",
                    default: true,
                },
                {
                    label: localize(
                        "Fully random (equal chance per item)",
                        "Totalement aléatoire (même chance par élément)",
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
            return localize("Reduce repeats", "Limiter les répétitions");
        },
        get description() {
            return localize(
                "Lower the odds of recent items without ever excluding them completely.",
                "Réduit la probabilité des éléments récents sans jamais les exclure complètement.",
            );
        },
        default: true,
    },
    repeatStrength: {
        type: OptionType.SELECT,
        get displayName() {
            return localize(
                "Repeat reduction strength",
                "Intensité anti-répétition",
            );
        },
        get description() {
            return localize(
                "Controls how quickly recent items recover their normal odds.",
                "Contrôle la vitesse à laquelle les éléments récents retrouvent leur probabilité normale.",
            );
        },
        get options() {
            return [
                {
                    label: localize("Light (more surprises)", "Légère (plus de surprises)"),
                    value: "light",
                },
                {
                    label: localize("Balanced", "Équilibrée"),
                    value: "balanced",
                    default: true,
                },
                {
                    label: localize("Strong (fewer repeats)", "Forte (moins de répétitions)"),
                    value: "strong",
                },
            ] as const;
        },
    },
}, {
    gifLabel: {
        disabled() { return !this.store.showGifLabel; },
    },
    repeatStrength: {
        disabled() { return !this.store.avoidRepeats; },
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

function getConnectedVoiceChannel(): Channel | undefined {
    const channelId = SelectedChannelStore.getVoiceChannelId();
    return channelId ? ChannelStore.getChannel(channelId) : undefined;
}

function soundboardChannelError(channel?: Channel): string | undefined {
    if (!channel) {
        return localize(
            "Join a voice channel before using the random soundboard.",
            "Rejoins un salon vocal avant d'utiliser le soundboard aléatoire.",
        );
    }

    if (channel.isPrivate()) return;

    if (!channel.isGuildVoiceOrThread()) {
        return localize(
            "The current voice channel does not support the soundboard.",
            "Le salon vocal actuel ne prend pas en charge le soundboard.",
        );
    }

    if (
        !PermissionStore.can(PermissionsBits.SPEAK, channel)
        || !PermissionStore.can(PermissionsBits.USE_SOUNDBOARD, channel)
    ) {
        return localize(
            "You do not have permission to use the soundboard in this voice channel.",
            "Tu n'as pas la permission d'utiliser le soundboard dans ce salon vocal.",
        );
    }
}

function collectSoundboardCandidates(channel: Channel) {
    const user = UserStore.getCurrentUser();
    if (!user) return [];

    return collectUsableSoundboardSounds(
        SoundboardStore.getSounds().values(),
        sound => sound.available !== false
            && canUseSoundboardSound(user, sound, channel, true),
    );
}

function drawRandomSoundboard(): SoundboardDrawResult {
    const channel = getConnectedVoiceChannel();
    const channelError = soundboardChannelError(channel);
    if (channelError || !channel)
        return { error: channelError };

    let sounds: SoundboardSound[];
    try {
        sounds = collectSoundboardCandidates(channel);
    } catch (error) {
        logger.error("Failed to resolve Discord's soundboard sounds", error);
        return {
            error: localize(
                "Discord's soundboard data could not be read. Close and reopen the soundboard, then try again.",
                "Les données du soundboard Discord sont illisibles. Ferme et rouvre le soundboard, puis réessaie.",
            ),
        };
    }

    if (sounds.length === 0) {
        return {
            error: SoundboardStore.isFetchingAnySounds()
                ? localize(
                    "Discord is still loading the soundboard. Try again in a moment.",
                    "Discord charge encore le soundboard. Réessaie dans un instant.",
                )
                : localize(
                    "No soundboard sound is currently usable in this voice channel.",
                    "Aucun son du soundboard n'est actuellement utilisable dans ce salon vocal.",
                ),
        };
    }

    const sound = settings.store.avoidRepeats
        ? soundboardPicker.take(sounds, selectedRepeatStrength())
        : pickUniform(sounds);

    return sound
        ? { sound }
        : {
            error: localize(
                "No random sound could be selected.",
                "Aucun son aléatoire n'a pu être sélectionné.",
            ),
        };
}

function prepareSoundboardSend(sound: SoundboardSound): SoundboardSendPreparation {
    const channel = getConnectedVoiceChannel();
    const channelError = soundboardChannelError(channel);
    if (channelError || !channel)
        return { error: channelError };

    try {
        const currentSound = SoundboardStore.getSound(sound.guildId, sound.soundId);
        const user = UserStore.getCurrentUser();
        const isStillUsable = currentSound != null
            && user != null
            && canUseSoundboardSound(user, currentSound, channel, true);

        return isStillUsable
            ? { channel, sound: currentSound }
            : {
                error: localize(
                    "This sound is no longer usable. Draw another one before confirming.",
                    "Ce son n'est plus utilisable. Relance le tirage avant de confirmer.",
                ),
            };
    } catch (error) {
        logger.error("Failed to revalidate a soundboard sound", error);
        return {
            error: localize(
                "Discord could not validate this soundboard sound.",
                "Discord n'a pas pu valider ce son du soundboard.",
            ),
        };
    }
}

function playSoundboardSelection(sound: SoundboardSound) {
    const prepared = prepareSoundboardSend(sound);
    if (prepared.error || !prepared.channel || !prepared.sound) {
        showToast(prepared.error ?? localize(
            "Discord could not validate this soundboard sound.",
            "Discord n'a pas pu valider ce son du soundboard.",
        ), Toasts.Type.FAILURE);
        return false;
    }

    try {
        sendSoundboardSound(prepared.sound, prepared.channel.id, []);
        return true;
    } catch (error) {
        logger.error("Discord refused to play a random soundboard sound", error);
        showToast(localize(
            "Discord could not play this sound in the voice channel.",
            "Discord n'a pas pu jouer ce son dans le salon vocal.",
        ), Toasts.Type.FAILURE);
        return false;
    }
}

function soundboardInsertionGuildId() {
    return getConnectedVoiceChannel()?.guild_id
        ?? SelectedGuildStore.getGuildId()
        ?? undefined;
}

type SoundboardGuild = NonNullable<
    NonNullable<SoundboardCategory["categoryInfo"]>["guild"]
>;

function createRandomSoundboardGuild(
    baseGuild: SoundboardGuild,
    currentGuildId: string,
): SoundboardGuild {
    const virtualGuild = Object.create(baseGuild) as SoundboardGuild;

    Object.defineProperties(virtualGuild, {
        id: { value: currentGuildId, enumerable: true },
        name: { value: "FavoriteRandom", enumerable: true },
        acronym: { value: "FR", enumerable: true },
        icon: { value: null, enumerable: true },
        iconHash: { value: null, enumerable: true },
        getIconURL: { value: () => null },
    });

    return virtualGuild;
}

function addRandomSoundboardCategory(
    categories: readonly SoundboardCategory[],
): readonly SoundboardCategory[] {
    const currentGuildId = soundboardInsertionGuildId();
    if (!currentGuildId) return categories;

    const guildCategory = categories.find(
        category => category.categoryInfo?.guild?.id === currentGuildId,
    ) ?? categories.find(category => category.categoryInfo?.guild != null);
    const categoryType = guildCategory?.categoryInfo?.type;
    const baseGuild = GuildStore.getGuild(currentGuildId)
        ?? guildCategory?.categoryInfo?.guild;

    if (categoryType == null || !baseGuild) return categories;

    return insertRandomSoundboardCategory(
        categories,
        {
            key: RANDOM_SOUNDBOARD_CATEGORY_KEY,
            categoryInfo: {
                type: categoryType,
                guild: createRandomSoundboardGuild(baseGuild, currentGuildId),
                isNitroLocked: false,
            },
            items: randomSoundboardGridItems,
        },
        currentGuildId,
    );
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

function shortKindLabel(kind: ConcreteFavoriteKind) {
    const labels: Record<ConcreteFavoriteKind, [string, string]> = {
        gif: ["GIF", "GIF"],
        emoji: ["emoji", "emote"],
        sticker: ["sticker", "sticker"],
    };

    return localize(...labels[kind]);
}

function selectedLeftClickKinds() {
    const enabled: Record<ConcreteFavoriteKind, boolean> = {
        gif: settings.store.sendGifsOnLeftClick,
        emoji: settings.store.sendEmojisOnLeftClick,
        sticker: settings.store.sendStickersOnLeftClick,
    };

    return concreteKinds.filter(kind => enabled[kind]);
}

function selectedKindsLabel(kinds: readonly ConcreteFavoriteKind[]) {
    if (kinds.length === 0)
        return localize("nothing selected", "aucune sélection");

    return kinds.map(shortKindLabel).join(" + ");
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

function collectGifs(frecency: FrecencySettings): {
    candidates: FavoriteCandidate[];
    rawCount: number;
} {
    const entries = Object.entries(frecency.favoriteGifs?.gifs ?? {});
    const uniqueCandidates = new Map<string, FavoriteCandidate>();

    for (const [favoriteUrl, gif] of entries) {
        const contentUrl = resolveGifContentUrl(favoriteUrl, gif ?? {});
        if (!contentUrl) continue;

        const key = `gif:${contentUrl}`;
        uniqueCandidates.set(key, {
            kind: "gif",
            key,
            label: contentUrl,
            content: contentUrl,
            previewSources: buildGifPreviewSources(favoriteUrl, gif ?? {}),
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

function getStickerPreview(sticker: Sticker): Pick<FavoriteCandidate, "previewType" | "previewUrl"> {
    if (sticker.format_type === 4) {
        return {
            previewType: "image",
            previewUrl: `https:${window.GLOBAL_ENV.MEDIA_PROXY_ENDPOINT}/stickers/${sticker.id}.gif?size=320&lossless=true`,
        };
    }

    const isLottie = sticker.format_type === 3;
    return {
        previewType: isLottie ? "lottie" : "image",
        previewUrl: `https://${window.GLOBAL_ENV.CDN_HOST}/stickers/${sticker.id}.${isLottie ? "json" : "png"}?size=320&lossless=true`,
    };
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
                ...getStickerPreview(sticker),
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
            ...getStickerPreview(sticker),
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

function selectedRepeatStrength(): RepeatStrength {
    return settings.store.repeatStrength ?? "balanced";
}

function pickFromKind(kind: ConcreteFavoriteKind, pools: FavoritePools) {
    const candidates = pools.candidates[kind];
    return settings.store.avoidRepeats
        ? candidatePicker.take(
            candidates,
            selectedRepeatStrength(),
        )
        : pickUniform(candidates);
}

function pickCandidateFromKinds(
    kinds: readonly ConcreteFavoriteKind[],
    pools: FavoritePools,
): FavoriteCandidate | undefined {
    const availableKinds = kinds.filter(
        candidateKind => pools.candidates[candidateKind].length > 0,
    );
    if (availableKinds.length === 0) return undefined;

    if (settings.store.mixMode === "balanced") {
        const selectedKind = settings.store.avoidRepeats
            ? kindPicker.take(
                availableKinds,
                selectedRepeatStrength(),
            )
            : pickUniform(availableKinds);

        return selectedKind ? pickFromKind(selectedKind, pools) : undefined;
    }

    const allCandidates = availableKinds.flatMap(
        candidateKind => pools.candidates[candidateKind],
    );

    return settings.store.avoidRepeats
        ? candidatePicker.take(
            allCandidates,
            selectedRepeatStrength(),
        )
        : pickUniform(allCandidates);
}

function pickCandidate(kind: FavoriteKind, pools: FavoritePools): FavoriteCandidate | undefined {
    return kind === "all"
        ? pickCandidateFromKinds(concreteKinds, pools)
        : pickFromKind(kind, pools);
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

function noCandidateMessageForKinds(
    kinds: readonly ConcreteFavoriteKind[],
    pools: FavoritePools,
) {
    const rawCount = kinds.reduce(
        (total, kind) => total + pools.rawCounts[kind],
        0,
    );
    const selection = selectedKindsLabel(kinds);

    if (rawCount === 0) {
        return localize(
            `No items were found for the selected types (${selection}). Add some favorites in Discord's expression picker or change the pool settings.`,
            `Aucun élément trouvé pour les types cochés (${selection}). Ajoute des favoris dans le sélecteur d'expressions de Discord ou modifie les listes dans les réglages.`,
        );
    }

    return localize(
        `${rawCount} items were detected for the selected types (${selection}), but none can be used in this channel. Check server permissions, Nitro access, or deleted favorites.`,
        `${rawCount} élément(s) détecté(s) pour les types cochés (${selection}), mais aucun n'est utilisable dans ce salon. Vérifie les permissions du serveur, l'accès Nitro ou les favoris supprimés.`,
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

function drawRandomFavorite(kind: FavoriteKind, channel: Channel): FavoriteDrawResult {
    const pools = collectFavoritePools(kind, channel);
    if (!pools) {
        return {
            candidates: [],
            errors: [localize(
                "Discord has not loaded your synced favorites yet. Open an expression picker once, then try again.",
                "Discord n'a pas encore chargé tes favoris synchronisés. Ouvre une fois un sélecteur d'expressions, puis réessaie.",
            )],
        };
    }

    const candidate = pickCandidate(kind, pools);
    return candidate
        ? { candidates: [candidate], errors: [] }
        : { candidates: [], errors: [noCandidateMessage(kind, pools)] };
}

function drawSelectedFavorites(
    kinds: readonly ConcreteFavoriteKind[],
    sendEachSelectedType: boolean,
    channel: Channel,
): FavoriteDrawResult {
    if (kinds.length === 0) {
        return {
            candidates: [],
            errors: [localize(
                "Select at least one type with a right click first.",
                "Sélectionne d'abord au moins un type avec un clic droit.",
            )],
        };
    }

    const pools = collectFavoritePools("all", channel);
    if (!pools) {
        return {
            candidates: [],
            errors: [localize(
                "Discord has not loaded your synced favorites yet. Open an expression picker once, then try again.",
                "Discord n'a pas encore chargé tes favoris synchronisés. Ouvre une fois un sélecteur d'expressions, puis réessaie.",
            )],
        };
    }

    const plan = buildSelectionPlan(
        kinds,
        sendEachSelectedType,
        kind => pickFromKind(kind, pools),
        selectedKinds => pickCandidateFromKinds(selectedKinds, pools),
    );
    const errors = plan.missingKinds.map(kind => noCandidateMessage(kind, pools));

    if (!sendEachSelectedType && plan.candidates.length === 0)
        errors.push(noCandidateMessageForKinds(kinds, pools));

    return { candidates: plan.candidates, errors };
}

async function sendPreparedFavorites(
    candidates: readonly FavoriteCandidate[],
    channel: Channel,
): Promise<SelectedSendResult> {
    if (activeChannels.has(channel.id)) {
        return {
            sentCount: 0,
            errors: [localize(
                "Random items are already being sent in this channel.",
                "Des éléments aléatoires sont déjà en cours d'envoi dans ce salon.",
            )],
        };
    }

    if (!canSendMessages(channel)) {
        return {
            sentCount: 0,
            errors: [localize(
                "You do not have permission to send messages in this channel.",
                "Tu n'as pas la permission d'envoyer des messages dans ce salon.",
            )],
        };
    }

    activeChannels.add(channel.id);

    try {
        let sentCount = 0;
        const errors: string[] = [];

        for (const candidate of candidates) {
            try {
                await sendCandidate(candidate, channel);
                sentCount++;
            } catch (error) {
                logger.error(
                    `Failed to send a random ${candidate.kind} from the selected batch`,
                    error,
                );
                errors.push(localize(
                    `Discord refused to send the random ${shortKindLabel(candidate.kind)}. It may have been deleted or become unavailable.`,
                    `Discord a refusé d'envoyer ${shortKindLabel(candidate.kind) === "emote" ? "l'emote" : `le ${shortKindLabel(candidate.kind)}`} aléatoire. L'élément a peut-être été supprimé ou n'est plus disponible.`,
                ));
            }
        }

        return { sentCount, errors };
    } finally {
        activeChannels.delete(channel.id);
    }
}

async function sendRandomFavorite(
    kind: FavoriteKind,
    channel: Channel,
): Promise<SendResult> {
    const draw = drawRandomFavorite(kind, channel);
    if (draw.candidates.length === 0)
        return { ok: false, message: draw.errors[0] };

    const result = await sendPreparedFavorites(draw.candidates, channel);
    return result.sentCount > 0
        ? { ok: true, candidate: draw.candidates[0] }
        : { ok: false, message: result.errors[0] };
}

async function sendSelectedFavorites(
    kinds: readonly ConcreteFavoriteKind[],
    sendEachSelectedType: boolean,
    channel: Channel,
): Promise<SelectedSendResult> {
    const draw = drawSelectedFavorites(kinds, sendEachSelectedType, channel);
    if (draw.candidates.length === 0)
        return { sentCount: 0, errors: draw.errors };

    const result = await sendPreparedFavorites(draw.candidates, channel);
    return {
        sentCount: result.sentCount,
        errors: [...draw.errors, ...result.errors],
    };
}

function showDrawErrors(errors: readonly string[]) {
    if (errors.length > 0)
        showToast(errors.join("\n"), Toasts.Type.FAILURE);
}

function previewKindLabel(kind: ConcreteFavoriteKind) {
    const labels: Record<ConcreteFavoriteKind, [string, string]> = {
        gif: ["Random GIF", "GIF aléatoire"],
        emoji: ["Random emoji", "Emote aléatoire"],
        sticker: ["Random sticker", "Sticker aléatoire"],
    };

    return localize(...labels[kind]);
}

function LottieStickerPreview({ label, url }: { label: string; url: string; }) {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!containerRef.current) return;

        const animation = LottiePlayer.loadAnimation({
            autoplay: true,
            container: containerRef.current,
            loop: true,
            path: url,
            renderer: "svg",
        });

        return () => animation.destroy();
    }, [url]);

    return (
        <div
            ref={containerRef}
            role="img"
            aria-label={label}
            className="vc-rf-preview-lottie"
        />
    );
}

function FavoriteMediaPreview({ candidate }: { candidate: FavoriteCandidate; }) {
    const fallbackSource = candidate.previewUrl
        ? [{ type: candidate.previewType ?? "image", url: candidate.previewUrl } as const]
        : [];
    const sources = candidate.previewSources ?? fallbackSource;
    const [sourceIndex, setSourceIndex] = useState(0);
    const source = sources[sourceIndex];

    useEffect(() => setSourceIndex(0), [candidate.key]);

    if (source?.type === "lottie")
        return <LottieStickerPreview label={candidate.label} url={source.url} />;

    if (source?.type === "video") {
        return (
            <video
                src={source.url}
                aria-label={candidate.label}
                className="vc-rf-preview-image"
                autoPlay
                loop
                muted
                playsInline
                onError={() => setSourceIndex(index => index + 1)}
            />
        );
    }

    if (source) {
        return (
            <img
                src={source.url}
                alt={candidate.label}
                className="vc-rf-preview-image"
                onError={() => setSourceIndex(index => index + 1)}
            />
        );
    }

    if (candidate.kind === "emoji" && candidate.content) {
        return (
            <div className="vc-rf-preview-emoji">
                {Parser.parse(candidate.content)}
            </div>
        );
    }

    return (
        <div className="vc-rf-preview-fallback">
            <RandomFavoritesIcon height={44} width={44} />
            <span>{localize("Preview unavailable", "Aperçu indisponible")}</span>
        </div>
    );
}

function FavoritePreviewCard({ candidate }: { candidate: FavoriteCandidate; }) {
    return (
        <article className="vc-rf-preview-card">
            <div className="vc-rf-preview-media">
                <FavoriteMediaPreview candidate={candidate} />
            </div>
            <div className="vc-rf-preview-meta">
                <strong>{previewKindLabel(candidate.kind)}</strong>
                <span title={candidate.label}>{candidate.label}</span>
            </div>
        </article>
    );
}

function RandomFavoritesPreviewModal({
    channel,
    drawAgain,
    initialDraw,
    modalProps,
}: {
    channel: Channel;
    drawAgain: () => FavoriteDrawResult;
    initialDraw: FavoriteDrawResult;
    modalProps: RenderModalProps;
}) {
    const [candidates, setCandidates] = useState(initialDraw.candidates);
    const [isSending, setIsSending] = useState(false);

    function reroll() {
        const draw = drawAgain();
        showDrawErrors(draw.errors);
        if (draw.candidates.length > 0)
            setCandidates(draw.candidates);
    }

    async function confirmSend() {
        setIsSending(true);
        try {
            const result = await sendPreparedFavorites(candidates, channel);
            showDrawErrors(result.errors);
            if (result.sentCount > 0)
                modalProps.onClose();
        } finally {
            setIsSending(false);
        }
    }

    return (
        <Modal
            {...modalProps}
            title={localize("Safe random preview", "Aperçu aléatoire sécurisé")}
            subtitle={localize(
                "Nothing will be sent until you confirm this selection.",
                "Rien ne sera envoyé avant ta confirmation.",
            )}
            actions={[
                {
                    text: localize("Cancel", "Annuler"),
                    variant: "secondary",
                    disabled: isSending,
                    onClick: modalProps.onClose,
                },
                {
                    text: localize("Draw again", "Relancer"),
                    variant: "secondary",
                    disabled: isSending,
                    onClick: reroll,
                },
                {
                    text: isSending
                        ? localize("Sending…", "Envoi…")
                        : localize(
                            candidates.length > 1 ? `Send ${candidates.length} items` : "Send",
                            candidates.length > 1 ? `Envoyer les ${candidates.length} éléments` : "Envoyer",
                        ),
                    variant: "primary",
                    disabled: isSending || candidates.length === 0,
                    onClick: () => void confirmSend(),
                },
            ]}
        >
            <div
                className={`vc-rf-preview-grid${candidates.length === 1 ? " vc-rf-preview-grid-single" : ""}`}
            >
                {candidates.map(candidate => (
                    <FavoritePreviewCard candidate={candidate} key={candidate.key} />
                ))}
            </div>
            <p className="vc-rf-preview-hint">
                {localize(
                    "Draw again changes the private selection without posting anything.",
                    "Relancer change uniquement l'aperçu privé, sans rien publier.",
                )}
            </p>
        </Modal>
    );
}

function openFavoritePreview(channel: Channel, drawAgain: () => FavoriteDrawResult) {
    if (!canSendMessages(channel)) {
        showDrawErrors([localize(
            "You do not have permission to send messages in this channel.",
            "Tu n'as pas la permission d'envoyer des messages dans ce salon.",
        )]);
        return;
    }

    const initialDraw = drawAgain();
    showDrawErrors(initialDraw.errors);
    if (initialDraw.candidates.length === 0) return;

    openModal(modalProps => (
        <RandomFavoritesPreviewModal
            channel={channel}
            drawAgain={drawAgain}
            initialDraw={initialDraw}
            modalProps={modalProps}
        />
    ));
}

function pauseSoundboardPreview(audio?: HTMLAudioElement | null) {
    if (!audio) return;

    audio.pause();
    audio.currentTime = 0;
}

function soundboardSourceName(sound: SoundboardSound) {
    if (sound.guildId === "0")
        return localize("Discord sounds", "Sons Discord");

    return GuildStore.getGuild(sound.guildId)?.name
        ?? localize("Unknown server", "Serveur inconnu");
}

function RandomSoundboardPreviewModal({
    initialSound,
    modalProps,
}: {
    initialSound: SoundboardSound;
    modalProps: RenderModalProps;
}) {
    const [sound, setSound] = useState(initialSound);
    const [isSending, setIsSending] = useState(false);
    const [hasPreviewStarted, setHasPreviewStarted] = useState(false);
    const [previewUnavailable, setPreviewUnavailable] = useState(false);
    const audioRef = useRef<HTMLAudioElement>(null);
    let soundUrl: string | undefined;

    try {
        soundUrl = getSoundboardSoundUrl(sound.soundId);
    } catch (error) {
        logger.error("Failed to resolve a soundboard preview URL", error);
    }

    useEffect(() => {
        setHasPreviewStarted(false);
        setPreviewUnavailable(false);

        const audio = audioRef.current;
        if (!audio || !soundUrl) return;

        audio.volume = Math.max(0, Math.min(sound.volume ?? 1, 1));
        void audio.play().catch(() => {
            // Autoplay can be denied. The native audio controls remain usable.
        });

        return () => pauseSoundboardPreview(audio);
    }, [sound.guildId, sound.soundId, sound.volume, soundUrl]);

    function reroll() {
        const draw = drawRandomSoundboard();
        if (draw.error) {
            showToast(draw.error, Toasts.Type.FAILURE);
            return;
        }

        if (draw.sound) {
            pauseSoundboardPreview(audioRef.current);
            setSound(draw.sound);
        }
    }

    function confirmPlay() {
        if (!hasPreviewStarted || previewUnavailable || !soundUrl) {
            showToast(localize(
                "Listen to the local preview before confirming.",
                "Écoute l'aperçu local avant de confirmer.",
            ), Toasts.Type.FAILURE);
            return;
        }

        setIsSending(true);
        pauseSoundboardPreview(audioRef.current);

        if (playSoundboardSelection(sound)) {
            modalProps.onClose();
        } else {
            setIsSending(false);
        }
    }

    return (
        <Modal
            {...modalProps}
            title={localize(
                "Safe random soundboard preview",
                "Aperçu soundboard aléatoire sécurisé",
            )}
            subtitle={localize(
                "This preview is local. Nothing plays in voice until you confirm.",
                "Cet aperçu est local. Rien ne passe dans le vocal avant ta confirmation.",
            )}
            actions={[
                {
                    text: localize("Cancel", "Annuler"),
                    variant: "secondary",
                    disabled: isSending,
                    onClick: modalProps.onClose,
                },
                {
                    text: localize("Draw again", "Relancer"),
                    variant: "secondary",
                    disabled: isSending,
                    onClick: reroll,
                },
                {
                    text: isSending
                        ? localize("Playing…", "Lecture…")
                        : hasPreviewStarted
                            ? localize("Play in voice", "Jouer dans le vocal")
                            : localize("Listen first", "Écoute d'abord"),
                    variant: "primary",
                    disabled: isSending
                        || !hasPreviewStarted
                        || previewUnavailable
                        || !soundUrl,
                    onClick: confirmPlay,
                },
            ]}
        >
            <div className="vc-rf-soundboard-preview">
                <div className="vc-rf-soundboard-preview-heading">
                    <span className="vc-rf-soundboard-preview-emoji" aria-hidden="true">
                        {sound.emojiName || "♪"}
                    </span>
                    <div>
                        <strong>{sound.name}</strong>
                        <span>{soundboardSourceName(sound)}</span>
                    </div>
                </div>
                {soundUrl ? (
                    <audio
                        key={soundboardCandidateKey(sound)}
                        ref={audioRef}
                        className="vc-rf-soundboard-audio"
                        src={soundUrl}
                        controls
                        preload="auto"
                        aria-label={localize(
                            `Private preview of ${sound.name}`,
                            `Aperçu privé de ${sound.name}`,
                        )}
                        onPlay={() => setHasPreviewStarted(true)}
                        onError={() => {
                            setHasPreviewStarted(false);
                            setPreviewUnavailable(true);
                        }}
                    />
                ) : null}
                {(previewUnavailable || !soundUrl) && (
                    <p className="vc-rf-soundboard-preview-error">
                        {localize(
                            "The local audio preview is unavailable. Draw again before confirming.",
                            "L'aperçu audio local est indisponible. Relance le tirage avant de confirmer.",
                        )}
                    </p>
                )}
            </div>
            <p className="vc-rf-preview-hint">
                {localize(
                    "Draw again only changes the private preview. The blue button is the only action that plays a sound in voice.",
                    "Relancer change uniquement l'aperçu privé. Seul le bouton bleu joue le son dans le vocal.",
                )}
            </p>
        </Modal>
    );
}

function runRandomSoundboard(action: RandomSoundboardAction) {
    const draw = drawRandomSoundboard();
    if (draw.error || !draw.sound) {
        showToast(draw.error ?? localize(
            "No random sound could be selected.",
            "Aucun son aléatoire n'a pu être sélectionné.",
        ), Toasts.Type.FAILURE);
        return;
    }

    const initialSound = draw.sound;
    if (action === "direct") {
        playSoundboardSelection(initialSound);
        return;
    }

    openModal(modalProps => (
        <RandomSoundboardPreviewModal
            initialSound={initialSound}
            modalProps={modalProps}
        />
    ));
}

function RandomSoundboardActionIcon({
    action,
}: {
    action: RandomSoundboardAction;
}) {
    if (action === "direct") {
        return (
            <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="currentColor"
            >
                <path d="M8 5.4v13.2c0 .8.9 1.3 1.6.8l9-6.6a1 1 0 0 0 0-1.6l-9-6.6A1 1 0 0 0 8 5.4Z" />
            </svg>
        );
    }

    return (
        <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M12 3 5.5 6v5.2c0 4.2 2.5 7.5 6.5 9.8 4-2.3 6.5-5.6 6.5-9.8V6L12 3Z" />
            <path d="M8.5 12s1.3-2 3.5-2 3.5 2 3.5 2-1.3 2-3.5 2-3.5-2-3.5-2Z" />
            <circle cx="12" cy="12" r=".8" fill="currentColor" stroke="none" />
        </svg>
    );
}

function RandomSoundboardActionsRow({
    getItemProps,
    onItemMouseEnter,
    rowProps,
}: {
    getItemProps?: (columnIndex: number) => RandomSoundboardGridItemProps;
    onItemMouseEnter?: (columnIndex: number) => void;
    rowProps: ComponentProps<"ul">;
}) {
    const { className, ...nativeRowProps } = rowProps;
    const actions: Array<{
        action: RandomSoundboardAction;
        label: string;
        tooltip: string;
    }> = [
        {
            action: "direct",
            label: localize("Play directly", "Lecture directe"),
            tooltip: localize(
                "Draw a random sound and play it immediately in voice",
                "Tirer un son aléatoire et le jouer immédiatement dans le vocal",
            ),
        },
        {
            action: "preview",
            label: localize("Safe preview", "Aperçu sécurisé"),
            tooltip: localize(
                "Draw a random sound and listen privately before confirming",
                "Tirer un son aléatoire et l'écouter en privé avant de confirmer",
            ),
        },
    ];

    return (
        <ul
            {...nativeRowProps}
            className={["vc-rf-soundboard-grid-row", className]
                .filter(Boolean)
                .join(" ")}
        >
            {actions.map(({ action, label, tooltip }, index) => {
                const itemProps = getItemProps?.(index) ?? {};
                const {
                    className: nativeItemClassName,
                    onMouseEnter,
                    ref,
                    ...nativeButtonProps
                } = itemProps;

                return (
                    <li
                        className="vc-rf-soundboard-grid-item"
                        key={action}
                        ref={ref}
                    >
                        <button
                            {...nativeButtonProps}
                            type="button"
                            className={[
                                "vc-rf-soundboard-grid-button",
                                nativeItemClassName,
                            ].filter(Boolean).join(" ")}
                            aria-label={tooltip}
                            title={tooltip}
                            onClick={event => {
                                event.stopPropagation();
                                runRandomSoundboard(action);
                            }}
                            onMouseEnter={event => {
                                onMouseEnter?.(event);
                                onItemMouseEnter?.(index);
                            }}
                        >
                            <span className="vc-rf-soundboard-grid-icon">
                                <RandomSoundboardActionIcon action={action} />
                            </span>
                            <span className="vc-rf-soundboard-grid-label">
                                {label}
                            </span>
                        </button>
                    </li>
                );
            })}
        </ul>
    );
}

function isRandomSoundboardRow(
    descriptors: readonly RandomSoundboardRowDescriptor[],
) {
    return descriptors.some(descriptor =>
        descriptor.item?.randomFavoritesAction != null,
    );
}

async function runFromCommand(kind: FavoriteKind, channel: Channel) {
    if (settings.store.previewBeforeSend) {
        openFavoritePreview(channel, () => drawRandomFavorite(kind, channel));
        return;
    }

    const result = await sendRandomFavorite(kind, channel);
    if (!result.ok)
        sendBotMessage(channel.id, { content: `🎲 ${result.message}` });
}

async function runSelectedFromButton(channel: Channel) {
    const kinds = selectedLeftClickKinds();
    const { sendEachSelectedType } = settings.store;

    if (settings.store.previewBeforeSend) {
        openFavoritePreview(
            channel,
            () => drawSelectedFavorites(kinds, sendEachSelectedType, channel),
        );
        return;
    }

    const result = await sendSelectedFavorites(
        kinds,
        sendEachSelectedType,
        channel,
    );
    if (result.errors.length > 0)
        showToast(result.errors.join("\n"), Toasts.Type.FAILURE);
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
    const selection = settings.use([
        "previewBeforeSend",
        "sendEachSelectedType",
        "mixMode",
        "sendGifsOnLeftClick",
        "sendEmojisOnLeftClick",
        "sendStickersOnLeftClick",
    ]);

    return (
        <Menu.Menu
            navId="random-favorites"
            onClose={ContextMenuApi.closeContextMenu}
            aria-label="Random Favorites"
        >
            <Menu.MenuGroup
                label={localize("Left-click mode", "Mode du clic gauche")}
            >
                <Menu.MenuCheckboxItem
                    id="random-favorites-safe-preview"
                    label={localize(
                        "Safe preview before sending",
                        "Aperçu sécurisé avant envoi",
                    )}
                    checked={selection.previewBeforeSend}
                    dontCloseOnAction
                    action={() =>
                        settings.store.previewBeforeSend = !selection.previewBeforeSend
                    }
                />
                <Menu.MenuCheckboxItem
                    id="random-favorites-send-each"
                    label={localize(
                        "One item from each selected type",
                        "Un élément de chaque type coché",
                    )}
                    checked={selection.sendEachSelectedType}
                    dontCloseOnAction
                    action={() =>
                        settings.store.sendEachSelectedType = !selection.sendEachSelectedType
                    }
                />
            </Menu.MenuGroup>
            {!selection.sendEachSelectedType && (
                <>
                    <Menu.MenuSeparator />
                    <Menu.MenuGroup
                        label={localize(
                            "Mixed-mode type distribution",
                            "Répartition des types en mode mixte",
                        )}
                    >
                        <Menu.MenuRadioItem
                            id="random-favorites-mix-balanced"
                            group="random-favorites-mix-mode"
                            label={localize(
                                "Balanced distribution (equal base weight per type)",
                                "Répartition équilibrée (même poids de base par type)",
                            )}
                            checked={selection.mixMode === "balanced"}
                            dontCloseOnAction
                            action={() => settings.store.mixMode = "balanced"}
                        />
                        <Menu.MenuRadioItem
                            id="random-favorites-mix-uniform"
                            group="random-favorites-mix-mode"
                            label={localize(
                                "Fully random (equal chance per item)",
                                "Totalement aléatoire (même chance par élément)",
                            )}
                            checked={selection.mixMode === "uniform"}
                            dontCloseOnAction
                            action={() => settings.store.mixMode = "uniform"}
                        />
                    </Menu.MenuGroup>
                </>
            )}
            <Menu.MenuSeparator />
            <Menu.MenuGroup
                label={localize("Included types", "Types inclus")}
            >
                <Menu.MenuCheckboxItem
                    id="random-favorites-select-gif"
                    label="GIF"
                    checked={selection.sendGifsOnLeftClick}
                    dontCloseOnAction
                    action={() =>
                        settings.store.sendGifsOnLeftClick = !selection.sendGifsOnLeftClick
                    }
                />
                <Menu.MenuCheckboxItem
                    id="random-favorites-select-emoji"
                    label={localize("Emoji", "Emote")}
                    checked={selection.sendEmojisOnLeftClick}
                    dontCloseOnAction
                    action={() =>
                        settings.store.sendEmojisOnLeftClick = !selection.sendEmojisOnLeftClick
                    }
                />
                <Menu.MenuCheckboxItem
                    id="random-favorites-select-sticker"
                    label="Sticker"
                    checked={selection.sendStickersOnLeftClick}
                    dontCloseOnAction
                    action={() =>
                        settings.store.sendStickersOnLeftClick = !selection.sendStickersOnLeftClick
                    }
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
    const pluginSettings = settings.use([
        "showChatBarButton",
        "previewBeforeSend",
        "sendEachSelectedType",
        "mixMode",
        "sendGifsOnLeftClick",
        "sendEmojisOnLeftClick",
        "sendStickersOnLeftClick",
    ]);

    if (
        !isAnyChat
        || disabled
        || !pluginSettings.showChatBarButton
        || !canSendMessages(channel)
    ) return null;

    const selectedKinds = selectedLeftClickKinds();
    const selectionLabel = selectedKindsLabel(selectedKinds);
    const actionTooltip = pluginSettings.sendEachSelectedType
        ? localize(
            `Send one of each: ${selectionLabel} · Right-click to configure`,
            `Envoyer un de chaque : ${selectionLabel} · Clic droit pour configurer`,
        )
        : pluginSettings.mixMode === "balanced"
            ? localize(
                `Send one (balanced types): ${selectionLabel} · Right-click to configure`,
                `Envoyer un seul (types équilibrés) : ${selectionLabel} · Clic droit pour configurer`,
            )
            : localize(
                `Send one among: ${selectionLabel} · Right-click to configure`,
                `Envoyer un seul parmi : ${selectionLabel} · Clic droit pour configurer`,
            );
    const tooltip = pluginSettings.previewBeforeSend
        ? localize(
            `Preview safely: ${selectionLabel} · Right-click to configure`,
            `Prévisualiser sans risque : ${selectionLabel} · Clic droit pour configurer`,
        )
        : actionTooltip;

    return (
        <ChatBarButton
            tooltip={tooltip}
            onClick={() => void runSelectedFromButton(channel)}
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
    description: "Send a random favorite GIF, emoji, sticker, soundboard sound, or a balanced mix.",
    authors: [{ name: "Yuzuctus", id: 0n }],
    tags: ["Chat", "Commands", "Emotes", "Fun", "Media"],
    settings,
    commands,

    patches: [{
        // This accessibility id belongs to the soundboard picker itself. The
        // analytics constant lives in another module and cannot be patched here.
        find: "soundboard_guild_",
        replacement: [
            {
                match: /(\i)=(\i)\.useMemo\(\(\)=>(\i)\.filter\((\i)=>\4\.items\.length>0\),\[\3\]\)/,
                replace: "$1=$2.useMemo(()=>$self.addRandomSoundboardCategory($3.filter($4=>$4.items.length>0)),[$3])",
            },
            {
                match: /renderRow:(\i)(?=,renderSectionHeader:\i,renderSectionFooter:\i,renderSection:\i,renderCategoryList:\i,renderHeaderAccessories:\i,rowHeight:48)/,
                replace: "renderRow:(...args)=>$self.renderRandomSoundboardRow(args[0],args[1],args[3],args[4],()=>$1(...args))",
            },
        ],
    }],

    chatBarButton: {
        icon: RandomFavoritesIcon,
        render: RandomFavoritesButton,
    },

    addRandomSoundboardCategory,

    renderRandomSoundboardRow(
        descriptors: readonly RandomSoundboardRowDescriptor[],
        rowProps: ComponentProps<"ul">,
        getItemProps: ((columnIndex: number) => RandomSoundboardGridItemProps) | undefined,
        onItemMouseEnter: ((columnIndex: number) => void) | undefined,
        renderNativeRow: () => ReactNode,
    ) {
        if (!isRandomSoundboardRow(descriptors)) return renderNativeRow();

        return (
            <RandomSoundboardActionsRow
                getItemProps={getItemProps}
                onItemMouseEnter={onItemMouseEnter}
                rowProps={rowProps}
            />
        );
    },

    stop() {
        activeChannels.clear();
        candidatePicker.clear();
        kindPicker.clear();
        soundboardPicker.clear();
    },
});
