import type { OpeningContext } from "./openings";
/** Bounded procedural carved meshes. Unit profiles cached on CPU; merged into section buffers. */
import type { Building, Section } from "./model";
import { resolveOrnament, type Ornament } from "./ornamentation";
import type { V3, Surface } from "./exteriorGeometry";
type Beam = (out: number[], a: V3, b: V3, size: number) => void;
type Mesh = { body: number[]; relief: number[] };
function reverseTail(a: number[], length: number) {
  for (let i = a.length - length; i < a.length; i += 9)
    for (let j = 0; j < 3; j++) {
      const t = a[i + 3 + j];
      a[i + 3 + j] = a[i + 6 + j];
      a[i + 6 + j] = t;
    }
}
const cache = new Map<string, Mesh>();
export const ornamentCacheSize = () => cache.size;
const tri = (out: number[], a: V3, b: V3, c: V3) =>
  out.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
function profile(
  out: number[],
  points: { x: number; z: number }[],
  thickness: number,
) {
  const area = points.reduce((n, p, i) => {
    const q = points[(i + 1) % points.length];
    return n + p.x * q.z - q.x * p.z;
  }, 0);
  const p = area > 0 ? points : [...points].reverse(),
    remaining = p.map((_, i) => i),
    faces: number[][] = [];
  const cross = (a: (typeof p)[0], b: (typeof p)[0], c: (typeof p)[0]) =>
    (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  for (
    let guard = 0;
    remaining.length > 2 && guard < p.length * p.length;
    guard++
  ) {
    let found = false;
    for (let k = 0; k < remaining.length; k++) {
      const i = remaining[(k + remaining.length - 1) % remaining.length],
        j = remaining[k],
        l = remaining[(k + 1) % remaining.length];
      if (cross(p[i], p[j], p[l]) <= 1e-8) continue;
      if (
        remaining.some(
          (t) =>
            t !== i &&
            t !== j &&
            t !== l &&
            cross(p[i], p[j], p[t]) >= -1e-8 &&
            cross(p[j], p[l], p[t]) >= -1e-8 &&
            cross(p[l], p[i], p[t]) >= -1e-8,
        )
      )
        continue;
      faces.push([i, j, l]);
      remaining.splice(k, 1);
      found = true;
      break;
    }
    if (!found) throw new Error("Invalid carved profile triangulation.");
  }
  if (remaining.length > 2) throw new Error("Carved profile did not close.");
  const v = (i: number, side: number) => ({
    x: p[i].x,
    y: (side * thickness) / 2,
    z: p[i].z,
  });
  for (const [i, j, k] of faces) {
    tri(out, v(k, 1), v(j, 1), v(i, 1));
    tri(out, v(i, -1), v(j, -1), v(k, -1));
  }
  for (let i = 0; i < p.length; i++) {
    const j = (i + 1) % p.length;
    tri(out, v(i, -1), v(i, 1), v(j, 1));
    tri(out, v(i, -1), v(j, 1), v(j, -1));
  }
}
function disc(
  out: number[],
  x: number,
  y: number,
  z: number,
  r: number,
  depth: number,
  n = 20,
) {
  const p = Array.from({ length: n }, (_, i) => ({
    x: x + Math.cos((i * 2 * Math.PI) / n) * r,
    z: z + Math.sin((i * 2 * Math.PI) / n) * r,
  }));
  const temp: number[] = [];
  profile(temp, p, depth);
  for (let i = 0; i < temp.length; i += 3)
    out.push(temp[i], temp[i + 1] + y, temp[i + 2]);
}
function mesh(
  type: Ornament["type"],
  variant: number,
  fantasy: boolean,
  beam: Beam,
): Mesh {
  const key = `${type}:${variant}:${fantasy}`;
  const old = cache.get(key);
  if (old) return old;
  const body: number[] = [],
    relief: number[] = [];
  if (type === "Dragon head") {
    // S-neck, brow, open jaw and curled snout form a genuinely extruded carved silhouette.
    const snout = variant === 1 ? 0 : variant === 2 ? 120 : -80;
    profile(
      body,
      [
        { x: -180, z: 100 },
        { x: 160, z: 100 },
        { x: 110, z: 310 },
        { x: 170, z: 520 },
        { x: 410, z: 730 },
        { x: 600, z: 810 },
        { x: 890, z: 710 },
        { x: 1210 + snout, z: 740 },
        { x: 1270 + snout, z: 850 },
        { x: 930, z: 875 },
        { x: 1040, z: 990 },
        { x: 1300 + snout, z: 980 },
        { x: 1360 + snout, z: 1100 },
        { x: 1260 + snout, z: 1240 },
        { x: 970, z: 1280 },
        { x: 790, z: 1420 },
        { x: 650, z: 1390 },
        { x: 590, z: 1210 },
        { x: 420, z: 1160 },
        { x: 270, z: 1000 },
        { x: 300, z: 850 },
        { x: 90, z: 720 },
        { x: -100, z: 570 },
        { x: -160, z: 350 },
      ],
      230,
    );
    // Backward horns and a raised crest remain connected to the skull/neck.
    profile(
      body,
      [
        { x: 650, z: 1320 },
        { x: 390, z: 1630 + (fantasy ? 150 : 0) },
        { x: 820, z: 1380 },
      ],
      150,
    );
    if (variant === 3 || fantasy)
      for (let i = 0; i < 3; i++)
        profile(
          body,
          [
            { x: 160 + i * 90, z: 780 + i * 115 },
            { x: -40 + i * 60, z: 1000 + i * 125 },
            { x: 240 + i * 90, z: 900 + i * 115 },
          ],
          125,
        );
    for (const side of [-1, 1]) {
      disc(relief, 835, side * 124, 1185, 42, 22, 12); // recessed-looking dark wood eye/brow boss
      beam(
        relief,
        { x: 740, y: side * 128, z: 1250 },
        { x: 970, y: side * 128, z: 1240 },
        36,
      );
      const path = [
        [-70, 220],
        [0, 420],
        [120, 600],
        [330, 770],
        [430, 930],
        [420, 1060],
        [610, 1160],
      ];
      for (let i = 0; i < path.length - 1; i++)
        beam(
          relief,
          { x: path[i][0], y: side * 128, z: path[i][1] },
          { x: path[i + 1][0], y: side * 128, z: path[i + 1][1] },
          32,
        );
      for (let i = 0; i < 3; i++)
        profile(
          relief,
          [
            { x: 980 + i * 75, z: 970 },
            { x: 1000 + i * 75, z: 905 },
            { x: 1025 + i * 75, z: 970 },
          ],
          200,
        );
    }
  } else if (type === "Gable finial") {
    profile(
      body,
      [
        { x: -90, z: 70 },
        { x: 110, z: 70 },
        { x: 160, z: 310 },
        { x: 60, z: 490 },
        { x: 170, z: 650 },
        { x: 0, z: 950 },
        { x: -150, z: 670 },
        { x: -50, z: 500 },
        { x: -150, z: 300 },
      ],
      150,
    );
    if (variant > 1)
      for (const sign of [-1, 1])
        profile(
          body,
          [
            { x: sign * 40, z: 460 },
            { x: sign * 300, z: 650 },
            { x: sign * 180, z: 850 },
            { x: sign * 120, z: 610 },
          ],
          90,
        );
    if (variant === 3)
      profile(
        body,
        [
          { x: 0, z: 850 },
          { x: 160, z: 1020 },
          { x: 0, z: 1150 },
          { x: -160, z: 1020 },
        ],
        100,
      );
    for (let z = 200; z < 700; z += 150)
      beam(relief, { x: -65, y: 83, z }, { x: 65, y: 83, z: z + 100 }, 28);
  } else if (type === "Shield") {
    beam(body, { x: 0, y: 0, z: 450 }, { x: 0, y: 65, z: 450 }, 150);
    disc(body, 0, 65, 450, 430, 75, 24);
    disc(relief, 0, 120, 450, 120, 110, 16);
    for (let i = 0; i < 10 + variant * 2; i++) {
      const a = (i * 2 * Math.PI) / (10 + variant * 2);
      disc(relief, Math.cos(a) * 370, 110, 450 + Math.sin(a) * 370, 22, 30, 8);
    }
    for (const x of [-250, -120, 120, 250])
      beam(
        relief,
        { x, y: 108, z: 450 - Math.sqrt(400 * 400 - x * x) },
        { x, y: 108, z: 450 + Math.sqrt(400 * 400 - x * x) },
        16,
      );
    if (variant > 1)
      for (const sign of [-1, 1])
        beam(
          relief,
          { x: -250, y: 114, z: 450 - sign * 250 },
          { x: 250, y: 114, z: 450 + sign * 250 },
          35,
        );
  } else if (type === "Knotwork panel" || type === "Gable panel") {
    if (type === "Knotwork panel")
      profile(
        body,
        [
          { x: -450, z: 0 },
          { x: 450, z: 0 },
          { x: 450, z: 900 },
          { x: -450, z: 900 },
        ],
        110,
      );
    else
      profile(
        body,
        [
          { x: -450, z: 0 },
          { x: 450, z: 0 },
          { x: 0, z: 850 },
        ],
        110,
      );
    const loops = variant === 3 ? 3 : 2;
    for (let k = 0; k < loops; k++)
      for (let i = 0; i < 32; i++) {
        const point = (j: number) => {
          const t = (j / 32) * 2 * Math.PI;
          return {
            x: Math.sin(t) * 220 + (k - (loops - 1) / 2) * 140,
            z:
              450 +
              (variant === 1
                ? Math.cos(t + k * 0.5)
                : Math.sin(t * 2 + k * Math.PI)) *
                240,
            y: 45 + Math.cos(t * 2 + k * Math.PI) * 12 + k * 5,
          };
        };
        beam(relief, point(i), point(i + 1), 30);
      }
  } else if (type === "Carved post") {
    beam(body, { x: 0, y: 85, z: 0 }, { x: 0, y: 85, z: 3000 }, 170);
    for (
      let z = 90;
      z < 2900;
      z += variant === 1 ? 450 : variant === 2 ? 600 : 320
    ) {
      beam(body, { x: 0, y: 85, z }, { x: 0, y: 85, z: z + 60 }, 220);
    }
    for (let i = 0; i < 48; i++) {
      const point = (j: number) => ({
        x: Math.sin((j * Math.PI) / 8) * 60,
        y: 185,
        z: 100 + (j / 48) * 2800,
      });
      beam(relief, point(i), point(i + 1), 24);
    }
    if (variant > 1)
      for (let z = 200; z < 2700; z += 350)
        for (const sign of [-1, 1])
          beam(
            relief,
            { x: sign * 65, y: 185, z },
            { x: -sign * 65, y: 185, z: z + 170 },
            25,
          );
  } else if (type === "Beam ends") {
    beam(body, { x: 0, y: 0, z: 450 }, { x: 0, y: 400, z: 450 }, 220);
    disc(relief, 0, 520, 450, 80, 40, 16);
    if (variant > 1)
      for (const sign of [-1, 1])
        beam(
          relief,
          { x: -60, y: 515, z: 450 - sign * 60 },
          { x: 60, y: 515, z: 450 + sign * 60 },
          20,
        );
    if (variant === 3)
      for (const x of [-180, 180])
        beam(body, { x, y: 0, z: 450 }, { x, y: 300, z: 450 }, 140);
  } else if (type === "Carved brace") {
    beam(body, { x: -380, y: 80, z: 80 }, { x: 380, y: 80, z: 820 }, 160);
    if (variant === 3)
      beam(body, { x: -380, y: 80, z: 820 }, { x: 380, y: 80, z: 80 }, 120);
    if (variant === 2) disc(relief, 0, 170, 450, 100, 45, 12);
    for (let i = 0; i < 8; i++)
      beam(
        relief,
        { x: -320 + i * 90, y: 168, z: 120 + i * 85 },
        { x: -270 + i * 90, y: 168, z: 120 + i * 85 },
        32,
      );
  }
  const result = { body, relief };
  if (cache.size >= 64) cache.delete(cache.keys().next().value!);
  cache.set(key, result);
  return result;
}
const finishPart = (o: Ornament): Surface =>
  o.finish === "Dark wood"
    ? "ornamentDark"
    : o.finish === "Ochre"
      ? "ornamentOchre"
      : o.finish === "Weathered wood"
        ? "ornamentPale"
        : "ornamentWood";
export function appendOrnaments(
  b: Building,
  s: Section,
  parts: Record<Surface, number[]>,
  roofAt: (p: { x: number; y: number }) => number,
  beam: Beam,
  opening?: OpeningContext,
) {
  const setting = s.exterior.ornamentation;
  if (setting.level === "None") return;
  for (const o of setting.items) {
    const frame = resolveOrnament(b, s, o, roofAt, opening),
      out = parts[finishPart(o)],
      fine = s.exterior.detailLevel === "Low" ? [] : parts.detail,
      fantasy = setting.level === "Fantasy";
    const point = (x: number, y: number, z: number) => ({
      x: frame.origin.x + frame.u.x * x + frame.v.x * y,
      y: frame.origin.y + frame.u.y * x + frame.v.y * y,
      z: frame.origin.z + z,
    });
    const line = (
      a: [number, number, number],
      z: [number, number, number],
      size: number,
      target = out,
    ) => beam(target, point(...a), point(...z), size);
    if (o.type === "Bargeboard") {
      const half = frame.width / 2;
      for (const sign of [-1, 1]) {
        line(
          [70, 0, -210],
          [70, sign * half, -210 - frame.slope * half],
          140 * frame.size,
        );
        if (fantasy || o.variant > 1)
          line(
            [170, 0, -250],
            [170, sign * half, -250 - frame.slope * half],
            80 * frame.size,
          );
        if (o.variant === 3)
          line(
            [240, 0, -290],
            [240, sign * half, -290 - frame.slope * half],
            80 * frame.size,
          );
        for (let i = 1; i < 9; i++) {
          const y = (sign * half * i) / 9;
          line(
            [150, y, -200 - frame.slope * Math.abs(y)],
            [150, y + sign * 80, -230 - frame.slope * Math.abs(y)],
            35,
            fine,
          );
        }
      }
      continue;
    }
    if (o.type === "Ridge trim") {
      const length = Math.min(3000 * frame.size, frame.span * 0.3);
      line([0, 0, 90], [-length, 0, 90], 150 * frame.size);
      const count = 6 + o.variant * 2;
      for (let i = 0; i < count; i++)
        line(
          [(-length * i) / count, 0, 130],
          [(-length * (i + 0.5)) / count, 0, 220],
          55 * frame.size,
          fine,
        );
      continue;
    }
    if (o.type === "Entrance pillars") {
      const spread = (frame.width - 240 * frame.size) / 2;
      for (const sign of [-1, 1]) {
        line(
          [sign * spread, 80, 0],
          [sign * spread, 80, 2100],
          180 * frame.size,
        );
        for (let i = 0; i < 12 + o.variant * 2; i++)
          line(
            [sign * spread - 50, 180, 100 + i * 120],
            [sign * spread + 50, 180, 160 + i * 120],
            30,
            fine,
          );
      }
      line([-spread, 80, 2150], [spread, 80, 2150], 210 * frame.size);
      if (fantasy || o.variant === 3)
        line(
          [-spread - 100, 80, 2300],
          [spread + 100, 80, 2300],
          100 * frame.size,
        );
      if (o.variant > 1)
        for (const sign of [-1, 1])
          line(
            [sign * spread, 80, 1800],
            [sign * (spread - 250), 80, 2150],
            100 * frame.size,
          );
      continue;
    }
    const unit = mesh(o.type, o.variant, fantasy, beam);
    let sx = frame.size,
      sy = frame.size,
      sz = frame.size,
      baseZ = 0,
      baseY = 0;
    if (o.anchor.kind === "roof") {
      if (o.type === "Gable panel") {
        const h = Math.min(
            1400 * frame.size,
            (frame.origin.z - frame.height) * 0.7,
          ),
          w = Math.min(1200 * frame.size, h / Math.max(frame.slope, 0.1));
        // Unit panel local X becomes facade tangent, unit Y becomes outward normal.
        sx = w / 900;
        sz = h / 850;
        baseZ = -h - 260;
        sy = 1;
        baseY = 30;
        for (const [array, target] of [
          [unit.body, out],
          [unit.relief, fine],
        ] as const)
          for (let i = 0; i < array.length; i += 3) {
            const p = point(
              baseY + array[i + 1],
              array[i] * sx,
              baseZ + array[i + 2] * sz,
            );
            target.push(p.x, p.y, p.z);
          }
        for (const [array, target] of [
          [unit.body, out],
          [unit.relief, fine],
        ] as const)
          reverseTail(target, array.length);
        continue;
      }
      line(
        [-450 * frame.size, 0, 50],
        [80 * frame.size, 0, 50],
        160 * frame.size,
      );
      baseZ = 0;
    } else if (o.type === "Carved post") {
      sz = frame.height / 3000;
    }
    for (const [array, target] of [
      [unit.body, out],
      [unit.relief, fine],
    ] as const)
      for (let i = 0; i < array.length; i += 3) {
        const p = point(
          array[i] * sx * (o.mirror ? -1 : 1),
          baseY + array[i + 1] * sy,
          baseZ + array[i + 2] * sz,
        );
        target.push(p.x, p.y, p.z);
      }
    // A reflection changes handedness: restore consistent face winding.
    if (frame.u.x * frame.v.y - frame.u.y * frame.v.x < 0 !== o.mirror)
      for (const [array, target] of [
        [unit.body, out],
        [unit.relief, fine],
      ] as const) {
        const start = target.length - array.length;
        for (let i = start; i < target.length; i += 9)
          for (let j = 0; j < 3; j++) {
            const t = target[i + 3 + j];
            target[i + 3 + j] = target[i + 6 + j];
            target[i + 6 + j] = t;
          }
      }
  }
}
