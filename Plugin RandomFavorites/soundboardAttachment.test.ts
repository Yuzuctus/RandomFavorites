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
    assert.equal(buildSoundboardFileName("Mon son.wav", "wav"), "Mon son.wav");
    assert.equal(buildSoundboardFileName("Mon son.m4a", "m4a"), "Mon son.m4a");
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
    assert.equal(detectSoundboardAudioFormat("audio/ogg; codecs=opus", []), "opus");
    assert.equal(detectSoundboardAudioFormat("audio/x-opus+ogg", []), "opus");
    assert.equal(detectSoundboardAudioFormat("audio/x-wav", []), "wav");
    assert.equal(detectSoundboardAudioFormat("audio/webm", []), "webm");
    assert.equal(detectSoundboardAudioFormat("audio/x-flac", []), "flac");
    assert.equal(detectSoundboardAudioFormat("audio/mp4", []), "m4a");
});

test("detects audio signatures when the CDN returns a generic MIME type", () => {
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
    assert.equal(
        soundboardAudioFormatFromMagicBytes([
            0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45,
        ]),
        "wav",
    );
    assert.equal(
        soundboardAudioFormatFromMagicBytes([0x1A, 0x45, 0xDF, 0xA3]),
        "webm",
    );
    assert.equal(
        soundboardAudioFormatFromMagicBytes([0x66, 0x4C, 0x61, 0x43]),
        "flac",
    );
    assert.equal(
        soundboardAudioFormatFromMagicBytes([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70]),
        "m4a",
    );
    assert.equal(
        soundboardAudioFormatFromMagicBytes([0xFF, 0xF1, 0x50, 0x80]),
        "aac",
    );
});

test("recognizes an Ogg Opus stream even when its MIME type is generic", () => {
    const bytes = new Uint8Array(40);
    bytes.set([0x4F, 0x67, 0x67, 0x53], 0);
    bytes.set([0x4F, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64], 28);

    assert.equal(
        detectSoundboardAudioFormat("application/octet-stream", bytes),
        "opus",
    );
});

test("rejects unknown audio formats", () => {
    assert.equal(detectSoundboardAudioFormat("application/octet-stream", [0x00, 0x01]), undefined);
    assert.equal(detectSoundboardAudioFormat("application/x-unknown", [0x00, 0x01]), undefined);
});
