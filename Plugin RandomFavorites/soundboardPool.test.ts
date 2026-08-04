/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    collectChatSoundboardPool,
    collectUsableSoundboardSounds,
    getRandomSoundboardGuildIconUrl,
    insertRandomSoundboardCategory,
    isRandomSoundboardCategory,
    pickVirtualSoundboardGuildId,
    RANDOM_SOUNDBOARD_CATEGORY_KEY,
    RANDOM_SOUNDBOARD_GUILD_ICON_HASH,
    RANDOM_SOUNDBOARD_GUILD_ICON_SVG,
    RANDOM_SOUNDBOARD_VIRTUAL_GUILD_FALLBACK_ID,
    revokeRandomSoundboardGuildIconUrl,
    SOUNDBOARD_DEFAULTS_CATEGORY_TYPE,
    SOUNDBOARD_GUILD_CATEGORY_TYPE,
    SOUNDBOARD_SEARCH_CATEGORY_TYPE,
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

    it("uses a stable chat key and normalizes missing guild ids", () => {
        assert.equal(
            soundboardCandidateKey({ guildId: undefined, soundId: "default" }),
            "soundboard:0:default",
        );
    });

    it("keeps detected counts separate from usable chat candidates", () => {
        const unavailable: TestSound = {
            available: false,
            guildId: "guild-a",
            name: "Locked",
            soundId: "sound-1",
        };
        const usable: TestSound = {
            available: true,
            guildId: "guild-b",
            name: "Usable",
            soundId: "sound-2",
        };

        assert.deepEqual(
            collectChatSoundboardPool([[unavailable, usable], [unavailable]], true),
            { candidates: [usable], rawCount: 2 },
        );
        assert.deepEqual(
            collectChatSoundboardPool([[unavailable, usable]], false),
            { candidates: [], rawCount: 2 },
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
        const categories = [{ key: "search", categoryInfo: { type: SOUNDBOARD_SEARCH_CATEGORY_TYPE } }];
        const randomCategory = {
            key: RANDOM_SOUNDBOARD_CATEGORY_KEY,
            categoryInfo: { type: SOUNDBOARD_GUILD_CATEGORY_TYPE, guild: { id: "current" } },
        };

        assert.equal(
            insertRandomSoundboardCategory(categories, randomCategory, "current"),
            categories,
        );
    });

    it("inserts the virtual server after Discord defaults in a private call", () => {
        const categories = [
            { key: "defaults", categoryInfo: { type: SOUNDBOARD_DEFAULTS_CATEGORY_TYPE } },
        ];
        const randomCategory = {
            key: RANDOM_SOUNDBOARD_CATEGORY_KEY,
            categoryInfo: { type: SOUNDBOARD_GUILD_CATEGORY_TYPE, guild: { id: "virtual" } },
        };

        const result = insertRandomSoundboardCategory(categories, randomCategory);

        assert.deepEqual(result.map(category => category.key), [
            "defaults",
            RANDOM_SOUNDBOARD_CATEGORY_KEY,
        ]);
    });

    it("serves the virtual server icon as a stable blob URL", () => {
        revokeRandomSoundboardGuildIconUrl();

        const first = getRandomSoundboardGuildIconUrl();
        const second = getRandomSoundboardGuildIconUrl();

        assert.equal(first, second);
        assert.match(first, /^blob:/);
        assert.ok(RANDOM_SOUNDBOARD_GUILD_ICON_SVG.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
        assert.equal(RANDOM_SOUNDBOARD_GUILD_ICON_SVG.match(/<circle /g)?.length, 5);
        assert.ok(RANDOM_SOUNDBOARD_GUILD_ICON_SVG.includes('fill="#5865F2"'));

        revokeRandomSoundboardGuildIconUrl();
        const third = getRandomSoundboardGuildIconUrl();
        assert.match(third, /^blob:/);
        assert.notEqual(third, first);
        revokeRandomSoundboardGuildIconUrl();
    });

    it("keeps the fake icon hash truthy but never animated", () => {
        assert.match(RANDOM_SOUNDBOARD_GUILD_ICON_HASH, /^[0-9a-f]{32}$/);
        assert.ok(!RANDOM_SOUNDBOARD_GUILD_ICON_HASH.startsWith("a_"));
    });

    it("picks a preferred non-guild id for the virtual server", () => {
        const existing = new Set(["guild-a", "guild-b"]);
        assert.equal(
            pickVirtualSoundboardGuildId(
                ["guild-a", "user-1", "user-2"],
                id => existing.has(id),
            ),
            "user-1",
        );
    });

    it("falls back to the reserved snowflake when preferences collide", () => {
        const existing = new Set([
            "user-1",
            RANDOM_SOUNDBOARD_VIRTUAL_GUILD_FALLBACK_ID,
        ]);

        assert.equal(
            pickVirtualSoundboardGuildId(["user-1"], id => existing.has(id)),
            String(BigInt(RANDOM_SOUNDBOARD_VIRTUAL_GUILD_FALLBACK_ID) + 1n),
        );
    });
});
