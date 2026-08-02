/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { type RandomSource, secureRandom } from "./secureRandom";

export type RepeatStrength = "light" | "balanced" | "strong";

interface RepeatProfile {
    minimumWeight: number;
    historyMultiplier: number;
}

const profiles: Record<RepeatStrength, RepeatProfile> = {
    light: { minimumWeight: 0.42, historyMultiplier: 1 },
    balanced: { minimumWeight: 0.16, historyMultiplier: 2 },
    strong: { minimumWeight: 0.04, historyMultiplier: 3 },
};

const maximumHistorySize = 128;

function historyWindowSize(poolSize: number, strength: RepeatStrength) {
    if (poolSize <= 1) return 1;

    return Math.min(
        maximumHistorySize,
        poolSize - 1,
        Math.max(
            2,
            Math.ceil(Math.log2(poolSize + 1) * profiles[strength].historyMultiplier),
        ),
    );
}

/**
 * Returns a strictly positive recency weight. The newest result receives the
 * smallest weight and progressively recovers to the neutral weight of 1.
 */
export function getRepeatWeight(
    recencyIndex: number,
    poolSize: number,
    strength: RepeatStrength,
) {
    const profile = profiles[strength];
    const windowSize = historyWindowSize(poolSize, strength);
    if (recencyIndex < 0 || recencyIndex >= windowSize) return 1;

    const recovery = recencyIndex / windowSize;
    return profile.minimumWeight
        + (1 - profile.minimumWeight) * recovery * recovery;
}

function normalizeRandom(value: number) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(value, 1 - Number.EPSILON));
}

/**
 * Random picker with soft recency penalties. A recent item is less likely, but
 * never excluded, so every valid result remains possible on every draw.
 */
export class AdaptiveRandomPicker<T> {
    private readonly history: string[] = [];

    constructor(
        private readonly getKey: (item: T) => string,
        private readonly random: RandomSource = secureRandom,
    ) { }

    clear() {
        this.history.length = 0;
    }

    take(items: readonly T[], strength: RepeatStrength): T | undefined {
        const itemsByKey = new Map<string, T>();
        for (const item of items)
            itemsByKey.set(this.getKey(item), item);

        if (itemsByKey.size === 0) return undefined;

        const weightedKeys = Array.from(itemsByKey.keys(), key => ({
            key,
            weight: getRepeatWeight(
                this.history.indexOf(key),
                itemsByKey.size,
                strength,
            ),
        }));
        const totalWeight = weightedKeys.reduce(
            (total, candidate) => total + candidate.weight,
            0,
        );
        const target = normalizeRandom(this.random()) * totalWeight;
        let cumulativeWeight = 0;
        let selectedKey = weightedKeys.at(-1)!.key;

        for (const candidate of weightedKeys) {
            cumulativeWeight += candidate.weight;
            if (target >= cumulativeWeight) continue;

            selectedKey = candidate.key;
            break;
        }

        this.history.unshift(selectedKey);
        if (this.history.length > maximumHistorySize)
            this.history.length = maximumHistorySize;

        return itemsByKey.get(selectedKey);
    }
}
