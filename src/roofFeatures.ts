/** Roof-only additions supported by the existing footprint walls. No floor-plan edits. */
import type { Building, Section } from "./model";
import type { RoofFeature } from "./exteriorSettings";
import { ridgeAlongX } from "./exteriorSettings";
import { rotate, type Point } from "./geometry";
import { canonicalVertices, combinedGeometry } from "./assembly";
import { roofPlanes } from "./roofFields";
import {
  rectangleRoof,
  profileBreaks,
  fieldHeight,
  onRing,
} from "./roofSurface";
export function defaultRoofFeature(
  s: Section,
  id: string = crypto.randomUUID(),
): RoofFeature {
  const x = ridgeAlongX(s),
    span = x ? s.length : s.width,
    cross = x ? s.width : s.length;
  return {
    id,
    ridgeAxis: x ? "Y" : "X",
    side: "Both",
    offset: Math.round(span / 2),
    width: Math.min(span - 2000, Math.round(cross)),
    depth: cross,
    pitch: s.exterior.roofPitch,
    relativeHeight: 0,
  };
}
export function crossRoofFields(
  s: Section,
  b: Building,
  pad = s.exterior.overhang,
) {
  const angle = s.orientation - b.frame.axis,
    origin = {
      x: s.position.x - b.frame.origin.x,
      y: s.position.y - b.frame.origin.y,
    };
  // Canonical frames permit quarter turns only. Use exact basis components so
  // trig roundoff cannot introduce microscopic compression cells at 90° joins.
  const basis = (p: Point) => {
    const q = rotate(p, angle);
    return { x: Math.round(q.x), y: Math.round(q.y) };
  };
  const ux = basis({ x: 1, y: 0 }),
    uy = basis({ x: 0, y: 1 });
  const toWorld = (p: Point) => ({
    x: p.x * ux.x + p.y * uy.x + origin.x,
    y: p.x * ux.y + p.y * uy.y + origin.y,
  });
  return s.exterior.roofFeatures.map((r) => {
    const alongY = r.ridgeAxis === "Y",
      span = alongY ? s.width : s.length;
    const start = r.side === "Positive" ? span - r.depth : 0,
      end = r.side === "Negative" ? r.depth : span;
    const domain = (
      alongY
        ? rectangleRoof(
            -pad,
            start === 0 ? -pad : start,
            s.length + 2 * pad,
            end - start + (start === 0 ? pad : 0) + (end === span ? pad : 0),
          )
        : rectangleRoof(
            start === 0 ? -pad : start,
            -pad,
            end - start + (start === 0 ? pad : 0) + (end === span ? pad : 0),
            s.width + 2 * pad,
          )
    ).map(toWorld);
    const slope = Math.tan((r.pitch * Math.PI) / 180),
      u = alongY ? ux : uy,
      base = s.exterior.wallHeight + r.relativeHeight;
    const planes = [1, -1].map((sign) => ({
      a: u.x * slope * sign,
      b: u.y * slope * sign,
      c:
        base +
        (slope * r.width) / 2 -
        sign * slope * (r.offset + u.x * origin.x + u.y * origin.y),
    }));
    return { feature: r, planes, domain, toWorld, start, end, span };
  });
}
export function validateRoofFeatures(b: Building) {
  if (b.sections.reduce((n, s) => n + s.exterior.roofFeatures.length, 0) > 8)
    throw new Error("Building roof architecture limit: eight features.");
  if (!b.sections.some((s) => s.exterior.roofFeatures.length)) return;
  const outer = combinedGeometry(b).vertices;
  for (const s of b.sections) {
    if (!s.exterior.roofFeatures.length) continue;
    if (s.kind !== "rectangle" || s.exterior.roofStyle !== "Gable")
      throw new Error(
        "Cross-gables currently require a rectangular Gable host.",
      );
    const native = roofPlanes(s, b),
      ring = canonicalVertices(s, b);
    for (const field of crossRoofFields(s, b, 0)) {
      const r = field.feature,
        alongY = r.ridgeAxis === "Y",
        transverse = alongY ? s.length : s.width;
      if ((r.ridgeAxis === "X") === ridgeAlongX(s))
        throw new Error(
          "The secondary ridge must cross the host ridge. Change the host direction first or remove its roof features.",
        );
      if (
        r.width < 1800 ||
        r.width > 16000 ||
        r.offset - r.width / 2 < 500 ||
        r.offset + r.width / 2 > transverse - 500 ||
        r.depth < 1000 ||
        r.depth > field.span ||
        r.relativeHeight < -1000 ||
        r.relativeHeight > 1000
      )
        throw new Error(
          "Cross-gable needs width 1.8–16 m, 0.5 m end margins, depth 1 m to host span, and relative eaves −1 to +1 m.",
        );
      if (
        r.relativeHeight +
          (Math.tan((r.pitch * Math.PI) / 180) * r.width) / 2 <=
        120
      )
        throw new Error(
          "Secondary gable is buried below the host roof skin. Increase width, pitch or relative height.",
        );
      // Every end reaching a facade must sit on an EXPOSED supported wall, never
      // on an open-plan section join. The raised gable uses that actual wall.
      for (const end of [field.start, field.end]) {
        const isFacade = end === 0 || end === field.span;
        const a = field.toWorld(
            alongY
              ? { x: r.offset - r.width / 2, y: end }
              : { x: end, y: r.offset - r.width / 2 },
          ),
          z = field.toWorld(
            alongY
              ? { x: r.offset + r.width / 2, y: end }
              : { x: end, y: r.offset + r.width / 2 },
          );
        if (isFacade) {
          if (
            !outer.some(
              (p, i) =>
                onRing([p, outer[(i + 1) % outer.length]], a) &&
                onRing([p, outer[(i + 1) % outer.length]], z),
            )
          )
            throw new Error(
              "Cross-gable end requires a fully exposed host wall; section joins cannot support roof-only gables.",
            );
        } else {
          for (const t of profileBreaks(a, z, [native, field.planes])) {
            const p = { x: a.x + (z.x - a.x) * t, y: a.y + (z.y - a.y) * t };
            if (fieldHeight(field.planes, p) > fieldHeight(native, p) - 120)
              throw new Error(
                "Secondary roof depth is too short to bury its end below the host roof. Increase depth, lower relative height or reduce pitch/width.",
              );
          }
        }
      }
      // Do not let an offset cross roof escape through the host's original ends.
      const edges = alongY
        ? [
            [ring[0], ring[3]],
            [ring[1], ring[2]],
          ]
        : [
            [ring[0], ring[1]],
            [ring[2], ring[3]],
          ];
      for (const [a, z] of edges)
        for (const t of profileBreaks(a, z, [native, field.planes])) {
          const p = { x: a.x + (z.x - a.x) * t, y: a.y + (z.y - a.y) * t };
          if (fieldHeight(field.planes, p) > fieldHeight(native, p) + 0.001)
            throw new Error(
              "Offset/height would raise an unsupported host end. Narrow or recenter the cross-gable.",
            );
        }
    }
    const rr = s.exterior.roofFeatures;
    if (
      rr.length > 1 &&
      Math.abs(rr[0].offset - rr[1].offset) <
        (rr[0].width + rr[1].width) / 2 + 400
    )
      throw new Error("Separate cross-gable bays by at least 0.4 m.");
  }
}
