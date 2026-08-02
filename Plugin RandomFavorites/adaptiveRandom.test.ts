/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    AdaptiveRandomPicker,
    getRepeatWeight,
    type RepeatStrength,
} from "./adaptiveRandom";

interface Item {
    id: string;
    value?: number;
}

function sequence(...values: number[]) {
    let index = 0;
    return () => values[Math.min(index++, values.length - 1)];
}

function seededRandom(seed: number) {
    return () => {
        seed |= 0;
        seed = seed + 0x6d2b79f5 | 0;
        let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
        value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
        return ((value ^ value >>> 14) >>> 0) / 0x1_0000_0000;
    };
}

describe("AdaptiveRandomPicker", () => {
    it("never reduces a recent item to zero probability", () => {
        assert(getRepeatWeight(0, 3, "strong") > 0);

        const picker = new AdaptiveRandomPicker<Item>(item => item.id, sequence(0, 0));
        const items = [{ id: "a" }, { id: "b" }, { id: "c" }];

        assert.equal(picker.take(items, "strong")?.id, "a");
        assert.equal(picker.take(items, "strong")?.id, "a");
    });

    it("makes older and unseen items progressively more likely", () => {
        const newest = getRepeatWeight(0, 20, "balanced");
        const older = getRepeatWeight(3, 20, "balanced");
        const forgotten = getRepeatWeight(100, 20, "balanced");

        assert(newest > 0 && newest < older);
        assert(older < forgotten);
        assert.equal(forgotten, 1);
    });

    it("prefers an alternative without making it mandatory", () => {
        const picker = new AdaptiveRandomPicker<Item>(item => item.id, sequence(0, 0.5));
        const items = [{ id: "a" }, { id: "b" }];

        assert.equal(picker.take(items, "balanced")?.id, "a");
        assert.equal(picker.take(items, "balanced")?.id, "b");
    });

    it("keeps history across pool changes and returns fresh objects", () => {
        const picker = new AdaptiveRandomPicker<Item>(item => item.id, sequence(0, 0.9, 0.9));

        assert.equal(picker.take([{ id: "a", value: 1 }], "strong")?.value, 1);
        picker.take([{ id: "elsewhere" }], "strong");

        const selected = picker.take([
            { id: "a", value: 99 },
            { id: "b", value: 2 },
        ], "strong");
        assert.equal(selected?.id, "b");

        picker.clear();
        assert.equal(picker.take([{ id: "a", value: 99 }], "strong")?.value, 99);
    });

    it("remains balanced over time while allowing rare immediate repeats", () => {
        const picker = new AdaptiveRandomPicker<Item>(item => item.id, seededRandom(0x5eed));
        const items = [{ id: "gif" }, { id: "emoji" }, { id: "sticker" }];
        const counts = new Map(items.map(item => [item.id, 0]));
        let previous: string | undefined;
        let immediateRepeats = 0;
        const draws = 30_000;

        for (let index = 0; index < draws; index++) {
            const selected = picker.take(items, "balanced")!;
            counts.set(selected.id, counts.get(selected.id)! + 1);
            if (selected.id === previous) immediateRepeats++;
            previous = selected.id;
        }

        for (const count of counts.values())
            assert(count / draws > 0.31 && count / draws < 0.36);

        assert(immediateRepeats > 0);
        assert(immediateRepeats / draws < 0.12);
    });

    it("makes each configured strength measurably stronger without hard blocking", () => {
        const items = [{ id: "gif" }, { id: "emoji" }, { id: "sticker" }];

        function repeatRate(strength: RepeatStrength, seed: number) {
            const picker = new AdaptiveRandomPicker<Item>(item => item.id, seededRandom(seed));
            let previous: string | undefined;
            let repeats = 0;
            const draws = 30_000;

            for (let index = 0; index < draws; index++) {
                const selected = picker.take(items, strength)!;
                if (selected.id === previous) repeats++;
                previous = selected.id;
            }

            return repeats / draws;
        }

        const light = repeatRate("light", 1);
        const balanced = repeatRate("balanced", 2);
        const strong = repeatRate("strong", 3);

        assert(light > balanced);
        assert(balanced > strong);
        assert(strong > 0 && strong < 0.05);
    });
});
