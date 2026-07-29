/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { pickUniform } from "./uniformRandom";

describe("pickUniform", () => {
    it("returns undefined for an empty collection", () => {
        assert.equal(pickUniform([], () => 0.5), undefined);
    });

    it("gives three categories equal thirds of the random interval", () => {
        const categories = ["gif", "emoji", "sticker"] as const;

        assert.equal(pickUniform(categories, () => 0), "gif");
        assert.equal(pickUniform(categories, () => 0.32), "gif");
        assert.equal(pickUniform(categories, () => 0.34), "emoji");
        assert.equal(pickUniform(categories, () => 0.65), "emoji");
        assert.equal(pickUniform(categories, () => 0.67), "sticker");
        assert.equal(pickUniform(categories, () => 0.999), "sticker");
    });

    it("gives two categories equal halves of the random interval", () => {
        const categories = ["gif", "sticker"] as const;

        assert.equal(pickUniform(categories, () => 0.49), "gif");
        assert.equal(pickUniform(categories, () => 0.5), "sticker");
        assert.equal(pickUniform(categories, () => 0.999), "sticker");
    });
});
