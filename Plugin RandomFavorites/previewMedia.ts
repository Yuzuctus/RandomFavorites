/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface FavoriteGifMedia {
    format?: number;
    gif_src?: string;
    preview?: string;
    src?: string;
    url?: string;
}

export interface PreviewSource {
    type: "image" | "video";
    url: string;
}

const directImageExtensions = /\.(?:avif|gif|jpe?g|png|webp)$/i;
const directVideoExtensions = /\.(?:m4v|mov|mp4|webm)$/i;

function normalizeWebUrl(value: string | undefined) {
    if (!value) return undefined;

    try {
        const url = new URL(value);
        if (url.protocol !== "https:" && url.protocol !== "http:")
            return undefined;

        return url.toString();
    } catch {
        return undefined;
    }
}

function inferMediaType(url: string): PreviewSource["type"] {
    const { pathname } = new URL(url);
    const finalSegment = pathname.split("/").pop()?.toLowerCase();

    return directVideoExtensions.test(pathname)
        || pathname.toLowerCase().includes("/videos/")
        || /^(?:m4v|mov|mp4|webm)$/.test(finalSegment ?? "")
        ? "video"
        : "image";
}

function isDirectMediaUrl(url: string) {
    const { pathname } = new URL(url);
    return directImageExtensions.test(pathname) || directVideoExtensions.test(pathname);
}

export function resolveGifContentUrl(
    favoriteUrl: string,
    gif: FavoriteGifMedia,
) {
    return [favoriteUrl, gif.url, gif.gif_src, gif.src]
        .map(normalizeWebUrl)
        .find((url): url is string => url !== undefined);
}

export function buildGifPreviewSources(
    favoriteUrl: string,
    gif: FavoriteGifMedia,
): PreviewSource[] {
    const sources: PreviewSource[] = [];
    const seen = new Set<string>();

    function add(value: string | undefined, type?: PreviewSource["type"], directOnly = false) {
        const url = normalizeWebUrl(value);
        if (!url || seen.has(url) || (directOnly && !isDirectMediaUrl(url))) return;

        seen.add(url);
        sources.push({ type: type ?? inferMediaType(url), url });
    }

    add(gif.gif_src, "image");
    add(gif.preview);
    add(gif.src, gif.format === 2
        ? "video"
        : gif.format === 1
            ? "image"
            : undefined);
    add(gif.url, undefined, true);
    add(favoriteUrl, undefined, true);

    return sources;
}
