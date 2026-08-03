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
    categoryInfo?: {
        guild?: { id: string; };
        type?: number;
    };
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
 * Anchors the custom row immediately after Favorites. Discord can omit that
 * section when it is empty, so the current guild becomes the fallback anchor.
 */
export function shouldInsertRandomSoundboardSection(
    categories: readonly SoundboardCategory[],
    index: number,
    currentGuildId?: string,
    favoritesCategoryType = 0,
) {
    const hasFavoritesSection = categories.some(
        category => category.categoryInfo?.type === favoritesCategoryType,
    );

    if (hasFavoritesSection) {
        return index > 0
            && categories[index - 1]?.categoryInfo?.type === favoritesCategoryType;
    }

    return currentGuildId != null
        && categories[index]?.categoryInfo?.guild?.id === currentGuildId;
}
