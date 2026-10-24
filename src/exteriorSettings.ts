import type { Architecture, Section } from "./model";
export const ROOF_STYLES = ["Gable", "Hip", "Shed"] as const;
export const STYLE_PRESETS = [
  "Rustic Norse",
  "Norse Chieftain's Hall",
  "Medieval Timber Cottage",
  "Medieval Manor",
  "Mixed Architectural Fantasy",
] as const;
export const COVERINGS = ["Wood shingles", "Slate", "Clay tiles"] as const;
export const WINDOW_STYLES = [
  "Timber shuttered",
  "Medieval glazed",
  "Narrow slit",
] as const;
export type ExteriorWindow = {
  id: string;
  edge: number;
  offset: number;
  width: number;
  height: number;
  sill: number;
  style: (typeof WINDOW_STYLES)[number];
  shutters: boolean;
  glazing: boolean;
};
export type ExteriorFeature = {
  id: string;
  kind: "Chimney" | "Gable ornament" | "Entrance canopy";
  x: number;
  y: number;
  height: number;
  doorId: string | null;
  finish: "Stone" | "Brick";
};
export type RoofFeature = {
  id: string;
  ridgeAxis: "X" | "Y";
  side: "Negative" | "Positive" | "Both";
  offset: number;
  width: number;
  depth: number;
  pitch: number;
  relativeHeight: number;
};
export type ExteriorSettings = {
  stylePreset: (typeof STYLE_PRESETS)[number];
  detailLevel: "Low" | "Standard" | "High";
  covering: (typeof COVERINGS)[number];
  roofFeatures: RoofFeature[];
  windows: ExteriorWindow[];
  features: ExteriorFeature[];
  wallHeight: number;
  roofPitch: number;
  roofStyle: (typeof ROOF_STYLES)[number];
  ridgeAxis: "Auto" | "X" | "Y";
  shedHighEdge: "Auto" | "+X" | "-X" | "+Y" | "-Y";
  overhang: number;
  material: Architecture;
};
export function exteriorDefaults(
  material: Architecture,
  type: Section["type"] = "Custom",
  main = true,
): ExteriorSettings {
  return {
    material,
    ridgeAxis: "Auto",
    shedHighEdge: "Auto",
    stylePreset: defaultStyle(material),
    detailLevel: "Standard",
    covering: material === "Medieval" ? "Slate" : "Wood shingles",
    roofFeatures: [],
    windows: [],
    features: [],
    wallHeight:
      type === "Tower Footprint"
        ? 6500
        : !main && type === "Porch"
          ? 2400
          : !main && type === "Storage"
            ? 2800
            : !main
              ? 3100
              : material === "Norse"
                ? 3800
                : 3600,
    roofPitch: material === "Norse" ? 42 : material === "Medieval" ? 38 : 40,
    roofStyle: !main && type === "Porch" ? "Shed" : "Gable",
    overhang: material === "Norse" ? 450 : 350,
  };
}
export const defaultStyle = (
  material: Architecture,
): ExteriorSettings["stylePreset"] =>
  material === "Norse"
    ? "Rustic Norse"
    : material === "Medieval"
      ? "Medieval Timber Cottage"
      : "Mixed Architectural Fantasy";
export const styleMaterial = (
  style: ExteriorSettings["stylePreset"],
): Architecture =>
  style.startsWith("Norse") || style === "Rustic Norse"
    ? "Norse"
    : style.startsWith("Medieval")
      ? "Medieval"
      : "Mixed";
