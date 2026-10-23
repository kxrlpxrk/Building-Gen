import type { Architecture, Section } from "./model";
export const ROOF_STYLES = ["Gable", "Hip", "Shed"] as const;
export type ExteriorSettings = {
  wallHeight: number;
  roofPitch: number;
  roofStyle: (typeof ROOF_STYLES)[number];
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
export function readExterior(value: unknown): ExteriorSettings {
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
  return {
    wallHeight: v.wallHeight,
    roofPitch: v.roofPitch,
    roofStyle: v.roofStyle,
    overhang: v.overhang,
    material: v.material,
  };
}
