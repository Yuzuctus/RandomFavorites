/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type SoundboardAudioFormat = "mp3" | "ogg" | "opus";

export interface SoundboardSnapshot {
    emojiId: string | null;
    emojiName: string | null;
    guildId: string;
    name: string;
    soundId: string;
    volume: number;
}

export const DEFAULT_SOUNDBOARD_FILE_NAME = "Son aléatoire";
export const MAX_SOUNDBOARD_FILE_NAME_LENGTH = 100;
export const MAX_SOUNDBOARD_AUDIO_BYTES = 20 * 1024 * 1024;

const audioFileExtension = /\.(?:mp3|ogg|opus)$/i;
const forbiddenFileNameCharacters = /[\\/:*?"<>|]/g;
const controlCharacters = /[\u0000-\u001F\u007F-\u009F]/g;

export interface SoundboardLike {
    emojiId?: string | null;
    emojiName?: string | null;
    guildId?: string | null;
    name: string;
    soundId: string;
    volume?: number;
}

export function createSoundboardSnapshot(sound: SoundboardLike): SoundboardSnapshot {
    return {
        emojiId: sound.emojiId ?? null,
        emojiName: sound.emojiName ?? null,
        guildId: sound.guildId ?? "0",
        name: sound.name,
        soundId: sound.soundId,
        volume: Number.isFinite(sound.volume) ? Math.max(0, Math.min(sound.volume!, 1)) : 1,
    };
}

export function normalizeSoundboardFileName(value: string | null | undefined) {
    let name = (value ?? "")
        .trim()
        .replace(controlCharacters, "")
        .replace(forbiddenFileNameCharacters, "_")
        .replace(/[. ]+$/g, "")
        .replace(audioFileExtension, "")
        .replace(/[. ]+$/g, "")
        .trim();

    name = Array.from(name).slice(0, MAX_SOUNDBOARD_FILE_NAME_LENGTH).join("");
    return name || DEFAULT_SOUNDBOARD_FILE_NAME;
}

export function getSoundboardAudioExtension(format: SoundboardAudioFormat) {
    return `.${format}`;
}

export function getSoundboardAudioMimeType(format: SoundboardAudioFormat) {
    switch (format) {
        case "mp3":
            return "audio/mpeg";
        case "ogg":
            return "audio/ogg";
        case "opus":
            return "audio/opus";
    }
}

export function buildSoundboardFileName(
    value: string | null | undefined,
    format: SoundboardAudioFormat,
) {
    return `${normalizeSoundboardFileName(value)}${getSoundboardAudioExtension(format)}`;
}

export function soundboardAudioFormatFromMime(
    contentType: string | null | undefined,
): SoundboardAudioFormat | undefined {
    const mimeType = contentType?.split(";", 1)[0].trim().toLowerCase();

    switch (mimeType) {
        case "audio/mpeg":
        case "audio/mp3":
            return "mp3";
        case "audio/ogg":
        case "application/ogg":
            return "ogg";
        case "audio/opus":
            return "opus";
        default:
            return undefined;
    }
}

export function soundboardAudioFormatFromMagicBytes(
    bytes: ArrayLike<number>,
): SoundboardAudioFormat | undefined {
    if (bytes.length >= 4
        && bytes[0] === 0x4F
        && bytes[1] === 0x67
        && bytes[2] === 0x67
        && bytes[3] === 0x53) {
        return "ogg";
    }

    if (bytes.length >= 3
        && bytes[0] === 0x49
        && bytes[1] === 0x44
        && bytes[2] === 0x33) {
        return "mp3";
    }

    // MPEG audio frame sync, with valid layer, bitrate and sample-rate bits.
    if (bytes.length >= 4
        && bytes[0] === 0xFF
        && (bytes[1] & 0xE0) === 0xE0
        && (bytes[1] & 0x06) !== 0
        && (bytes[2] & 0xF0) !== 0xF0
        && (bytes[2] & 0x0C) !== 0x0C) {
        return "mp3";
    }

    return undefined;
}

function isGenericMimeType(contentType: string | null | undefined) {
    const mimeType = contentType?.split(";", 1)[0].trim().toLowerCase();
    return !mimeType
        || mimeType === "application/octet-stream"
        || mimeType === "application/octetstream"
        || mimeType === "binary/octet-stream";
}

export function detectSoundboardAudioFormat(
    contentType: string | null | undefined,
    bytes: ArrayLike<number>,
) {
    return soundboardAudioFormatFromMime(contentType)
        ?? (isGenericMimeType(contentType)
            ? soundboardAudioFormatFromMagicBytes(bytes)
            : undefined);
}

export function isReasonableSoundboardBlob(
    blob: Pick<Blob, "size">,
    maxBytes = MAX_SOUNDBOARD_AUDIO_BYTES,
) {
    return blob.size > 0 && blob.size <= maxBytes;
}
