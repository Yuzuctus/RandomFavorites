/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { secureRandom } from "./secureRandom";

describe("secureRandom", () => {
    it("fills all 53 usable random bits and maps them into [0, 1)", () => {
        assert.equal(secureRandom(values => values.fill(0)), 0);

        const maximum = secureRandom(values => values.fill(0xffff_ffff));
        assert(maximum < 1);
        assert.equal(maximum, (Number.MAX_SAFE_INTEGER) / 0x20_0000_0000_0000);
    });

    it("requests fresh random bytes for every draw", () => {
        let calls = 0;
        const fill = (values: Uint32Array) => {
            calls++;
            values[1] = calls << 6;
        };

        assert.notEqual(secureRandom(fill), secureRandom(fill));
        assert.equal(calls, 2);
    });
});
