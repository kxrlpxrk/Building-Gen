/** BG-05 orchestration. Canonical records only; no alternate geometry engine. */
import {
  generateBuildings,
  type BuildingConfig,
  type BuildingPurpose,
  type BuildingProposal,
  type BuildingResult,
} from "./buildingGenerator";
import {
  STYLE_PRESETS,
  ROOF_STYLES,
  exteriorDefaults,
  styleMaterial,
  type ExteriorSettings,
  type ExteriorFeature,
} from "./exteriorSettings";
import { openingContext, combinedGeometry } from "./assembly";
import { rotate } from "./geometry";
import { validateProject, duplicateProject, type Project } from "./model";
import { buildExterior } from "./exteriorGeometry";
import { hashSeed } from "./layoutGenerator";
import { polygonArea } from "./polygon";
export const SCALES = ["Small", "Medium", "Large", "Custom"] as const;
export const DENSITIES = ["None", "Few", "Moderate", "Many"] as const;
export type ArchitecturalConfig = {
  purpose: BuildingPurpose;
  style: ExteriorSettings["stylePreset"];
  scale: (typeof SCALES)[number];
  complexity: BuildingConfig["complexity"];
  length: number;
  width: number;
  extensions: number;
  roofs: ExteriorSettings["roofStyle"][];
  windows: (typeof DENSITIES)[number];
  detail: ExteriorSettings["detailLevel"];
  chimneys: boolean;
  ornaments: boolean;
  canopies: boolean;
  seed: string;
};
const proportions: Record<BuildingPurpose, [number, number, number]> = {
  Longhouse: [18000, 8000, 1],
  Cottage: [10000, 7000, 0],
  Farmhouse: [14000, 8000, 2],
  Workshop: [12000, 8000, 1],
  "Tavern/Inn": [16000, 10000, 2],
  Manor: [18000, 12000, 3],
  "Trading Hall": [20000, 9000, 2],
};
export function purposeDefaults(purpose: BuildingPurpose): ArchitecturalConfig {
  const [length, width, extensions] = proportions[purpose];
  return {
    purpose,
    length,
    width,
    extensions,
    style:
      purpose === "Longhouse"
        ? "Rustic Norse"
        : purpose === "Manor"
          ? "Medieval Manor"
          : "Medieval Timber Cottage",
    scale: "Medium",
    complexity: purpose === "Manor" ? "Grand" : "Simple",
    roofs: ["Gable", "Hip", "Shed"],
    windows: purpose === "Workshop" ? "Few" : "Moderate",
    detail: "Standard",
    chimneys: purpose !== "Longhouse",
    ornaments: purpose === "Longhouse",
    canopies: true,
    seed: "2041",
  };
}
export const defaultArchitecturalConfig = () => purposeDefaults("Longhouse");
export function architecturalConfigError(
  c: ArchitecturalConfig,
): string | null {
  if (
    !c ||
    !Object.hasOwn(proportions, c.purpose) ||
    !STYLE_PRESETS.includes(c.style) ||
    !SCALES.includes(c.scale) ||
    !DENSITIES.includes(c.windows) ||
    !["Simple", "Organic", "Grand"].includes(c.complexity) ||
    !["Low", "Standard", "High"].includes(c.detail)
  )
    return "Choose supported purpose, style, scale, complexity, windows and detail settings.";
  if (
    !Array.isArray(c.roofs) ||
    !c.roofs.length ||
    c.roofs.some((r) => !ROOF_STYLES.includes(r))
  )
    return "Choose at least one supported roof type.";
  if (!Number.isInteger(c.extensions) || c.extensions < 0 || c.extensions > 5)
    return "Extension preference must be 0–5.";
  if (
    ![c.chimneys, c.ornaments, c.canopies].every(
      (v) => typeof v === "boolean",
    ) ||
    typeof c.seed !== "string" ||
    c.seed.length > 64
  )
    return "Invalid feature preferences or seed (maximum 64 characters).";
  if (
    c.scale === "Custom" &&
    ![c.length, c.width].every(
      (n) => Number.isSafeInteger(n) && n >= 4000 && n <= 60000,
    )
  )
    return "Custom dimensions must be 4–60 m in whole millimetres.";
  return null;
}
export function generateArchitecturalBuildings(
  c: ArchitecturalConfig,
  onProgress?: (n: number) => void,
): BuildingResult {
  const error = architecturalConfigError(c);
  if (error) throw new Error(error);
  c = { ...c, roofs: ROOF_STYLES.filter((roof) => c.roofs.includes(roof)) };
  const material = styleMaterial(c.style),
    multiplier = c.scale === "Small" ? 0.75 : c.scale === "Large" ? 1.3 : 1;
  const dimensions = proportions[c.purpose];
  const base: BuildingConfig = {
    architecture: material,
    purpose: c.purpose,
    complexity: c.complexity,
    length:
      c.scale === "Custom"
        ? c.length
        : Math.round((dimensions[0] * multiplier) / 100) * 100,
    width:
      c.scale === "Custom"
        ? c.width
        : Math.round((dimensions[1] * multiplier) / 100) * 100,
    extensions: c.extensions,
    preferredTypes: [],
    outline: "Rectangle",
    seed: String(
      hashSeed(
        JSON.stringify([
          c.purpose,
          c.style,
          c.scale,
          c.complexity,
          c.scale === "Custom" ? c.length : dimensions[0] * multiplier,
          c.scale === "Custom" ? c.width : dimensions[1] * multiplier,
          c.extensions,
          c.roofs,
          c.windows,
          c.detail,
          c.chimneys,
          c.ornaments,
          c.canopies,
          c.seed,
        ]),
      ),
    ),
  };
  // Rectangular source sections intentionally keep the repaired intersection system
  // in its supported domain. Organic form comes from attachments, not fake roofs.
  let result = generateBuildings(base, onProgress);
  const messages: string[] = [];
  let attempts = result.attempts,
    trials = result.trials;
  if (!result.proposals.length && c.extensions > 0) {
    for (let count = c.extensions - 1; count >= 0; count--) {
      result = generateBuildings({ ...base, extensions: count }, onProgress);
      attempts += result.attempts;
      trials += result.trials;
      if (result.proposals.length) {
        messages.push(
          `Extension preference reduced from ${c.extensions} to ${count}: no validated composition was found at the requested count.`,
        );
        break;
      }
    }
  }
  if (!result.proposals.length) messages.push(...result.messages);
  const proposals: BuildingProposal[] = [];
  const sources =
    result.proposals.length === 1
      ? [result.proposals[0], result.proposals[0], result.proposals[0]]
      : result.proposals;
  for (let variant = 0; variant < sources.length; variant++) {
    const p = structuredClone(sources[variant]),
      b = p.project.building,
      warnings: string[] = [];
    const mainHeight =
      (c.purpose === "Manor"
        ? 4600
        : c.purpose === "Trading Hall"
          ? 4200
          : c.purpose === "Cottage"
            ? 3000
            : 3800) +
      (c.style === "Norse Chieftain's Hall" ? 400 : 0) +
      (variant - 1) * 300;
    b.sections.forEach((s, i) => {
      const defaults = exteriorDefaults(material, s.type, i === 0),
        supporting =
          s.type === "Porch" ? 700 : s.type === "Storage" ? 500 : 350;
      const preferred = c.roofs.includes("Gable") ? "Gable" : c.roofs[0];
      const roofStyle =
        i === 0
          ? variant === 1 && material !== "Norse" && c.roofs.includes("Hip")
            ? "Hip"
            : preferred
          : s.type === "Porch" && c.roofs.includes("Shed")
            ? "Shed"
            : preferred;
      s.exterior = {
        ...defaults,
        stylePreset: c.style,
        material,
        detailLevel: c.detail,
        covering:
          c.style === "Medieval Manor"
            ? "Slate"
            : c.style === "Medieval Timber Cottage"
              ? "Clay tiles"
              : "Wood shingles",
        wallHeight: Math.max(
          2400,
          i === 0 ? mainHeight : mainHeight - supporting,
        ),
        roofStyle,
        roofPitch:
          roofStyle === "Shed"
            ? 12
            : c.style === "Norse Chieftain's Hall"
              ? 46
              : c.style === "Medieval Timber Cottage"
                ? 44
                : material === "Norse"
                  ? 42
                  : 38,
        overhang: material === "Norse" ? 400 : 300,
        ridgeAxis: s.length >= s.width ? "X" : "Y",
        shedHighEdge: s.length >= s.width ? "+Y" : "+X",
      };
    });
    // A lean-to rises toward its actual attachment, in section-local axes.
    const contacts = combinedGeometry(b).contacts;
    b.sections.forEach((s, i) => {
      if (!i || s.exterior.roofStyle !== "Shed") return;
      const join = contacts.find(
        (j) => j.a.sectionId === s.id || j.b.sectionId === s.id,
      );
      if (!join) return;
      const p = rotate(
        {
          x: (join.start.x + join.end.x) / 2 - s.position.x + b.frame.origin.x,
          y: (join.start.y + join.end.y) / 2 - s.position.y + b.frame.origin.y,
        },
        b.frame.axis - s.orientation,
      );
      const dx = (p.x - s.length / 2) / s.length,
        dy = (p.y - s.width / 2) / s.width;
      s.exterior.shedHighEdge =
        Math.abs(dx) > Math.abs(dy)
          ? dx > 0
            ? "+X"
            : "-X"
          : dy > 0
            ? "+Y"
            : "-Y";
      const parentId =
        join.a.sectionId === s.id ? join.b.sectionId : join.a.sectionId;
      const parent = b.sections.find((t) => t.id === parentId)!;
      const run = s.exterior.shedHighEdge.endsWith("X") ? s.length : s.width;
      const belowParent = Math.floor(
        parent.exterior.wallHeight -
          Math.tan((s.exterior.roofPitch * Math.PI) / 180) * run -
          150,
      );
      if (belowParent >= 2400)
        s.exterior.wallHeight = Math.min(s.exterior.wallHeight, belowParent);
      else
        warnings.push(
          `${s.name}: minimum eaves height requires the documented closed stepped roof join rather than a flush lean-to.`,
        );
    });
    for (const roof of c.roofs)
      if (!b.sections.some((s) => s.exterior.roofStyle === roof))
        warnings.push(
          `Preferred ${roof} roof not used in this composition; coordinated section roofs take priority.`,
        );
    const hosts = openingContext(b).hosts.filter(
      (h) => h.ref.kind === "exterior",
    );
    // Prefer the main hall's broad exposed facade, then all other genuine hosts.
    const ordered = [...hosts].sort((a, z) => {
      const rank = (h: typeof a) =>
        (h.ref.kind === "exterior" && h.ref.sectionId === b.mainSectionId
          ? 100000
          : 0) +
        Math.abs(h.a.x - h.b.x) +
        Math.abs(h.a.y - h.b.y);
      return rank(z) - rank(a);
    });
    let entrance = false;
    for (const h of ordered) {
      if (entrance) break;
      const span = Math.abs(h.a.x - h.b.x) + Math.abs(h.a.y - h.b.y);
      for (const fraction of [0.5, 0.25, 0.75]) {
        const door = {
          id: b.id + "-entrance",
          host: h.ref,
          offset: Math.round(span * fraction),
          width: c.purpose === "Trading Hall" ? 1200 : 900,
          type: "exterior-door" as const,
          hinge: "left" as const,
          swing: 1 as const,
        };
        b.openings = [door];
        try {
          validateProject(p.project);
          entrance = true;
          break;
        } catch {
          b.openings = [];
        }
      }
    }
    if (!entrance) {
      messages.push(
        `Candidate ${variant + 1} rejected: no validated exterior entrance bay.`,
      );
      continue;
    }
    const spacing =
      c.windows === "Few" ? 5000 : c.windows === "Moderate" ? 3200 : 2300;
    let requestedWindows = 0,
      placedWindows = 0,
      attempts = 0;
    if (c.windows !== "None")
      for (const h of hosts) {
        if (h.ref.kind !== "exterior") continue;
        const s = b.sections.find(
          (s) => s.id === (h.ref.kind === "exterior" ? h.ref.sectionId : ""),
        )!;
        if (
          s.type === "Storage" ||
          s.type === "Porch" ||
          Math.min(s.length, s.width) < 2800
        )
          continue;
        const span = Math.abs(h.a.x - h.b.x) + Math.abs(h.a.y - h.b.y),
          count = Math.min(8, Math.floor(span / spacing));
        for (let i = 0; i < count && attempts < 160; i++) {
          requestedWindows++;
          attempts++;
          const w = {
            id: `${s.id}-window-${h.ref.edge}-${i}`,
            edge: h.ref.edge,
            offset: Math.round((span * (i + 1)) / (count + 1)),
            width: material === "Norse" ? 650 : 800,
            height: material === "Norse" ? 700 : 1000,
            sill: 1100,
            style:
              material === "Norse"
                ? ("Timber shuttered" as const)
                : ("Medieval glazed" as const),
            shutters: material === "Norse",
            glazing: material !== "Norse",
          };
          s.exterior.windows.push(w);
          try {
            validateProject(p.project);
            placedWindows++;
          } catch {
            s.exterior.windows.pop();
          }
        }
      }
    if (placedWindows < requestedWindows)
      warnings.push(
        `${requestedWindows - placedWindows} optional window bays omitted for door, join, frame or roof clearance.`,
      );
    if (c.windows !== "None" && !placedWindows)
      warnings.push("No optional windows fit validated exposed wall bays.");
    const main = b.sections[0];
    const feature = (f: ExteriorFeature) => {
      main.exterior.features.push(f);
      try {
        validateProject(p.project);
      } catch (e) {
        main.exterior.features.pop();
        warnings.push(`${f.kind} omitted: ${(e as Error).message}`);
      }
    };
    if (c.chimneys)
      feature({
        id: b.id + "-chimney",
        kind: "Chimney",
        x: Math.round(main.length * 0.35),
        y: Math.round(main.width * 0.5),
        height: 1100,
        doorId: null,
        finish: material === "Medieval" ? "Brick" : "Stone",
      });
    if (c.ornaments)
      feature({
        id: b.id + "-ornament",
        kind: "Gable ornament",
        x: 0,
        y: 0,
        height: 650,
        doorId: null,
        finish: "Stone",
      });
    if (c.canopies) {
      const door = b.openings[0];
      if (door.host.kind === "exterior" && door.host.sectionId === main.id)
        feature({
          id: b.id + "-canopy",
          kind: "Entrance canopy",
          x: 0,
          y: 0,
          height: 700,
          doorId: door.id,
          finish: "Stone",
        });
      else
        warnings.push(
          "Entrance canopy omitted: the valid entrance belongs to a supporting wing.",
        );
    }
    try {
      p.project = validateProject(p.project);
      const mesh = buildExterior(b);
      if (
        !mesh.roofFacets.length ||
        !Number.isFinite(mesh.roofArea) ||
        mesh.roofArea <= 0 ||
        mesh.sections.some((s) =>
          Object.values(s.parts).some((a) =>
            a.some((n) => !Number.isFinite(n)),
          ),
        )
      )
        throw new Error("Invalid derived roof mesh.");
      const projected = mesh.roofFacets.reduce(
        (sum, f) => sum + polygonArea(f.polygon),
        0,
      );
      if (projected + 1 < p.exteriorArea)
        throw new Error(
          "Roof facets do not cover the complete building footprint.",
        );
      p.label = String.fromCharCode(65 + proposals.length);
      p.project.name = `${c.style} ${c.purpose}`;
      p.warnings = [...p.warnings, ...warnings, ...mesh.warnings];
      p.explanation.push(
        `${c.style}: dominant ${main.exterior.wallHeight / 1000} m hall with coordinated lower supporting roofs.`,
        `${placedWindows} validated windows; ${b.openings.length} exterior entrance; ${b.sections.reduce((n, s) => n + s.exterior.features.length, 0)} supported features.`,
        ...b.sections.map(
          (s) =>
            `${s.name}: ${s.exterior.roofStyle}, ridge ${s.exterior.ridgeAxis}, ${s.exterior.wallHeight / 1000} m eaves, ${s.exterior.roofPitch}°, ${s.exterior.covering}.`,
        ),
      );
      p.score =
        Math.round(
          (p.score + 10 + Math.min(placedWindows, 6) - warnings.length) * 100,
        ) / 100;
      proposals.push(p);
    } catch (e) {
      messages.push(
        `Candidate ${variant + 1} rejected by architectural validation: ${(e as Error).message}`,
      );
    }
  }
  if (!proposals.length)
    messages.push(
      "No complete architectural proposal passed validation. Try a simpler composition or another seed. The source project is unchanged.",
    );
  if (proposals.length > 0 && proposals.length < 3)
    messages.push(
      `Only ${proposals.length} complete proposals passed this bounded search.`,
    );
  return { ...result, proposals, messages, attempts, trials };
}
export function createArchitecturalProject(
  proposal: BuildingProposal,
  name: string,
): Project {
  const checked = validateProject(proposal.project);
  if (!name.trim() || name.trim().length > 100)
    throw new Error("Enter a project name of 1–100 characters.");
  if (
    checked.building.interior.partitions.length ||
    checked.building.interior.rooms.length ||
    checked.building.sections.some((s) => s.locked) ||
    !checked.building.openings.some((o) => o.type === "exterior-door")
  )
    throw new Error(
      "Generated architecture must be unlocked, without interiors, and have a real exterior entrance.",
    );
  buildExterior(checked.building);
  return validateProject(duplicateProject(checked, name.trim()));
}
