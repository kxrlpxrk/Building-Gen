/** Bounded BG-06C composition pass. Existing roof/ornament validators stay authoritative. */
import type { Project, Section } from "./model";
import { validateProject } from "./model";
import { defaultRoofFeature } from "./roofFeatures";
import { ridgeAlongX } from "./exteriorSettings";
import {
  ornamentPreset,
  suggestedOrnament,
  ornamentRoofSurface,
  validateOrnamentation,
  type OrnamentLevel,
  type Ornament,
} from "./ornamentation";
import { openingContext } from "./assembly";
import { hashSeed } from "./layoutGenerator";
export const CROSS_GABLE_COMPLEXITIES = [
  "None",
  "Occasional",
  "Prominent",
] as const;
export type CrossGableComplexity = (typeof CROSS_GABLE_COMPLEXITIES)[number];
export type AdvancedArchitecture = {
  crossGables: CrossGableComplexity;
  ornamentation: OrnamentLevel;
  seed: string;
};
/** Mutates only a private proposal, never a source project. No random UUIDs in proposals. */
export function generateArchitecturalDetails(
  project: Project,
  config: AdvancedArchitecture,
  variant: number,
) {
  const b = project.building,
    warnings: string[] = [];
  const ns = `${b.id}-design-${variant}`;
  let roofTrials = 0;
  const roofTarget =
    config.crossGables === "Prominent"
      ? 2
      : config.crossGables === "Occasional"
        ? 1
        : 0;
  const hosts = b.sections.filter(
    (s) =>
      !s.locked && s.kind === "rectangle" && s.exterior.roofStyle === "Gable",
  );
  const jitter = ((hashSeed(config.seed + ":roof") % 5) - 2) * 0.015;
  // Main hall first. A second separated bay is only attempted on a generous hall;
  // smaller compositions may use one subordinate wing instead.
  const bays = [
    ...hosts,
    ...hosts.filter((s) => Math.max(s.length, s.width) >= 14000),
  ];
  let roofCount = 0;
  for (const s of bays) {
    if (roofCount >= roofTarget || roofTrials >= 64) break;
    if (s.exterior.roofFeatures.length >= 2) continue;
    const x = ridgeAlongX(s),
      span = x ? s.length : s.width,
      run = x ? s.width : s.length;
    const fractions = s.exterior.roofFeatures.length
      ? [0.72, 0.28, 0.5]
      : variant === 0
        ? [0.5, 0.32, 0.68]
        : variant === 1
          ? [0.36 + jitter, 0.64 - jitter, 0.5]
          : [0.68 - jitter, 0.32 + jitter, 0.5];
    // Both ends when possible, otherwise a genuine one-sided projection whose
    // internal cutoff must be buried by validateRoofFeatures().
    const sides =
      variant === 1
        ? (["Negative", "Positive", "Both"] as const)
        : (["Both", "Positive", "Negative"] as const);
    let accepted = false,
      reason = "No exposed Gable host bay.";
    for (const fraction of fractions) {
      if (accepted || roofTrials >= 64) break;
      for (const ratio of [0.78, 0.55, 0.38]) {
        if (accepted || roofTrials >= 64) break;
        for (const side of sides) {
          if (accepted || roofTrials >= 64) break;
          const width =
            Math.round(Math.min(10000, span * 0.34, run * ratio) / 100) * 100;
          if (width < 1800) continue;
          const f = {
            ...defaultRoofFeature(s, `${ns}-cross-${roofCount}`),
            width,
            offset: Math.round((span * fraction) / 100) * 100,
            side,
            depth:
              side === "Both"
                ? run
                : Math.min(run, Math.round((run * 0.6) / 100) * 100),
            // Related to the host pitch, rather than independently random.
            pitch: Math.max(
              20,
              Math.min(60, s.exterior.roofPitch + (variant === 2 ? 2 : 0)),
            ),
            relativeHeight: 0,
          };
          roofTrials++;
          s.exterior.roofFeatures.push(f);
          try {
            validateProject(project);
            roofCount++;
            accepted = true;
          } catch (e) {
            s.exterior.roofFeatures.pop();
            reason = (e as Error).message;
          }
        }
      }
    }
    if (!accepted && roofTrials >= 64)
      warnings.push(
        `Cross-gable search stopped after 64 validated trials: ${reason}`,
      );
  }
  if (roofCount < roofTarget)
    warnings.push(
      `${config.crossGables} cross-gable preference reduced: ${roofCount} of ${roofTarget} roof-only features fit exposed supported bays within the bounded search. ${hosts.length ? "Attachments, roof/feature clearances and separated-bay limits were kept." : "No rectangular Gable host is available."}`,
    );
  if (config.ornamentation === "None")
    return { warnings, roofTrials, roofCount, ornamentCount: 0 };

  const supports = {
    roofAt: ornamentRoofSurface(b),
    opening: openingContext(b),
  };
  let serial = 0,
    total = 0;
  const nextId = () => `${ns}-carving-${serial++}`;
  // Strong main-hall emphasis; supporting wings get restrained detail rather than
  // copies of every dragon/panel. Never decorate locked or unsupported hosts.
  for (const [index, s] of b.sections.entries()) {
    if (s.locked) {
      warnings.push(
        `${s.name}: ornament preference omitted because the section is locked.`,
      );
      continue;
    }
    const level: OrnamentLevel = index === 0 ? config.ornamentation : "Subtle";
    const medieval = s.exterior.stylePreset.startsWith("Medieval");
    const preset = ornamentPreset(b, s, level, nextId);
    warnings.push(...preset.messages.map((m) => `${s.name}: ${m}`));
    const crosses: Ornament[] = [];
    for (const f of s.exterior.roofFeatures) {
      for (const end of (f.side === "Both"
        ? ["Negative", "Positive"]
        : [f.side]) as ("Negative" | "Positive")[]) {
        const types: Ornament["type"][] =
          level === "Subtle"
            ? ["Gable finial"]
            : [
                medieval ? "Gable finial" : "Dragon head",
                "Bargeboard",
                "Gable panel",
              ];
        for (const type of types) {
          const o = suggestedOrnament(b, s, type, nextId());
          o.anchor = { kind: "roof", roofFeatureId: f.id, end, offset: 0 };
          o.variant = level === "Fantasy" ? 3 : (((variant % 2) + 1) as 1 | 2);
          o.scale =
            type === "Dragon head" ? (level === "Fantasy" ? 1150 : 900) : 900;
          crosses.push(o);
        }
      }
    }
    // Keep the main terminals/entrance, then emphasise crossing gables before
    // filling remaining clear bays. Medieval generations omit shield displays.
    const primary = (o: Ornament) =>
      ["Dragon head", "Gable finial", "Entrance pillars"].includes(o.type);
    const pool = [
      ...preset.ornamentation.items.filter(primary),
      ...crosses.filter(primary),
      ...preset.ornamentation.items.filter(
        (o) => !primary(o) && o.type !== "Shield",
      ),
      ...crosses.filter((o) => !primary(o)),
      ...preset.ornamentation.items.filter(
        (o) => o.type === "Shield" && !medieval,
      ),
    ];
    s.exterior.ornamentation = { level, items: [] };
    const limit = index
      ? 3
      : s.exterior.stylePreset === "Rustic Norse"
        ? level === "Fantasy"
          ? 10
          : 8
        : 12;
    let omitted = 0;
    for (const o of pool) {
      if (s.exterior.ornamentation.items.length >= limit || total >= 48) {
        omitted++;
        continue;
      }
      // Deterministic variation in relief/finish; no random geometry or anchors.
      if (o.type !== "Dragon head" && o.type !== "Gable finial")
        o.variant = level === "Fantasy" ? 3 : (((variant % 2) + 1) as 1 | 2);
      o.finish = medieval
        ? "Dark wood"
        : variant === 1
          ? "Weathered wood"
          : "Oiled wood";
      s.exterior.ornamentation.items.push(o);
      try {
        validateOrnamentation(b, supports);
        total++;
      } catch (e) {
        s.exterior.ornamentation.items.pop();
        warnings.push(`${s.name}: ${o.type} omitted: ${(e as Error).message}`);
      }
    }
    if (omitted)
      warnings.push(
        `${s.name}: ${omitted} optional carvings omitted to keep a restrained composition and ornament budget (${limit} for this section, 48 per building).`,
      );
    if (!s.exterior.ornamentation.items.length)
      warnings.push(
        `${s.name}: ${level} ornamentation omitted; no compatible clear anchors.`,
      );
  }
  return { warnings, roofTrials, roofCount, ornamentCount: total };
}
export function advancedArchitectureSummary(
  sections: Section[],
  requested: OrnamentLevel,
) {
  const roofs = sections.flatMap((s) => s.exterior.roofFeatures);
  const ornaments = sections.flatMap((s) => s.exterior.ornamentation.items);
  return `${roofs.length} cross-gables · ${requested} ornamentation · ${ornaments.length} ornaments. Main-hall emphasis with restrained supporting wings.`;
}
