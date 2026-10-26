/** Transient reconciliation only. Canonical validators decide every attachment. */
import type { Building } from "./model";
import { prepareBuilding, openingContext } from "./assembly";
import { validateExterior } from "./exteriorValidation";
import {
  ornamentRoofSurface,
  validateOrnamentation,
  resolveOrnament,
  type Ornament,
  type OrnamentAnchor,
} from "./ornamentation";
export type DecorationChanges = {
  moved: number;
  removed: number;
  removals: string[];
};
export function decorationChangeSummary(changes: DecorationChanges) {
  const reasons = [...new Set(changes.removals)].slice(0, 3).join("; ");
  return `${changes.moved} ornaments repositioned; ${changes.removed} removed.${reasons ? " Removed: " + reasons + "." : ""} Undo restores the previous roof and decorations.`;
}
function alternatives(
  b: Building,
  sectionId: string,
  o: Ornament,
): OrnamentAnchor[] {
  const a = o.anchor,
    s = b.sections.find((s) => s.id === sectionId)!;
  if (a.kind === "roof") {
    const ends = [
      a.end,
      a.end === "Positive" ? "Negative" : "Positive",
    ] as const;
    const refs = [
      a.roofFeatureId,
      ...[null, ...s.exterior.roofFeatures.map((f) => f.id)].filter(
        (id) => id !== a.roofFeatureId,
      ),
    ];
    return refs.flatMap((roofFeatureId) =>
      ends.flatMap((end) =>
        [a.offset, 0].map((offset) => ({
          kind: "roof" as const,
          roofFeatureId,
          end,
          offset,
        })),
      ),
    );
  }
  if (a.kind === "wall")
    return [0, -250, 250, -500, 500, -1000, 1000].flatMap((dx) =>
      [0, -250, -500, -1000].map((dz) => ({
        ...a,
        offset: a.offset + dx,
        sill: a.sill + dz,
      })),
    );
  return []; // Entrance carvings never lose their real entrance reference.
}
export function reconcileRoofDecorations(
  candidate: Building,
  editedSectionId?: string,
) {
  const changes: DecorationChanges = { moved: 0, removed: 0, removals: [] };
  // No obsolete decorative anchors participate in structural validation.
  let next = prepareBuilding({
    ...candidate,
    sections: candidate.sections.map((s) => ({
      ...s,
      exterior: {
        ...s.exterior,
        ornamentation: { ...s.exterior.ornamentation, items: [] },
        features: s.exterior.features.filter(
          (f) => f.kind !== "Gable ornament",
        ),
      },
    })),
  });
  const cache = {
    roofAt: ornamentRoofSurface(next),
    opening: openingContext(next),
  };
  const ordered = [...candidate.sections].sort(
    (a, b) =>
      Number(b.locked) - Number(a.locked) ||
      Number(a.id === editedSectionId) - Number(b.id === editedSectionId),
  );
  const remove = (sectionId: string, label: string) => {
    if (candidate.sections.find((s) => s.id === sectionId)!.locked)
      throw new Error(
        `Roof change would invalidate decoration on a locked section. Unlock it before changing this roof.`,
      );
    changes.removed++;
    changes.removals.push(label);
  };
  // Legacy paired features cannot be converted into invented single-ended records.
  for (const s of ordered)
    for (const f of s.exterior.features.filter(
      (f) => f.kind === "Gable ornament",
    )) {
      const trial = {
        ...next,
        sections: next.sections.map((t) =>
          t.id === s.id
            ? {
                ...t,
                exterior: {
                  ...t.exterior,
                  features: [...t.exterior.features, f],
                },
              }
            : t,
        ),
      };
      try {
        validateExterior(trial);
        next = trial;
      } catch {
        remove(s.id, "paired gable ornament: both exposed ends unavailable");
      }
    }
  const append = (id: string, o: Ornament) => ({
    ...next,
    sections: next.sections.map((s) =>
      s.id === id
        ? {
            ...s,
            exterior: {
              ...s.exterior,
              ornamentation: {
                ...s.exterior.ornamentation,
                items: [...s.exterior.ornamentation.items, o],
              },
            },
          }
        : s,
    ),
  });
  const pending: { sectionId: string; ornament: Ornament }[] = [];
  // Reserve still-valid originals before searching replacements, including other
  // sections whose roof support may have changed under the merged envelope.
  const withoutOrnaments = next;
  const supported: { sectionId: string; ornament: Ornament }[] = [];
  for (const s of ordered)
    for (const o of s.exterior.ornamentation.items) {
      try {
        resolveOrnament(
          next,
          next.sections.find((t) => t.id === s.id)!,
          o,
          cache.roofAt,
          cache.opening,
        );
        supported.push({ sectionId: s.id, ornament: o });
        next = append(s.id, o);
      } catch {
        pending.push({ sectionId: s.id, ornament: o });
      }
    }
  try {
    validateOrnamentation(next, cache);
  } catch {
    // Only colliding originals require incremental reservation. The usual path
    // resolves support once per ornament and validates the collection once.
    next = withoutOrnaments;
    for (const item of supported) {
      const trial = append(item.sectionId, item.ornament);
      try {
        validateOrnamentation(trial, cache);
        next = trial;
      } catch {
        pending.push(item);
      }
    }
  }
  for (const { sectionId, ornament: o } of pending) {
    if (candidate.sections.find((s) => s.id === sectionId)!.locked)
      throw new Error(
        "Roof change would invalidate ornament support on a locked section. Unlock it before changing this roof.",
      );
    let found = false;
    for (const anchor of alternatives(next, sectionId, o)) {
      const trial = append(sectionId, { ...o, anchor });
      try {
        validateOrnamentation(trial, cache);
        next = trial;
        changes.moved++;
        found = true;
        break;
      } catch {
        /* bounded alternative */
      }
    }
    if (!found) remove(sectionId, `${o.type}: no safe supported anchor`);
  }
  // Retain original collection order so unaffected records roundtrip exactly.
  next = {
    ...next,
    sections: next.sections.map((s) => {
      const original = candidate.sections.find((t) => t.id === s.id)!;
      return {
        ...s,
        exterior: {
          ...s.exterior,
          features: original.exterior.features.filter((f) =>
            s.exterior.features.some((t) => t.id === f.id),
          ),
          ornamentation: {
            ...s.exterior.ornamentation,
            items: original.exterior.ornamentation.items.flatMap((o) =>
              s.exterior.ornamentation.items.filter((t) => t.id === o.id),
            ),
          },
        },
      };
    }),
  };
  validateExterior(next);
  return { building: next, changes };
}
