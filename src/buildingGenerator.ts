import { exteriorDefaults } from "./exteriorSettings";
import { footprintVertices } from "./geometry";
import {
  duplicateProject,
  validateProject,
  type Architecture,
  type Building,
  type Project,
  type Section,
} from "./model";
import { attachmentPreview } from "./attachments";
import {
  combinedGeometry,
  prepareBuilding,
  SECTION_TYPES,
  type SectionType,
} from "./assembly";
import { applyPreset } from "./footprint";
import { bounds, edgeLength, polygonArea, SHAPES, type Shape } from "./polygon";
import { deriveInterior } from "./interior";
import { hashSeed, minimumSpans } from "./layoutGenerator";
export const PURPOSES = [
  "Longhouse",
  "Cottage",
  "Farmhouse",
  "Workshop",
  "Tavern/Inn",
  "Manor",
  "Trading Hall",
] as const;
export const COMPLEXITIES = ["Simple", "Organic", "Grand"] as const;
export type BuildingPurpose = (typeof PURPOSES)[number];
export type BuildingConfig = {
  architecture: Architecture;
  purpose: BuildingPurpose;
  complexity: (typeof COMPLEXITIES)[number];
  length: number;
  width: number;
  extensions: number;
  preferredTypes: SectionType[];
  outline: "Auto" | Shape;
  seed: string;
};
export type BuildingProposal = {
  label: string;
  project: Project;
  exteriorArea: number;
  interiorArea: number;
  length: number;
  width: number;
  score: number;
  explanation: string[];
  warnings: string[];
};
export type BuildingResult = {
  proposals: BuildingProposal[];
  messages: string[];
  trials: number;
  attempts: number;
};
export const BUILDING_TRIAL_LIMIT = 1600;
export const BUILDING_ATTEMPT_LIMIT = 32;
export const defaultBuildingConfig = (): BuildingConfig => ({
  architecture: "Norse",
  purpose: "Longhouse",
  complexity: "Simple",
  length: 18000,
  width: 8000,
  extensions: 1,
  preferredTypes: [],
  outline: "Auto",
  seed: "2041",
});
const profiles: Record<
  BuildingPurpose,
  { ratio: number; main: string; type: SectionType; extensions: SectionType[] }
