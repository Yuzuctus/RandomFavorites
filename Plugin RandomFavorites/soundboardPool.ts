/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface SoundboardCandidate {
    guildId: string;
    soundId: string;
}

export interface SoundboardCategory {
    key?: string | number;
    categoryInfo?: {
        guild?: {
            id: string;
            name?: string;
        };
        isNitroLocked?: boolean;
        type?: number;
    };
    items?: readonly unknown[];
}

export const RANDOM_SOUNDBOARD_CATEGORY_KEY = "vc-rf-random-soundboard";

/**
 * Fake CDN hash exposed on the virtual guild. It never reaches the network
 * because getIconURL is overridden, but it must stay truthy so Discord never
 * falls back to the acronym avatar, and it must not start with Discord's
 * animated prefix "a_".
 */
export const RANDOM_SOUNDBOARD_GUILD_ICON_HASH = "4c7a8f2e9b1d40638e5f0a2c6d8b3e17";

/**
 * Deterministic snowflake reserved for FavoriteRandom when the current user id
 * is unavailable or collides with a real guild. Far outside normal Discord
 * snowflake ranges so GuildStore lookups stay empty.
 */
export const RANDOM_SOUNDBOARD_VIRTUAL_GUILD_FALLBACK_ID = "999000000000000000";

/**
 * Guild-icon artwork for FavoriteRandom: a white five-pip die on Discord blurple.
 * Served through a stable blob: URL (compatible with Discord <img>), never data:.
 */
export const RANDOM_SOUNDBOARD_GUILD_ICON_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">'
    + '<rect width="128" height="128" fill="#5865F2"/>'
    + '<rect x="30" y="30" width="68" height="68" rx="16" fill="#FFFFFF"/>'
    + '<circle cx="49" cy="49" r="7" fill="#5865F2"/>'
    + '<circle cx="79" cy="49" r="7" fill="#5865F2"/>'
    + '<circle cx="64" cy="64" r="7" fill="#5865F2"/>'
    + '<circle cx="49" cy="79" r="7" fill="#5865F2"/>'
    + '<circle cx="79" cy="79" r="7" fill="#5865F2"/>'
    + "</svg>";

let randomSoundboardGuildIconUrl: string | undefined;

/**
 * Picks a stable virtual guild id that is never an existing guild. Preferred
 * candidates are tried first (e.g. the current user id); otherwise the reserved
 * fallback snowflake is used, scanning forward on collision.
 */
export function pickVirtualSoundboardGuildId(
    preferredIds: readonly (string | null | undefined)[],
    isExistingGuild: (id: string) => boolean,
    fallbackId = RANDOM_SOUNDBOARD_VIRTUAL_GUILD_FALLBACK_ID,
) {
    for (const candidate of preferredIds) {
        if (candidate && !isExistingGuild(candidate)) return candidate;
    }

    if (!isExistingGuild(fallbackId)) return fallbackId;

    let next = BigInt(fallbackId);
    for (let attempt = 0; attempt < 1_000; attempt++) {
        next += 1n;
        const id = String(next);
        if (!isExistingGuild(id)) return id;
    }

    return fallbackId;
}

/** Lazy singleton blob URL for the FavoriteRandom guild icon. */
export function getRandomSoundboardGuildIconUrl() {
    if (randomSoundboardGuildIconUrl) return randomSoundboardGuildIconUrl;

    randomSoundboardGuildIconUrl = URL.createObjectURL(
        new Blob([RANDOM_SOUNDBOARD_GUILD_ICON_SVG], { type: "image/svg+xml" }),
    );
    return randomSoundboardGuildIconUrl;
}

/** Revokes the icon blob URL so reloads do not leak object URLs. */
export function revokeRandomSoundboardGuildIconUrl() {
    if (!randomSoundboardGuildIconUrl) return;

    URL.revokeObjectURL(randomSoundboardGuildIconUrl);
    randomSoundboardGuildIconUrl = undefined;
}

export function soundboardCandidateKey(candidate: SoundboardCandidate) {
    return `${candidate.guildId}:${candidate.soundId}`;
}

/**
 * Flattens Discord's per-guild sound map without biasing duplicate entries.
 * Permission and availability checks stay injectable so this helper remains
 * deterministic and independently testable.
 */
export function collectUsableSoundboardSounds<T extends SoundboardCandidate>(
    soundGroups: Iterable<readonly T[]>,
    isUsable: (sound: T) => boolean,
) {
    const uniqueSounds = new Map<string, T>();

    for (const sounds of soundGroups) {
        for (const sound of sounds) {
            if (!isUsable(sound)) continue;
            uniqueSounds.set(soundboardCandidateKey(sound), sound);
        }
    }

    return Array.from(uniqueSounds.values());
}

/**
 * Adds the virtual RandomFavorites server immediately after Favorites. During
 * search Discord replaces the normal sections with a search-only category; in
 * that case there is deliberately no insertion anchor and the list is kept as-is.
 */
export function insertRandomSoundboardCategory<T extends SoundboardCategory>(
    categories: readonly T[],
    randomCategory: T,
    currentGuildId?: string,
    favoritesCategoryType = 0,
): readonly T[] {
    if (categories.some(category => category.key === RANDOM_SOUNDBOARD_CATEGORY_KEY))
        return categories;

    const favoritesIndex = categories.findIndex(
        category => category.categoryInfo?.type === favoritesCategoryType,
    );
    const currentGuildIndex = currentGuildId == null
        ? -1
        : categories.findIndex(
            category => category.categoryInfo?.guild?.id === currentGuildId,
        );
    const insertionIndex = favoritesIndex >= 0
        ? favoritesIndex + 1
        : currentGuildIndex;

    if (insertionIndex < 0) return categories;

    return [
        ...categories.slice(0, insertionIndex),
        randomCategory,
        ...categories.slice(insertionIndex),
    ];
}

export function isRandomSoundboardCategory(category?: SoundboardCategory) {
    return category?.key === RANDOM_SOUNDBOARD_CATEGORY_KEY;
}
