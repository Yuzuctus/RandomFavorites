/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildGifPreviewSources, resolveGifContentUrl } from "./previewMedia";

describe("GIF preview media", () => {
    it("keeps the favorite page URL for sending but previews the real GIF asset", () => {
        const favoriteUrl = "https://tenor.com/view/cat-gif-123";
        const gif = {
            gif_src: "https://media.tenor.com/cat.gif",
            src: "https://media.tenor.com/cat.webm",
        };

        assert.equal(resolveGifContentUrl(favoriteUrl, gif), favoriteUrl);
        assert.deepEqual(buildGifPreviewSources(favoriteUrl, gif), [
            { type: "image", url: "https://media.tenor.com/cat.gif" },
            { type: "video", url: "https://media.tenor.com/cat.webm" },
        ]);
    });

    it("renders a stored WebM source as video instead of a broken image", () => {
        assert.deepEqual(buildGifPreviewSources("https://tenor.com/view/cat-gif-123", {
            src: "https://media.tenor.com/cat.webm?width=320",
        }), [
            { type: "video", url: "https://media.tenor.com/cat.webm?width=320" },
        ]);
    });

    it("uses a direct favorite media URL as the final preview fallback", () => {
        assert.deepEqual(buildGifPreviewSources("https://cdn.example.com/reaction.gif", {}), [
            { type: "image", url: "https://cdn.example.com/reaction.gif" },
        ]);
    });

    it("deduplicates sources and ignores unsafe or non-media page URLs", () => {
        const directUrl = "https://cdn.example.com/reaction.webp";

        assert.deepEqual(buildGifPreviewSources("https://tenor.com/view/reaction-123", {
            gif_src: directUrl,
            preview: directUrl,
            src: "javascript:alert(1)",
        }), [
            { type: "image", url: directUrl },
        ]);
    });
});
