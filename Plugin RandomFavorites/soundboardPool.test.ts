/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    collectUsableSoundboardSounds,
    insertRandomSoundboardCategory,
    isRandomSoundboardCategory,
    RANDOM_SOUNDBOARD_CATEGORY_KEY,
    soundboardCandidateKey,
} from "./soundboardPool";

interface TestSound {
    available: boolean;
    guildId: string;
    name: string;
    soundId: string;
}

describe("soundboardPool", () => {
    it("keeps every usable sound exactly once", () => {
        const duplicate: TestSound = {
            available: true,
            guildId: "guild-a",
            name: "Duplicate",
            soundId: "sound-1",
        };
        const unavailable: TestSound = {
            available: false,
            guildId: "guild-b",
            name: "Unavailable",
            soundId: "sound-2",
        };
        const defaultSound: TestSound = {
            available: true,
            guildId: "0",
            name: "Default",
            soundId: "sound-3",
        };

        const result = collectUsableSoundboardSounds(
            [[duplicate, unavailable], [duplicate, defaultSound]],
            sound => sound.available,
        );

        assert.deepEqual(result, [duplicate, defaultSound]);
    });

    it("includes the source guild in the anti-repeat key", () => {
        assert.notEqual(
            soundboardCandidateKey({ guildId: "guild-a", soundId: "same-id" }),
            soundboardCandidateKey({ guildId: "guild-b", soundId: "same-id" }),
        );
    });

    it("inserts the virtual server immediately after Favorites", () => {
        const categories = [
            { key: "favorites", categoryInfo: { type: 0 } },
            { key: "frequent", categoryInfo: { type: 4 } },
            { key: "current", categoryInfo: { type: 1, guild: { id: "current" } } },
        ];
        const randomCategory = {
            key: RANDOM_SOUNDBOARD_CATEGORY_KEY,
            categoryInfo: { type: 1, guild: { id: "current" } },
        };
        const result = insertRandomSoundboardCategory(
            categories,
            randomCategory,
            "current",
        );

        assert.deepEqual(result.map(category => category.key), [
            "favorites",
            RANDOM_SOUNDBOARD_CATEGORY_KEY,
            "frequent",
            "current",
        ]);
        assert.equal(isRandomSoundboardCategory(result[1]), true);
    });

    it("falls back to immediately before the current guild", () => {
        const categories = [
            { key: "frequent", categoryInfo: { type: 4 } },
            { key: "current", categoryInfo: { type: 1, guild: { id: "current" } } },
            { key: "other", categoryInfo: { type: 1, guild: { id: "other" } } },
        ];
        const randomCategory = {
            key: RANDOM_SOUNDBOARD_CATEGORY_KEY,
            categoryInfo: { type: 1, guild: { id: "current" } },
        };
        const result = insertRandomSoundboardCategory(
            categories,
            randomCategory,
            "current",
        );

        assert.deepEqual(result.map(category => category.key), [
            "frequent",
            RANDOM_SOUNDBOARD_CATEGORY_KEY,
            "current",
            "other",
        ]);
    });

    it("does not inject the virtual server into search-only results", () => {
        const categories = [{ key: "search", categoryInfo: { type: 9 } }];
        const randomCategory = {
            key: RANDOM_SOUNDBOARD_CATEGORY_KEY,
            categoryInfo: { type: 1, guild: { id: "current" } },
        };

        assert.equal(
            insertRandomSoundboardCategory(categories, randomCategory, "current"),
            categories,
        );
    });
});
