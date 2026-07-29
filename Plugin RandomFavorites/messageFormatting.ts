/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface GifFormattingOptions {
    label: string;
    maskWithSpoiler: boolean;
    showLabel: boolean;
}

export function formatGifContent(url: string, options: GifFormattingOptions) {
    const formattedUrl = options.maskWithSpoiler ? `||${url}||` : url;
    const label = options.label.trim();

    return options.showLabel && label
        ? `${label} ${formattedUrl}`
        : formattedUrl;
}
