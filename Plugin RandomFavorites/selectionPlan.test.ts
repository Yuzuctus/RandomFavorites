/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import test from "node:test";

import { buildSelectionPlan } from "./selectionPlan";

type Kind = "gif" | "emoji" | "sticker" | "soundboard";

test("single-item mode asks the mixed picker exactly once", () => {
    const mixedCalls: Kind[][] = [];
    const plan = buildSelectionPlan(
        ["gif", "emoji", "sticker", "soundboard"] as const,
        false,
        () => {
            throw new Error("the per-kind picker must not run");
        },
        kinds => {
            mixedCalls.push([...kinds]);
            return "chosen-emoji";
        },
    );

    assert.deepEqual(plan, {
        candidates: ["chosen-emoji"],
        missingKinds: [],
    });
    assert.deepEqual(mixedCalls, [["gif", "emoji", "sticker", "soundboard"]]);
});

test("one-per-kind mode keeps available candidates and reports empty kinds", () => {
    const candidates: Partial<Record<Kind, string>> = {
        gif: "chosen-gif",
        emoji: "chosen-emoji",
        sticker: "chosen-sticker",
    };
    const plan = buildSelectionPlan(
        ["gif", "emoji", "sticker", "soundboard"] as const,
        true,
        kind => candidates[kind],
        () => {
            throw new Error("the mixed picker must not run");
        },
    );

    assert.deepEqual(plan, {
        candidates: ["chosen-gif", "chosen-emoji", "chosen-sticker"],
        missingKinds: ["soundboard"],
    });
});

test("one-per-kind mode keeps a soundboard in stable selection order", () => {
    const plan = buildSelectionPlan(
        ["gif", "emoji", "sticker", "soundboard"] as const,
        true,
        kind => `chosen-${kind}`,
        () => {
            throw new Error("the mixed picker must not run");
        },
    );

    assert.deepEqual(plan, {
        candidates: [
            "chosen-gif",
            "chosen-emoji",
            "chosen-sticker",
            "chosen-soundboard",
        ],
        missingKinds: [],
    });
});

test("an empty single-item draw returns an empty plan", () => {
    const plan = buildSelectionPlan(
        ["gif", "sticker", "soundboard"] as const,
        false,
        () => undefined,
        () => undefined,
    );

    assert.deepEqual(plan, {
        candidates: [],
        missingKinds: [],
    });
});
