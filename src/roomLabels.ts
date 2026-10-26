import type { Region } from "./interior";
/** Rendering-only annotation rectangles assembled from actual clear-space cells. */
export function roomLabel(region: Region, name: string, scale: number) {
  const ys = [
    ...new Set(region.cells.flatMap((c) => [c.y, c.y + c.height])),
  ].sort((a, b) => a - b);
  const rectangles: { x: number; y: number; width: number; height: number }[] =
    [];
  for (let i = 0; i < ys.length - 1; i++) {
    const intervals = region.cells
      .filter((c) => c.y <= ys[i] && c.y + c.height >= ys[i + 1])
      .map((c) => [c.x, c.x + c.width])
      .sort((a, b) => a[0] - b[0]);
    const merged: number[][] = [];
    for (const p of intervals) {
      const last = merged[merged.length - 1];
      if (last && p[0] <= last[1]) last[1] = Math.max(last[1], p[1]);
      else merged.push([...p]);
    }
    for (const [lo, hi] of merged) {
      const previous = rectangles.find(
        (r) => r.x === lo && r.width === hi - lo && r.y + r.height === ys[i],
      );
      if (previous) previous.height += ys[i + 1] - ys[i];
      else
        rectangles.push({
          x: lo,
          y: ys[i],
          width: hi - lo,
          height: ys[i + 1] - ys[i],
        });
    }
  }
  const box = rectangles.reduce((a, b) =>
    a.width * a.height >= b.width * b.height ? a : b,
  );
  const maxLines = box.height * scale >= 48 ? 2 : 1,
    fontScale = Math.min(1, (box.height * scale) / (maxLines === 2 ? 48 : 34)),
    width = Math.max(1, box.width * 0.88),
    chars = Math.max(4, Math.floor((width * scale) / (6 * fontScale)));
  const words = name.trim().split(/\s+/),
    lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && (line + " " + word).length > chars) {
      lines.push(line);
      line = word;
    } else line = line ? line + " " + word : word;
  }
  if (line) lines.push(line);
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
    width,
    fontScale,
    lines:
      lines.length > maxLines
        ? maxLines === 1
          ? [name.slice(0, Math.max(chars - 1, 3)) + "…"]
          : [
              lines[0],
              lines
                .slice(1)
                .join(" ")
                .slice(0, Math.max(chars - 1, 3)) + "…",
            ]
        : lines,
  };
}
