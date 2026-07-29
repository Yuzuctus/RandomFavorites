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
    private knownKeys = new Set<string>();
    private remainingKeys: string[] = [];
    private lastKey: string | undefined;

    constructor(private readonly getKey: (item: T) => string) { }

    clear() {
        this.knownKeys.clear();
        this.remainingKeys = [];
        this.lastKey = undefined;
    }

    take(items: readonly T[]): T | undefined {
        const itemsByKey = new Map<string, T>();
        for (const item of items)
            itemsByKey.set(this.getKey(item), item);

        if (itemsByKey.size === 0) {
            this.clear();
            return undefined;
        }

        if (!this.hasSameKeys(itemsByKey))
            this.resetFor(itemsByKey.keys());

        let selected = this.takeRemaining(itemsByKey);

        if (!selected) {
            this.refill(itemsByKey.keys());
            selected = this.takeRemaining(itemsByKey);
        }

        return selected;
    }

    private hasSameKeys(itemsByKey: ReadonlyMap<string, T>) {
        if (itemsByKey.size !== this.knownKeys.size) return false;

        for (const key of itemsByKey.keys()) {
            if (!this.knownKeys.has(key)) return false;
        }

        return true;
    }

    private resetFor(keys: Iterable<string>) {
        this.knownKeys = new Set(keys);
        this.refill(this.knownKeys);
    }

    private refill(keys: Iterable<string>) {
        this.remainingKeys = Array.from(keys);
        this.shuffle(this.remainingKeys);

        // `pop` returns the last element. Move the previous result away from
        // that position so two cycles do not touch with the same item.
        if (
            this.lastKey
            && this.remainingKeys.length > 1
            && this.remainingKeys.at(-1) === this.lastKey
        ) {
            const swapIndex = Math.floor(Math.random() * (this.remainingKeys.length - 1));
            const lastIndex = this.remainingKeys.length - 1;
            [
                this.remainingKeys[swapIndex],
                this.remainingKeys[lastIndex],
            ] = [
                this.remainingKeys[lastIndex],
                this.remainingKeys[swapIndex],
            ];
        }
    }

    private takeRemaining(itemsByKey: ReadonlyMap<string, T>) {
        while (this.remainingKeys.length > 0) {
            const key = this.remainingKeys.pop()!;
            const item = itemsByKey.get(key);
            if (!item) continue;

            this.lastKey = key;
            return item;
        }

        return undefined;
    }

    private shuffle(items: string[]) {
        for (let index = items.length - 1; index > 0; index--) {
            const randomIndex = Math.floor(Math.random() * (index + 1));
            [items[index], items[randomIndex]] = [items[randomIndex], items[index]];
        }
    }
}
