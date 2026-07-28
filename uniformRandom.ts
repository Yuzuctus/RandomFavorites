/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type RandomSource = () => number;

export function pickUniform<T>(
    items: readonly T[],
    random: RandomSource = Math.random,
): T | undefined {
    if (items.length === 0) return undefined;

    return items[Math.floor(random() * items.length)];
}
