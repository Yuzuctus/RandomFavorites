/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type SoundboardAudioFormat =
    | "aac"
    | "aiff"
    | "amr"
    | "caf"
    | "flac"
    | "m4a"
    | "mp3"
    | "ogg"
    | "opus"
    | "wav"
    | "webm"
    | "wma";

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

const audioFileExtension = /\.(?:aac|aiff|aifc|amr|caf|flac|m4a|mp3|ogg|opus|wav|webm|wma)$/i;
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
        case "aac":
            return "audio/aac";
        case "aiff":
            return "audio/aiff";
        case "amr":
            return "audio/amr";
        case "caf":
            return "audio/x-caf";
        case "flac":
            return "audio/flac";
        case "m4a":
            return "audio/mp4";
        case "mp3":
            return "audio/mpeg";
        case "ogg":
            return "audio/ogg";
        case "opus":
            return "audio/opus";
        case "wav":
            return "audio/wav";
        case "webm":
            return "audio/webm";
        case "wma":
            return "audio/x-ms-wma";
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
    const normalizedContentType = contentType?.trim().toLowerCase() ?? "";
    const mimeType = normalizedContentType.split(";", 1)[0].trim();

    switch (mimeType) {
        case "audio/aac":
        case "audio/aacp":
        case "audio/x-aac":
            return "aac";
        case "audio/aiff":
        case "audio/x-aiff":
        case "audio/aifc":
            return "aiff";
        case "audio/amr":
        case "audio/amr-wb":
            return "amr";
        case "audio/x-caf":
        case "audio/caf":
            return "caf";
        case "audio/flac":
        case "audio/x-flac":
            return "flac";
        case "audio/mp4":
        case "audio/x-m4a":
        case "video/mp4":
            return "m4a";
        case "audio/mpeg":
        case "audio/mp3":
        case "audio/x-mpeg":
        case "audio/x-mp3":
            return "mp3";
        case "audio/ogg":
        case "audio/x-ogg":
        case "application/ogg":
        case "application/x-ogg":
            return /(?:^|[;\s])codecs?\s*=\s*["']?opus\b/.test(normalizedContentType)
                ? "opus"
                : "ogg";
        case "audio/opus":
        case "audio/opus+ogg":
        case "audio/x-opus+ogg":
            return "opus";
        case "audio/wav":
        case "audio/wave":
        case "audio/x-wav":
            return "wav";
        case "audio/webm":
        case "video/webm":
            return "webm";
        case "audio/x-ms-wma":
        case "video/x-ms-asf":
            return "wma";
        default:
            return undefined;
    }
}

function hasAsciiSignature(
    bytes: ArrayLike<number>,
    signature: string,
    offset = 0,
) {
    if (bytes.length < offset + signature.length) return false;

    for (let index = 0; index < signature.length; index++) {
        if (bytes[offset + index] !== signature.charCodeAt(index)) return false;
    }

    return true;
}

function containsAsciiSignature(
    bytes: ArrayLike<number>,
    signature: string,
    maximumOffset = 512,
) {
    const lastOffset = Math.min(bytes.length - signature.length, maximumOffset);
    for (let offset = 0; offset <= lastOffset; offset++) {
        if (hasAsciiSignature(bytes, signature, offset)) return true;
    }

    return false;
}

export function soundboardAudioFormatFromMagicBytes(
    bytes: ArrayLike<number>,
): SoundboardAudioFormat | undefined {
    if (hasAsciiSignature(bytes, "OggS"))
        return containsAsciiSignature(bytes, "OpusHead") ? "opus" : "ogg";

    if (hasAsciiSignature(bytes, "ID3")) return "mp3";

    if ((hasAsciiSignature(bytes, "RIFF") || hasAsciiSignature(bytes, "RF64"))
        && hasAsciiSignature(bytes, "WAVE", 8)) {
        return "wav";
    }

    if (hasAsciiSignature(bytes, "fLaC")) return "flac";
    if (hasAsciiSignature(bytes, "\x1A\x45\xDF\xA3")) return "webm";
    if (hasAsciiSignature(bytes, "FORM")
        && (hasAsciiSignature(bytes, "AIFF", 8) || hasAsciiSignature(bytes, "AIFC", 8))) {
        return "aiff";
    }
    if (hasAsciiSignature(bytes, "caff")) return "caf";
    if (hasAsciiSignature(bytes, "#!AMR")) return "amr";

    if (bytes.length >= 8 && hasAsciiSignature(bytes, "ftyp", 4)) return "m4a";

    // AAC ADTS frames use a 12-bit sync word and have no MPEG layer bits.
    if (bytes.length >= 2
        && bytes[0] === 0xFF
        && (bytes[1] & 0xF6) === 0xF0) {
        return "aac";
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

    if (bytes.length >= 4
        && bytes[0] === 0x30
        && bytes[1] === 0x26
        && bytes[2] === 0xB2
        && bytes[3] === 0x75) {
        return "wma";
    }

    return undefined;
}

export function detectSoundboardAudioFormat(
    contentType: string | null | undefined,
    bytes: ArrayLike<number>,
) {
    const mimeFormat = soundboardAudioFormatFromMime(contentType);
    const magicFormat = soundboardAudioFormatFromMagicBytes(bytes);

    if (magicFormat === "ogg" && mimeFormat === "opus") return "opus";
    return magicFormat ?? mimeFormat;
}

export function isReasonableSoundboardBlob(
    blob: Pick<Blob, "size">,
    maxBytes = MAX_SOUNDBOARD_AUDIO_BYTES,
) {
    return blob.size > 0 && blob.size <= maxBytes;
}
