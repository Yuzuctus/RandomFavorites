/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { deepStrictEqual, equal, notEqual } from "node:assert/strict";
import { describe, it } from "node:test";

import { ShuffleBag } from "./shuffleBag";

interface Item {
    id: string;
    value: number;
}

function makeBag() {
    return new ShuffleBag<Item>(item => item.id);
}

describe("ShuffleBag", () => {
    it("returns undefined for an empty collection", () => {
        equal(makeBag().take([]), undefined);
    });

    it("draws every unique key once before repeating", () => {
        const bag = makeBag();
        const items = [
            { id: "a", value: 1 },
            { id: "b", value: 2 },
            { id: "c", value: 3 },
        ];

        const firstCycle = [
            bag.take(items)?.id,
            bag.take(items)?.id,
            bag.take(items)?.id,
        ];

        deepStrictEqual(new Set(firstCycle), new Set(["a", "b", "c"]));
        equal(firstCycle.length, 3);
    });

    it("deduplicates items that share the same identity", () => {
        const bag = makeBag();
        const items = [
            { id: "same", value: 1 },
            { id: "same", value: 2 },
        ];

        equal(bag.take(items)?.value, 2);
        equal(bag.take(items)?.value, 2);
    });

    it("returns fresh values when an existing item changes", () => {
        const bag = makeBag();

        equal(bag.take([{ id: "a", value: 1 }])?.value, 1);
        equal(bag.take([{ id: "a", value: 99 }])?.value, 99);
    });

    it("rebuilds safely when the available key set changes", () => {
        const bag = makeBag();
        const initial = [
            { id: "a", value: 1 },
            { id: "b", value: 2 },
        ];
        const changed = [
            { id: "c", value: 3 },
            { id: "d", value: 4 },
        ];

        bag.take(initial);
        const firstChanged = bag.take(changed)?.id;
        const secondChanged = bag.take(changed)?.id;

        deepStrictEqual(new Set([firstChanged, secondChanged]), new Set(["c", "d"]));
    });

    it("does not repeat at the boundary between two multi-item cycles", () => {
        const bag = makeBag();
        const items = [
            { id: "a", value: 1 },
            { id: "b", value: 2 },
            { id: "c", value: 3 },
        ];

        bag.take(items);
        bag.take(items);
        const endOfFirstCycle = bag.take(items);
        const startOfSecondCycle = bag.take(items);

        notEqual(endOfFirstCycle?.id, startOfSecondCycle?.id);
    });

    it("forgets its history after clear", () => {
        const bag = makeBag();
        const item = { id: "a", value: 1 };

        equal(bag.take([item]), item);
        bag.clear();
        equal(bag.take([item]), item);
    });
});
