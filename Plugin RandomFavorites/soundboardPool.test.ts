/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    collectUsableSoundboardSounds,
    shouldInsertRandomSoundboardSection,
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

    it("inserts immediately after Favorites, before frequent and guild sections", () => {
        const categories = [
            { categoryInfo: { type: 0 } },
            { categoryInfo: { type: 4 } },
            { categoryInfo: { type: 1, guild: { id: "current" } } },
        ];

        assert.equal(shouldInsertRandomSoundboardSection(categories, 0, "current"), false);
        assert.equal(shouldInsertRandomSoundboardSection(categories, 1, "current"), true);
        assert.equal(shouldInsertRandomSoundboardSection(categories, 2, "current"), false);
    });

    it("falls back to the current guild when Discord omits an empty Favorites section", () => {
        const categories = [
            { categoryInfo: { type: 4 } },
            { categoryInfo: { type: 1, guild: { id: "current" } } },
            { categoryInfo: { type: 1, guild: { id: "other" } } },
        ];

        assert.equal(shouldInsertRandomSoundboardSection(categories, 0, "current"), false);
        assert.equal(shouldInsertRandomSoundboardSection(categories, 1, "current"), true);
        assert.equal(shouldInsertRandomSoundboardSection(categories, 2, "current"), false);
    });
});
