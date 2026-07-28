/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { equal } from "node:assert/strict";
import { describe, it } from "node:test";

import { formatGifContent } from "./messageFormatting";

describe("formatGifContent", () => {
    const gifUrl = "https://media.example.com/reaction.gif";

    it("adds the GIF label and hides the URL behind Discord's native spoiler mask", () => {
        equal(formatGifContent(gifUrl, {
            label: "Gif random :",
            maskWithSpoiler: true,
            showLabel: true,
        }), `Gif random : ||${gifUrl}||`);
    });

    it("keeps the GIF label and leaves the URL visible when masking is disabled", () => {
        equal(formatGifContent(gifUrl, {
            label: "Gif random :",
            maskWithSpoiler: false,
            showLabel: true,
        }), `Gif random : ${gifUrl}`);
    });

    it("can send only the masked GIF without a label", () => {
        equal(formatGifContent(gifUrl, {
            label: "Gif random :",
            maskWithSpoiler: true,
            showLabel: false,
        }), `||${gifUrl}||`);
    });

    it("does not add blank spacing when the custom label is empty", () => {
        equal(formatGifContent(gifUrl, {
            label: "   ",
            maskWithSpoiler: false,
            showLabel: true,
        }), gifUrl);
    });
});
