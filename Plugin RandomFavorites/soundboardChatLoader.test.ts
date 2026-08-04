/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
    createSharedSoundboardLoader,
    shouldLoadChatSoundboardForKind,
    shouldLoadChatSoundboardForKinds,
} from "./soundboardChatLoader";

test("only chat actions that can draw a soundboard trigger the initial load", () => {
    assert.equal(shouldLoadChatSoundboardForKind("soundboard", false), true);
    assert.equal(shouldLoadChatSoundboardForKind("all", false), true);

    assert.equal(shouldLoadChatSoundboardForKind("gif", false), false);
    assert.equal(shouldLoadChatSoundboardForKind("emoji", false), false);
    assert.equal(shouldLoadChatSoundboardForKind("sticker", false), false);

    assert.equal(shouldLoadChatSoundboardForKind("soundboard", true), false);
    assert.equal(shouldLoadChatSoundboardForKind("all", true), false);
});

test("checkbox selections load only when soundboard is selected", () => {
    assert.equal(shouldLoadChatSoundboardForKinds(["gif", "emoji"], false), false);
    assert.equal(shouldLoadChatSoundboardForKinds(["gif", "soundboard"], false), true);
    assert.equal(shouldLoadChatSoundboardForKinds(["soundboard"], true), false);
});

test("concurrent chat actions share one Soundboard fetch", async () => {
    const loader = createSharedSoundboardLoader();
    let calls = 0;
    let finishLoad: (() => void) | undefined;
    const load = () => {
        calls++;
        return new Promise<void>(resolve => {
            finishLoad = resolve;
        });
    };

    const first = loader.getOrStart(load);
    const second = loader.getOrStart(load);

    assert.equal(first.started, true);
    assert.equal(second.started, false);
    assert.strictEqual(first.promise, second.promise);

    await Promise.resolve();
    assert.equal(calls, 1);

    finishLoad?.();
    await Promise.all([first.promise, second.promise]);

    const retry = loader.getOrStart(async () => {
        calls++;
    });
    assert.equal(retry.started, true);
    await retry.promise;
    assert.equal(calls, 2);
});