export function readExterior(
  value: unknown,
  legacy = false,
  legacyDirection = false,
  legacyRoofFeatures = false,
): ExteriorSettings {
  const v = value as ExteriorSettings;
  if (
    !v ||
    typeof v !== "object" ||
    !Number.isSafeInteger(v.wallHeight) ||
    v.wallHeight < 2400 ||
    v.wallHeight > 12000 ||
    !Number.isFinite(v.roofPitch) ||
    v.roofPitch < 10 ||
    v.roofPitch > 65 ||
    Math.abs(v.roofPitch * 10 - Math.round(v.roofPitch * 10)) > 1e-7 ||
    !ROOF_STYLES.includes(v.roofStyle) ||
    !Number.isSafeInteger(v.overhang) ||
    v.overhang < 0 ||
    v.overhang > 1000 ||
    !["Norse", "Medieval", "Mixed"].includes(v.material)
  )
    throw new Error(
      "Invalid exterior settings: eaves 2.4–12 m, pitch 10–65° (0.1° precision), overhang 0–1 m and a supported roof/material preset are required.",
    );
  if (legacy && ((v.windows?.length ?? 0) > 0 || (v.features?.length ?? 0) > 0))
    throw new Error(
      "Exterior windows/features require schemaVersion 7; this legacy record was not reset.",
    );
  const direction =
    legacy || legacyDirection ? { ridgeAxis: "Auto", shedHighEdge: "Auto" } : v;
  if (
    !["Auto", "X", "Y"].includes(direction.ridgeAxis) ||
    !["Auto", "+X", "-X", "+Y", "-Y"].includes(direction.shedHighEdge)
  )
    throw new Error(
      "Invalid roof direction. Choose a local ridge axis or shed high edge.",
    );
  const detail = legacy
    ? {
        stylePreset: defaultStyle(v.material),
        detailLevel: "Standard",
        covering: v.material === "Medieval" ? "Slate" : "Wood shingles",
        windows: [],
        features: [],
      }
    : v;
  if (
    !STYLE_PRESETS.includes(
      detail.stylePreset as ExteriorSettings["stylePreset"],
    ) ||
    !["Low", "Standard", "High"].includes(detail.detailLevel) ||
    !COVERINGS.includes(detail.covering as ExteriorSettings["covering"]) ||
    !Array.isArray(detail.windows) ||
    detail.windows.length > 32 ||
    !Array.isArray(detail.features) ||
    detail.features.length > 8
  )
    throw new Error(
      "Invalid architectural style, detail level, covering or exterior feature collection.",
    );
  const id = (s: unknown) =>
    typeof s === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(s);
  const integer = (n: unknown) => Number.isSafeInteger(n);
  if (
    legacyRoofFeatures &&
    v.roofFeatures !== undefined &&
    (!Array.isArray(v.roofFeatures) || v.roofFeatures.length)
  )
    throw new Error(
      "Roof architecture requires schemaVersion 9; legacy data was not reset.",
    );
  const roofFeatures = legacyRoofFeatures ? [] : v.roofFeatures;
  if (!Array.isArray(roofFeatures) || roofFeatures.length > 2)
    throw new Error("A section supports at most two roof features.");
  const roofs = roofFeatures.map((r: RoofFeature) => {
    if (
      !r ||
      !id(r.id) ||
      !["X", "Y"].includes(r.ridgeAxis) ||
      !["Negative", "Positive", "Both"].includes(r.side) ||
      ![r.offset, r.width, r.depth, r.relativeHeight].every(integer) ||
      !Number.isFinite(r.pitch) ||
      r.pitch < 20 ||
      r.pitch > 60 ||
      Math.abs(r.pitch * 10 - Math.round(r.pitch * 10)) > 1e-6
    )
      throw new Error(
        "Invalid cross-gable parameters: use integer millimetres and pitch 20–60° (0.1°).",
      );
    return {
      id: r.id,
      ridgeAxis: r.ridgeAxis,
      side: r.side,
      offset: r.offset,
      width: r.width,
      depth: r.depth,
      pitch: r.pitch,
      relativeHeight: r.relativeHeight,
    };
  });
  const windows = detail.windows.map((w: ExteriorWindow) => {
    if (
      !w ||
      !id(w.id) ||
      !integer(w.edge) ||
      w.edge < 0 ||
      !integer(w.offset) ||
      !integer(w.width) ||
      !integer(w.height) ||
      !integer(w.sill) ||
      !WINDOW_STYLES.includes(w.style) ||
      typeof w.shutters !== "boolean" ||
      typeof w.glazing !== "boolean"
    )
      throw new Error("Invalid exterior window record.");
    return {
      id: w.id,
      edge: w.edge,
      offset: w.offset,
      width: w.width,
      height: w.height,
      sill: w.sill,
      style: w.style,
      shutters: w.shutters,
      glazing: w.glazing,
    };
  });
  const features = detail.features.map((f: ExteriorFeature) => {
    if (
      !f ||
      !id(f.id) ||
      !["Chimney", "Gable ornament", "Entrance canopy"].includes(f.kind) ||
      !integer(f.x) ||
      !integer(f.y) ||
      !integer(f.height) ||
      !(f.doorId === null || id(f.doorId)) ||
      !["Stone", "Brick"].includes(f.finish)
    )
      throw new Error("Invalid architectural feature record.");
    return {
      id: f.id,
      kind: f.kind,
      x: f.x,
      y: f.y,
      height: f.height,
      doorId: f.doorId,
      finish: f.finish,
    };
  });
  return {
    ridgeAxis: direction.ridgeAxis as ExteriorSettings["ridgeAxis"],
    shedHighEdge: direction.shedHighEdge as ExteriorSettings["shedHighEdge"],
    stylePreset: detail.stylePreset as ExteriorSettings["stylePreset"],
    detailLevel: detail.detailLevel as ExteriorSettings["detailLevel"],
    covering: detail.covering as ExteriorSettings["covering"],
    roofFeatures: roofs,
    windows,
    features,
    wallHeight: v.wallHeight,
    roofPitch: v.roofPitch,
    roofStyle: v.roofStyle,
    overhang: v.overhang,
    material: v.material,
  };
}

export const ridgeAlongX = (s: Section) =>
  s.exterior.ridgeAxis === "X" ||
  (s.exterior.ridgeAxis === "Auto" && s.length >= s.width);

/** Derived hip end pitch is shared by the mesh and conservative feature clearance checks. */
export function hipEndSlopeRatio(s: Section) {
  if (s.exterior.roofStyle !== "Hip" || s.exterior.ridgeAxis === "Auto")
    return 1;
  const span = ridgeAlongX(s) ? s.length : s.width,
    cross = ridgeAlongX(s) ? s.width : s.length;
  return cross / 2 / Math.min(cross / 2, span * 0.4);
}
export const maximumRoofSlope = (s: Section) =>
  Math.tan((s.exterior.roofPitch * Math.PI) / 180) * hipEndSlopeRatio(s);
