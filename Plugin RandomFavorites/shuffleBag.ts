/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Draws every unique item once in a shuffled order before starting a new cycle.
 *
 * The bag stores keys instead of the objects themselves. That keeps returned
 * values fresh when Discord updates its stores without changing favorite IDs.
 */
export class ShuffleBag<T> {
    private usedKeys = new Set<string>();
    private lastKey: string | undefined;

    constructor(private readonly getKey: (item: T) => string) { }

    clear() {
        this.usedKeys.clear();
        this.lastKey = undefined;
    }

    take(items: readonly T[]): T | undefined {
        const itemsByKey = new Map<string, T>();
        for (const item of items)
            itemsByKey.set(this.getKey(item), item);

        if (itemsByKey.size === 0) return undefined;

        let availableKeys = Array.from(itemsByKey.keys())
            .filter(key => !this.usedKeys.has(key));

        if (availableKeys.length === 0) {
            // Only reset the currently available pool. History for temporarily
            // unavailable items remains intact when the channel or mode changes.
            for (const key of itemsByKey.keys())
                this.usedKeys.delete(key);

            availableKeys = Array.from(itemsByKey.keys());
        }

        if (this.lastKey && availableKeys.length > 1)
            availableKeys = availableKeys.filter(key => key !== this.lastKey);

        const selectedKey = availableKeys[
            Math.floor(Math.random() * availableKeys.length)
        ];
        this.usedKeys.add(selectedKey);
        this.lastKey = selectedKey;

        return itemsByKey.get(selectedKey);
    }
}
