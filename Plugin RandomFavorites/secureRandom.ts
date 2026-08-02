/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type RandomSource = () => number;
export type RandomValuesFill = (values: Uint32Array<ArrayBuffer>) => void;

const lowBitRange = 0x400_0000;
const safeIntegerRange = 0x20_0000_0000_0000;

function fillFromWebCrypto(values: Uint32Array<ArrayBuffer>) {
    globalThis.crypto.getRandomValues(values);
}

/** Returns a Web Crypto-backed 53-bit value in the half-open interval [0, 1). */
export function secureRandom(fill: RandomValuesFill = fillFromWebCrypto) {
    const values = new Uint32Array(new ArrayBuffer(Uint32Array.BYTES_PER_ELEMENT * 2));
    fill(values);

    const highBits = values[0] >>> 5;
    const lowBits = values[1] >>> 6;
    return (highBits * lowBitRange + lowBits) / safeIntegerRange;
}