> = {
  Longhouse: {
    ratio: 2.7,
    main: "Main longhouse hall",
    type: "Hall Extension",
    extensions: ["Storage", "Porch", "Hall Extension"],
  },
  Cottage: {
    ratio: 1.4,
    main: "Main cottage",
    type: "Residential Wing",
    extensions: ["Porch", "Storage", "Residential Wing"],
  },
  Farmhouse: {
    ratio: 1.7,
    main: "Main farmhouse",
    type: "Residential Wing",
    extensions: ["Residential Wing", "Storage", "Workshop", "Porch"],
  },
  Workshop: {
    ratio: 1.6,
    main: "Main workshop",
    type: "Workshop",
    extensions: ["Storage", "Workshop", "Porch"],
  },
  "Tavern/Inn": {
    ratio: 1.8,
    main: "Public tavern hall",
    type: "Hall Extension",
    extensions: ["Residential Wing", "Hall Extension", "Storage", "Porch"],
  },
  Manor: {
    ratio: 1.5,
    main: "Main manor hall",
    type: "Hall Extension",
    extensions: [
      "Residential Wing",
      "Hall Extension",
      "Tower Footprint",
      "Porch",
    ],
  },
  "Trading Hall": {
    ratio: 2.2,
    main: "Main trading hall",
    type: "Hall Extension",
    extensions: ["Storage", "Hall Extension", "Workshop", "Porch"],
  },
};
export function buildingConfigError(c: BuildingConfig): string | null {
  if (
    !["Norse", "Medieval", "Mixed"].includes(c.architecture) ||
    !PURPOSES.includes(c.purpose) ||
    !COMPLEXITIES.includes(c.complexity)
  )
    return "Choose a supported architecture, purpose and complexity.";
  if (
    ![c.length, c.width].every(
      (n) => Number.isSafeInteger(n) && n >= 4000 && n <= 60000,
    )
  )
    return "Main dimensions must be 4–60 m, in whole millimetres. Manual editing supports larger buildings.";
  if (!Number.isInteger(c.extensions) || c.extensions < 0 || c.extensions > 5)
    return "Request exactly 0–5 extensions.";
  if (
    !Array.isArray(c.preferredTypes) ||
    c.preferredTypes.length > SECTION_TYPES.length ||
    c.preferredTypes.some((t) => !SECTION_TYPES.includes(t)) ||
    new Set(c.preferredTypes).size !== c.preferredTypes.length
  )
    return "Choose distinct supported extension preferences.";
  if (c.outline !== "Auto" && !SHAPES.includes(c.outline))
    return "Choose a supported main outline.";
  if (!c.seed.trim() || c.seed.length > 64)
    return "Use a seed of 1–64 characters.";
  if (c.purpose === "Longhouse" && c.length < c.width * 1.8)
    return "A longhouse requires main length ≥ 1.8 × width. Increase length, reduce width or choose another purpose; dimensions will not be changed silently.";
  return null;
}
function rng(seed: string) {
  let state = hashSeed(seed);
  return () => {
    state += 0x6d2b79f5;
    let n = state;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}
const round = (n: number) => Math.round(n / 100) * 100;
function outlines(c: BuildingConfig): Shape[] {
  if (c.outline !== "Auto") return [c.outline];
  if (c.complexity === "Simple" || c.purpose === "Longhouse")
    return ["Rectangle"];
  if (c.complexity === "Organic")
    return ["Rectangle", "L-shape", "Irregular", "T-shape"];
  return c.architecture === "Norse"
    ? ["Rectangle", "T-shape", "L-shape", "U-shape"]
    : ["T-shape", "U-shape", "Cross", "L-shape", "Rectangle"];
}
function baseProject(c: BuildingConfig, ns: string, shape: Shape): Project {
  const p = profiles[c.purpose];
  const main: Section = applyPreset(
    {
      id: ns + "-main",
      name: p.main,
      type: p.type,
      locked: false,
      kind: "rectangle",
      position: { x: 0, y: 0, z: 0 },
      length: c.length,
      width: c.width,
      wallThickness: 200,
      orientation: 0,
      floorCount: 1,
      exterior: exteriorDefaults(c.architecture, p.type, true),
    },
    shape,
  );
  const building = prepareBuilding({
    id: ns + "-building",
    mainSectionId: main.id,
    frame: { origin: { x: 0, y: 0 }, axis: 0, rotation: 0, mode: "assembly" },
    sections: [main],
    connections: [],
    interior: { partitions: [], rooms: [] },
    openings: [],
  });
  return {
    schemaVersion: 8,
    id: ns + "-project",
    name: `${c.architecture} ${c.purpose}`,
    architecture: c.architecture,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    building,
  };
}
/** prepareBuilding creates fresh connection identities. Normalize temporary IDs
 * from geometric endpoints immediately so worker results are reproducible. */
function stableConnections(b: Building, ns: string): Building {
  return {
    ...b,
    connections: b.connections.map((j) => ({
      ...j,
      id:
        ns +
        "-join-" +
        hashSeed(JSON.stringify([j.a, j.b, j.start, j.end])).toString(16),
    })),
  };
}
const signature = (b: Building) =>
  JSON.stringify(
    b.sections.map((s) => ({
      kind: s.kind,
      vertices: s.kind === "polygon" ? s.vertices : undefined,
      length: s.length,
      width: s.width,
      position: s.position,
      orientation: s.orientation,
    })),
  );
function distinct(a: Building, b: Building) {
  if (signature(a) === signature(b)) return false;
  const av = combinedGeometry(a).vertices,
    bv = combinedGeometry(b).vertices;
  // Compare physical exterior geometry, not names, section IDs or partitions of
  // the same rectangle. At least a 0.4 m boundary change counts as a variation.
  const distance = (p: { x: number; y: number }, ring: typeof av) =>
    Math.min(
      ...ring.map((q, i) => {
        const r = ring[(i + 1) % ring.length];
        return Math.hypot(
          p.x - Math.max(Math.min(q.x, r.x), Math.min(Math.max(q.x, r.x), p.x)),
          p.y - Math.max(Math.min(q.y, r.y), Math.min(Math.max(q.y, r.y), p.y)),
        );
      }),
    );
  return (
    av.some((p) => distance(p, bv) >= 400) ||
    bv.some((p) => distance(p, av) >= 400)
  );
}
function scoreBuilding(project: Project, c: BuildingConfig): BuildingProposal {
  const b = project.building,
    g = combinedGeometry(b),
    box = bounds(g.vertices),
    profile = profiles[c.purpose];
  const total = polygonArea(g.vertices),
    main = polygonArea(footprintVertices(b.sections[0]));
  const preferred = c.preferredTypes.filter((t) =>
    b.sections.slice(1).some((s) => s.type === t),
  );
  const imbalance =
    Math.abs((box.maxX + box.minX) / 2 - c.length / 2) /
      Math.max(box.length, 1) +
    Math.abs((box.maxY + box.minY) / 2 - c.width / 2) / Math.max(box.width, 1);
  const ratioPenalty =
    Math.abs(Math.log(c.length / c.width / profile.ratio)) * 30;
  const shapePenalty =
    c.architecture === "Norse" && b.sections[0].kind !== "rectangle" ? 8 : 0;
  const asymmetry =
    c.complexity === "Organic"
      ? imbalance * 20
      : c.complexity === "Grand"
        ? (1 - imbalance) * 8
        : 0;
  const perimeter = g.vertices.reduce(
    (n, _, i) => n + edgeLength(g.vertices, i),
    0,
  );
  const compactness = (perimeter * perimeter) / (16 * total);
  const score =
    Math.round(
      (100 -
        ratioPenalty -
        shapePenalty -
        Math.max(0, compactness - 1) * 4 +
        asymmetry +
        preferred.length * 4 -
        Math.max(0, (total - main) / main - 2) * 8) *
        100,
    ) / 100;
  return {
    label: "",
    project,
    exteriorArea: total,
    interiorArea: polygonArea(g.inner),
    length: box.length,
    width: box.width,
    score,
    explanation: [
      `${c.purpose}: ${profile.main.toLowerCase()}, ${b.sections.length - 1} connected support section(s).`,
      `${c.complexity}: ${c.complexity === "Organic" ? "offset attachments and varied proportions" : c.complexity === "Grand" ? "larger wings and multiple attachment directions" : "compact rectangle-based composition"}.`,
      `${preferred.length}/${c.preferredTypes.length} preferred extension types represented. All joins are open-plan; clear spans ≥ 1.8 m.`,
    ],
    warnings: [
      ...(ratioPenalty > Math.log(1.6) * 30
        ? [
            `Exact main proportions ${c.length / 1000} × ${c.width / 1000} m depart from the ${c.purpose} preference of approximately ${profile.ratio}:1. Your dimensions were preserved.`,
          ]
        : []),
      ...c.preferredTypes
        .filter((t) => !preferred.includes(t))
        .map(
          (t) =>
            `Preference not included: ${t}. Preferences never change the requested extension count.`,
        ),
    ],
  };
}
/** Pure seeded composition search. Existing attachment/union/inset validators are
 * authoritative. No source project is read, modified or persisted here. */
export function generateBuildings(
  c: BuildingConfig,
  onProgress?: (n: number) => void,
): BuildingResult {
  const error = buildingConfigError(c);
  if (error) throw new Error(error);
  c = {
    ...c,
    preferredTypes: SECTION_TYPES.filter((t) => c.preferredTypes.includes(t)),
  };
  const digest = JSON.stringify([
    c.architecture,
    c.purpose,
    c.complexity,
    c.length,
    c.width,
    c.extensions,
    c.preferredTypes,
    c.outline,
    c.seed,
  ]);
  const rand = rng(digest),
    ns = "bgen-" + hashSeed(digest).toString(16),
    shapes = outlines(c);
  const valid: BuildingProposal[] = [];
  let trials = 0,
    attempts = 0,
    lastReason =
      "No attachment met all exact geometry and clear-span constraints.";
  for (
    ;
    attempts < BUILDING_ATTEMPT_LIMIT && trials < BUILDING_TRIAL_LIMIT;
    attempts++
  ) {
    try {
      const shape = shapes[attempts % shapes.length];
      const project = baseProject(c, `${ns}-${attempts}`, shape);
      let building = project.building;
      if (
        !deriveInterior(combinedGeometry(building).inner, []).regions.every(
          minimumSpans,
        )
      )
        throw new Error(
          "Main outline has a clear limb narrower than 1.8 m. Enlarge the main dimensions or choose a simpler outline.",
        );
      for (let i = 0; i < c.extensions; i++) {
        let attached: Building | null = null;
        const profile = profiles[c.purpose],
          preferred = c.preferredTypes;
        // Preferences weight section types; the purpose supplies defaults.
        // Neither can remove a mandatory extension.
        const type =
          preferred.length && rand() < 0.75
            ? preferred[i % preferred.length]
            : profile.extensions[i % profile.extensions.length];
        const outline = combinedGeometry(building).vertices;
        for (let t = 0; t < 36 && trials < BUILDING_TRIAL_LIMIT; t++) {
          trials++;
          if (trials % 20 === 0) onProgress?.(trials);
          const edge = Math.floor(rand() * outline.length),
            edgeSpan = edgeLength(outline, edge);
          if (edgeSpan < 2400) continue;
          const grand =
            c.complexity === "Grand"
              ? 1.2
              : c.complexity === "Simple"
                ? 0.85
                : 1;
          const porch = type === "Porch",
            tower = type === "Tower Footprint";
          let length = round(
            Math.max(
              2400,
              Math.min(
                edgeSpan * (0.4 + rand() * 0.4),
                c.length * (porch ? 0.25 : 0.48) * grand,
              ),
            ),
          );
          let width = round(
            Math.max(
              2400,
              Math.min(
                10000,
                c.width * (porch ? 0.3 : 0.4 + rand() * 0.35) * grand,
              ),
            ),
          );
          if (tower)
            length = width = Math.max(3000, Math.min(6000, length, width));
          const offset = round(
            (edgeSpan - length) *
              (c.complexity === "Simple" ? 0.5 : 0.08 + rand() * 0.84),
          );
          const candidate = attachmentPreview(building, {
            id: `${ns}-${attempts}-section-${i}`,
            name: `${type} ${i + 1}`,
            type,
            length,
            width,
            shape: "Rectangle",
            edge,
            offset,
          });
          if (!candidate.building) {
            lastReason = candidate.error ?? lastReason;
            continue;
          }
          const b = stableConnections(candidate.building, `${ns}-${attempts}`),
            g = combinedGeometry(b);
          if (
            g.contacts.some(
              (j) =>
                Math.abs(j.start.x - j.end.x) + Math.abs(j.start.y - j.end.y) <
                2200,
            )
          ) {
            lastReason =
              "An attachment would create a shared edge shorter than 2.2 m.";
            continue;
          }
          if (!deriveInterior(g.inner, []).regions.every(minimumSpans)) {
            lastReason =
              "An attachment would create a clear limb or neck narrower than 1.8 m.";
            continue;
          }
          const mainArea = polygonArea(footprintVertices(b.sections[0]));
          if (length * width > mainArea * (porch ? 0.3 : 0.75)) {
            lastReason =
              "A supporting extension would dominate the main structure.";
            continue;
          }
          attached = b;
          break;
        }
        if (!attached) throw new Error(lastReason);
        building = attached;
      }
      project.building = building;
      const checked = validateProject(project),
        proposal = scoreBuilding(checked, c);
      valid.push(proposal);
    } catch (e) {
      lastReason = (e as Error).message;
    }
    if (!c.extensions && shapes.length === 1) {
      attempts++;
      break;
    }
  }
  valid.sort(
    (a, b) =>
      b.score - a.score ||
      signature(a.project.building).localeCompare(
        signature(b.project.building),
      ),
  );
  const proposals: BuildingProposal[] = [];
  for (const p of valid) {
    if (
      proposals.every((old) =>
        distinct(old.project.building, p.project.building),
      )
    )
      proposals.push({
        ...p,
        label: String.fromCharCode(65 + proposals.length),
      });
    if (proposals.length === 3) break;
  }
  return {
    proposals,
    trials,
    attempts,
    messages: proposals.length
      ? proposals.length < 3
        ? [
            `Found ${proposals.length} meaningfully distinct valid proposal(s); fewer than 3 exist within this bounded search. Fixed dimensions with no extensions and a fixed outline allow only one geometry.`,
          ]
        : []
      : [
          `No valid composition found in ${attempts} attempts / ${trials} attachment trials. ${lastReason} Exact main dimensions and all ${c.extensions} requested extensions were kept mandatory. Try larger dimensions, fewer extensions, a simpler outline or another seed. This bounded search does not prove all arrangements impossible. Your original project is unchanged.`,
        ],
  };
}
/** Accept only validated footprint-only proposals; independently rekey all
 * project/building/section/connection IDs before any storage write. */
export function createGeneratedProject(
  proposal: BuildingProposal,
  name: string,
): Project {
  const checked = validateProject(proposal.project),
    b = checked.building;
  if (!name.trim() || name.trim().length > 100)
    throw new Error("Enter a project name of 1–100 characters.");
  if (
    b.interior.partitions.length ||
    b.interior.rooms.length ||
    b.openings.length ||
    b.sections.some((s) => s.locked)
  )
    throw new Error(
      "A generated building must contain only unlocked footprint sections, without interiors or openings.",
    );
  if (
    !deriveInterior(combinedGeometry(b).inner, []).regions.every(minimumSpans)
  )
    throw new Error("Generated clear spans must be at least 1.8 m.");
  return validateProject(duplicateProject(checked, name.trim()));
}
