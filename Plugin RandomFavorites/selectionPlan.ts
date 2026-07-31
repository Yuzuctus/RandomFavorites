/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface SelectionPlan<Kind, Candidate> {
    candidates: Candidate[];
    missingKinds: Kind[];
}

export function buildSelectionPlan<Kind, Candidate>(
    kinds: readonly Kind[],
    selectEachKind: boolean,
    pickFromKind: (kind: Kind) => Candidate | undefined,
    pickFromKinds: (kinds: readonly Kind[]) => Candidate | undefined,
): SelectionPlan<Kind, Candidate> {
    if (!selectEachKind) {
        const candidate = pickFromKinds(kinds);

        return {
            candidates: candidate ? [candidate] : [],
            missingKinds: [],
        };
    }

    const candidates: Candidate[] = [];
    const missingKinds: Kind[] = [];

    for (const kind of kinds) {
        const candidate = pickFromKind(kind);
        if (candidate)
            candidates.push(candidate);
        else
            missingKinds.push(kind);
    }

    return { candidates, missingKinds };
}
