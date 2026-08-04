/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type ChatSoundboardKind =
    | "all"
    | "gif"
    | "emoji"
    | "sticker"
    | "soundboard";

type ConcreteChatSoundboardKind = Exclude<ChatSoundboardKind, "all">;

interface SharedLoad {
    promise: Promise<void>;
    started: boolean;
}

/**
 * Whether a chat action needs Discord's Soundboard store to be hydrated first.
 * `all` is included because the mixed draw may select a soundboard sound.
 */
export function shouldLoadChatSoundboardForKind(
    kind: ChatSoundboardKind,
    hasFetchedAllSounds: boolean,
) {
    return !hasFetchedAllSounds && (kind === "all" || kind === "soundboard");
}

/** Whether a multi-selection chat action includes a Soundboard attachment. */
export function shouldLoadChatSoundboardForKinds(
    kinds: readonly ConcreteChatSoundboardKind[],
    hasFetchedAllSounds: boolean,
) {
    return !hasFetchedAllSounds && kinds.includes("soundboard");
}

/**
 * Shares an in-flight Soundboard fetch between chat actions. Discord's store is
 * global, so duplicating requests only adds latency and can race the picker.
 */
export function createSharedSoundboardLoader() {
    let pending: Promise<void> | undefined;

    return {
        getOrStart(load: () => Promise<void>): SharedLoad {
            if (pending) return { promise: pending, started: false };

            const requestedLoad = Promise.resolve().then(load);
            const sharedLoad = requestedLoad.finally(() => {
                if (pending === sharedLoad)
                    pending = undefined;
            });
            pending = sharedLoad;

            return { promise: sharedLoad, started: true };
        },
    };
}
