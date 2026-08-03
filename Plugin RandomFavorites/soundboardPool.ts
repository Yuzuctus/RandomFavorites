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
