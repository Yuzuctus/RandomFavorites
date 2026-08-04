/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
    buildSoundboardFileName,
    createSoundboardSnapshot,
    DEFAULT_SOUNDBOARD_FILE_NAME,
    detectSoundboardAudioFormat,
    MAX_SOUNDBOARD_FILE_NAME_LENGTH,
    normalizeSoundboardFileName,
    soundboardAudioFormatFromMagicBytes,
} from "./soundboardAttachment";

test("creates a minimal snapshot with the default guild id", () => {
    assert.deepEqual(
        createSoundboardSnapshot({
            emojiId: null,
            emojiName: "🔊",
            name: "Test",
            soundId: "sound-1",
            volume: 2,
        }),
        {
            emojiId: null,
            emojiName: "🔊",
            guildId: "0",
            name: "Test",
            soundId: "sound-1",
            volume: 1,
        },
    );
});

test("uses the exact default soundboard filename", () => {
    assert.equal(normalizeSoundboardFileName(""), DEFAULT_SOUNDBOARD_FILE_NAME);
    assert.equal(buildSoundboardFileName(undefined, "mp3"), "Son aléatoire.mp3");
});

test("adds the detected audio extension and replaces a manually entered one", () => {
    assert.equal(buildSoundboardFileName("Mon son", "mp3"), "Mon son.mp3");
    assert.equal(buildSoundboardFileName("Mon son.ogg", "mp3"), "Mon son.mp3");
    assert.equal(buildSoundboardFileName("Mon son.opus", "opus"), "Mon son.opus");
});

test("removes path and control characters while preserving accents", () => {
    const filename = normalizeSoundboardFileName("../../été\u0000");

    assert.equal(filename, ".._.._été");
    assert.doesNotMatch(filename, /[\\/:*?"<>|\u0000-\u001F\u007F-\u009F]/);
});

test("falls back when the name is only an audio extension", () => {
    assert.equal(
        buildSoundboardFileName(".ogg", "ogg"),
        "Son aléatoire.ogg",
    );
});

test("limits the normalized base filename", () => {
    assert.equal(
        normalizeSoundboardFileName("a".repeat(MAX_SOUNDBOARD_FILE_NAME_LENGTH + 30)).length,
        MAX_SOUNDBOARD_FILE_NAME_LENGTH,
    );
});

test("detects supported MIME types", () => {
    assert.equal(detectSoundboardAudioFormat("audio/mpeg", []), "mp3");
    assert.equal(detectSoundboardAudioFormat("audio/ogg", []), "ogg");
    assert.equal(detectSoundboardAudioFormat("application/ogg", []), "ogg");
    assert.equal(detectSoundboardAudioFormat("audio/opus", []), "opus");
});

test("detects MP3 and Ogg magic bytes for generic responses", () => {
    assert.equal(
        soundboardAudioFormatFromMagicBytes([0x49, 0x44, 0x33]),
        "mp3",
    );
    assert.equal(
        detectSoundboardAudioFormat("application/octet-stream", [0x4F, 0x67, 0x67, 0x53]),
        "ogg",
    );
    assert.equal(
        detectSoundboardAudioFormat("application/octet-stream", [0xFF, 0xFB, 0x90, 0x64]),
        "mp3",
    );
});

test("rejects unknown audio formats", () => {
    assert.equal(detectSoundboardAudioFormat("audio/wav", [0x52, 0x49, 0x46, 0x46]), undefined);
    assert.equal(detectSoundboardAudioFormat("application/octet-stream", [0x00, 0x01]), undefined);
});
