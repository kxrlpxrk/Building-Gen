import { resolveOrnament, isRoofOrnament } from "./ornamentation";
import { installOrnamentGestures } from "./exteriorOrnamentGestures";
import { ornamentTriangles, ornamentPickParts } from "./ornamentPickGeometry";
import {
  ornamentPlacementContext,
  type OrnamentPlacement,
  type OrnamentSession,
  type OrnamentHit,
  type OrnamentAnchor,
} from "./ornamentPlacement";
import { crossRoofFields } from "./roofFeatures";
import { fieldHeight, onRing } from "./roofSurface";
import { containsPoint } from "./interior";
import { installWindowGestures } from "./exteriorWindowGestures";
import type {
  WindowPlacement,
  WindowSession,
  WallHit,
} from "./windowPlacement";
import { openingContext } from "./assembly";
import { openingGeometry } from "./openings";
import { windowOpening } from "./exteriorValidation";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { ExteriorSettings } from "./exteriorSettings";
import type { Building } from "./model";
import type { ExteriorModel, Surface } from "./exteriorGeometry";
/** Isolated engine conversion: model XY horizontal / Z up (mm) → Three XZ / Y up (m). */
export const enginePoint = (x: number, y: number, z: number) =>
  new THREE.Vector3(x / 1000, z / 1000, -y / 1000);
const palettes = {
  "Rustic Norse": {
    roofDetail: "#38332a",
    wall: "#79563a",
    roof: "#302d29",
    stone: "#77766b",
    timber: "#38291e",
    door: "#60432e",
    detail: "#60422c",
    glass: "#607b78",
    brick: "#895843",
  },
  "Norse Chieftain's Hall": {
    roofDetail: "#302c23",
    wall: "#573e2b",
    roof: "#252923",
    stone: "#68675c",
    timber: "#2c231b",
    door: "#705438",
    detail: "#987044",
    glass: "#536a65",
    brick: "#79513f",
  },
  "Medieval Timber Cottage": {
    roofDetail: "#564438",
    wall: "#ded2ad",
    roof: "#4d5353",
    stone: "#858071",
    timber: "#493528",
    door: "#705039",
    detail: "#76523a",
    glass: "#72918b",
    brick: "#985e48",
  },
  "Medieval Manor": {
    roofDetail: "#343d3f",
    wall: "#e3d9bf",
    roof: "#424d50",
    stone: "#918d7e",
    timber: "#312a24",
    door: "#584330",
    detail: "#574333",
    glass: "#6b8886",
    brick: "#905b48",
  },
  "Mixed Architectural Fantasy": {
    roofDetail: "#3c3026",
    wall: "#bca780",
    roof: "#4c3c30",
    stone: "#7e7b70",
    timber: "#453225",
    door: "#624832",
    detail: "#785d3e",
    glass: "#647d75",
    brick: "#875842",
  },
};
export function createExteriorScene(
  host: HTMLDivElement,
  onPick: (id: string) => void,
  onFailure: (text: string) => void,
  onWindow: (sectionId: string, id: string) => void,
  windowPlacement: () => WindowPlacement,
  snapStep: () => number | null,
  onRoof: (sectionId: string, id: string) => void = () => {},
  ornamentPlacement: (() => OrnamentPlacement) | null = null,
  onOrnament: (sectionId: string, id: string) => void = () => {},
) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor("#e5e7df");
  const canvas = renderer.domElement;
  canvas.setAttribute("aria-label", "Interactive architectural 3D building");
  canvas.style.touchAction = "none";
  host.append(canvas);
  const scene = new THREE.Scene(),
    root = new THREE.Group();
  scene.add(root);
  scene.add(new THREE.HemisphereLight("#f4f0de", "#838d7d", 2.4));
  const sun = new THREE.DirectionalLight("#fff5da", 3.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.025;
  scene.add(sun, sun.target);
  const groundMaterial = new THREE.MeshStandardMaterial({
      color: "#b9bda8",
      roughness: 1,
    }),
    ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const perspective = new THREE.PerspectiveCamera(42, 1, 0.1, 2000),
    orthographic = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 2000);
  let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = perspective,
    extent = 20,
    selected = "",
    helper: THREE.BoxHelper | null = null,
    visible = true,
    disposed = false,
    lost = false,
    frame = 0,
    rebuilds = 0;
  let activeBuilding: Building | null = null;
  let wallContext: ReturnType<typeof openingContext> | null = null;
  let previewGroup: THREE.Group | null = null;
  let selectedWindow = "",
    selectedOrnament = "";
  let ornamentHelper: THREE.Box3Helper | null = null;
  let ornamentContext: ReturnType<typeof ornamentPlacementContext> | null =
    null;
  const ornamentPicks: { anchor: OrnamentAnchor; mesh: THREE.Mesh }[] = [];
  const pickMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  let windowHelper: THREE.Box3Helper | null = null;
  let initialized = false;
  let previousCenter: THREE.Vector3 | null = null;
  const controls = new OrbitControls<
    THREE.PerspectiveCamera | THREE.OrthographicCamera
  >(camera, canvas);
  controls.enableDamping = false;
  controls.listenToKeyEvents(host);
  controls.maxPolarAngle = Math.PI / 2 - 0.025;
  controls.minDistance = 1;
  controls.maxDistance = 2500;
  controls.target.set(6, 2, -4);
  const groups = new Map<string, { key: string; group: THREE.Group }>(),
    materials = new Map<string, THREE.MeshStandardMaterial>(),
    textures: THREE.Texture[] = [];
  function texture(
    style: keyof typeof palettes,
    kind: Surface,
    covering: ExteriorSettings["covering"],
  ) {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const ctx = c.getContext("2d")!;
    const ornamentColours: Record<string, string> = {
      ornamentWood: "#755035",
      ornamentDark: "#362a23",
      ornamentOchre: "#94633c",
      ornamentPale: "#ab9270",
    };
    const palette = palettes[style] as Record<string, string>;
    ctx.fillStyle =
      ornamentColours[kind] ??
      (kind === "roof"
        ? covering === "Clay tiles"
          ? "#795441"
          : covering === "Slate"
            ? "#454e50"
            : palette[kind]
        : palette[kind]);
    ctx.fillRect(0, 0, 128, 128);
    let seed = 17;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    if (kind === "roof")
      for (let y = 0; y < 128; y += 16) {
        ctx.fillStyle = "rgba(0,0,0,.26)";
        ctx.fillRect(0, y, 128, 2);
        for (let x = y % 32 ? -8 : 0; x < 128; x += 24) {
          ctx.fillStyle = `rgba(220,205,175,${rand() * 0.12})`;
          ctx.fillRect(x + 2, y + 3, 21, 12);
          ctx.fillStyle = "rgba(0,0,0,.25)";
          ctx.fillRect(x, y, 1, 16);
        }
      }
    else if (
      kind === "wall" &&
      (style === "Rustic Norse" || style === "Norse Chieftain's Hall")
    )
      for (let y = 0; y < 128; y += 16) {
        ctx.fillStyle = "rgba(0,0,0,.24)";
        if (style === "Rustic Norse") ctx.fillRect(0, y, 128, 2);
        else ctx.fillRect(y, 0, 2, 128);
        ctx.fillStyle = "rgba(220,190,130,.1)";
        if (style === "Rustic Norse") ctx.fillRect(0, y + 3, 128, 1);
        else ctx.fillRect(y + 3, 0, 1, 128);
      }
    else if (kind === "stone" || kind === "brick")
      for (let y = 0; y < 128; y += 32) {
        ctx.fillStyle = "rgba(40,42,35,.25)";
        ctx.fillRect(0, y, 128, 3);
        for (let x = y % 64 ? 32 : 0; x < 128; x += 64)
          ctx.fillRect(x, y, 3, 32);
      }
    else
      for (let i = 0; i < 500; i++) {
        ctx.fillStyle = `rgba(70,55,35,${rand() * 0.06})`;
        ctx.fillRect(rand() * 128, rand() * 128, 1, 1);
      }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    textures.push(t);
    return t;
  }
  function material(
    style: keyof typeof palettes,
    kind: Surface,
    covering: ExteriorSettings["covering"],
  ) {
    const key = style + kind + covering;
    let m = materials.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({
        map: texture(style, kind, covering),
        metalness: kind === "glass" ? 0.25 : 0,
        roughness: kind === "glass" ? 0.2 : 0.94,
        side: THREE.DoubleSide,
      });
      materials.set(key, m);
    }
    return m;
  }
  function geometry(numbers: number[], kind: Surface) {
    const points = new Float32Array(numbers.length),
      uv = new Float32Array((numbers.length / 3) * 2);
    for (let i = 0; i < numbers.length; i += 3) {
      const x = numbers[i],
        y = numbers[i + 1],
        z = numbers[i + 2];
      points[i] = x / 1000;
      points[i + 1] = z / 1000;
      points[i + 2] = -y / 1000;
      uv[(i / 3) * 2] = (kind === "roof" ? x : x + y) / 700;
      uv[(i / 3) * 2 + 1] = (kind === "roof" ? y : z) / 700;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(points, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.computeVertexNormals();
    g.computeBoundingBox();
    return g;
  }
  function disposeGroup(g: THREE.Group) {
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    root.remove(g);
  }
  function invalidate() {
    if (disposed || lost || !visible || document.hidden || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (disposed || lost || !visible || document.hidden) return;
      try {
        // Small merged decorative buffers disappear at distance; architectural
        // walls, openings, roofs and framing remain visible at every distance.
        const near =
          camera.position.distanceTo(controls.target) / camera.zoom <
          extent * 3;
        root.traverse((o) => {
          if (o.userData.fineDetail) o.visible = near;
        });
        renderer.render(scene, camera);
        host.dataset.drawCalls = String(renderer.info.render.calls);
        host.dataset.renderCount = String(
          Number(host.dataset.renderCount || 0) + 1,
        );
        host.dataset.projection = camera.projectionMatrix.toArray().join(",");
        host.dataset.camera = [
          ...camera.position.toArray(),
          ...controls.target.toArray(),
          camera.zoom,
        ]
          .map((n) => n.toFixed(5))
          .join(",");
      } catch (e) {
        lost = true;
        onFailure(
          `3D rendering stopped: ${(e as Error).message}. Your project remains safe; return to 2D or retry.`,
        );
      }
    });
  }
  function resize() {
    const r = host.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    renderer.setSize(r.width, r.height);
    perspective.aspect = r.width / r.height;
    perspective.updateProjectionMatrix();
    const half = (extent * 0.65) / Math.min(1, r.width / r.height);
    orthographic.left = (-half * r.width) / r.height;
    orthographic.right = (half * r.width) / r.height;
    orthographic.top = half;
    orthographic.bottom = -half;
    orthographic.updateProjectionMatrix();
    invalidate();
  }
  function highlight() {
    if (ornamentHelper) {
      root.remove(ornamentHelper);
      ornamentHelper.geometry.dispose();
      (ornamentHelper.material as THREE.Material).dispose();
      ornamentHelper = null;
    }
    const ornamentPick = ornamentPicks.find(
      (p) => p.anchor.ornament.id === selectedOrnament,
    );
    if (ornamentPick) {
      const box = ornamentPick.mesh.geometry.boundingBox!.clone();
      for (const p of ornamentPicks)
        if (p.anchor.ornament.id === selectedOrnament)
          box.union(p.mesh.geometry.boundingBox!);
      box.expandByScalar(0.035);
      ornamentHelper = new THREE.Box3Helper(box, "#e6b85e");
      root.add(ornamentHelper);
    }
    if (windowHelper) {
      root.remove(windowHelper);
      windowHelper.geometry.dispose();
      (windowHelper.material as THREE.Material).dispose();
      windowHelper = null;
    }
    if (activeBuilding && selectedWindow) {
      const section = activeBuilding.sections.find((s) => s.id === selected),
        w = section?.exterior.windows.find((w) => w.id === selectedWindow);
      if (section && w) {
        const g = openingGeometry(
          openingContext(activeBuilding),
          windowOpening(section, w),
        );
        const box = new THREE.Box3().setFromPoints([
          enginePoint(g.gap.x - 80, g.gap.y - 80, w.sill - 80),
          enginePoint(
            g.gap.x + g.gap.width + 80,
            g.gap.y + g.gap.height + 80,
            w.sill + w.height + 80,
          ),
        ]);
        windowHelper = new THREE.Box3Helper(box, "#e6b85e");
        root.add(windowHelper);
      }
    }
    if (helper) {
      scene.remove(helper);
      helper.geometry.dispose();
      (helper.material as THREE.Material).dispose();
      helper = null;
    }
    const group = groups.get(selected)?.group;
    if (group) {
      helper = new THREE.BoxHelper(group, "#b58b42");
      scene.add(helper);
    }
    invalidate();
  }
  function fit(reset = false) {
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root),
      center = box.getCenter(new THREE.Vector3()),
      size = box.getSize(new THREE.Vector3());
    if (box.isEmpty()) return;
    extent = Math.max(size.length(), 1);
    const direction = reset
      ? new THREE.Vector3(1, 0.8, 1.2).normalize()
      : camera.position.clone().sub(controls.target).normalize();
    if (direction.lengthSq() < 0.1) direction.set(1, 0.8, 1.2).normalize();
    controls.target.copy(center);
    camera.position
      .copy(center)
      .addScaledVector(
        direction,
        (extent * 0.58) /
          Math.sin(
            Math.atan(
              Math.tan((21 * Math.PI) / 180) * Math.min(1, perspective.aspect),
            ),
          ),
      );
    camera.near = Math.max(0.02, extent / 1000);
    camera.far = extent * 30;
    camera.zoom = 1;
    camera.updateProjectionMatrix();
    controls.minDistance = extent * 0.12;
    controls.maxDistance = extent * 8;
    controls.update();
    resize();
    invalidate();
  }
  function update(model: ExteriorModel, b: Building) {
    clearOrnamentPreview();
    if (ornamentHelper) {
      root.remove(ornamentHelper);
      ornamentHelper.geometry.dispose();
      (ornamentHelper.material as THREE.Material).dispose();
      ornamentHelper = null;
    }
    activeBuilding = b;
    wallContext = openingContext(b);
    ornamentContext = ornamentPlacementContext(b);
    for (const p of ornamentPicks) p.mesh.geometry.dispose();
    ornamentPicks.length = 0;
    for (const section of b.sections)
      if (section.exterior.ornamentation.level !== "None")
        for (const ornament of section.exterior.ornamentation.items) {
          const parts = ornamentPickParts(
            b,
            section,
            ornament,
            ornamentContext,
          );
          for (const [kind, points] of Object.entries(parts))
            if (points.length) {
              const mesh = new THREE.Mesh(
                geometry(points, "ornamentWood"),
                pickMaterial,
              );
              mesh.userData.fineDetail = kind === "relief";
              // Off-scene meshes are raycast only: no per-ornament visible draw calls.
              ornamentPicks.push({
                anchor: { sectionId: section.id, ornament },
                mesh,
              });
            }
        }
    host.dataset.ornamentPickCount = String(
      new Set(ornamentPicks.map((p) => p.anchor.ornament.id)).size,
    );
    const wanted = new Set(model.sections.map((s) => s.id));
    for (const [id, item] of groups)
      if (!wanted.has(id)) {
        disposeGroup(item.group);
        groups.delete(id);
      }
    for (const s of model.sections) {
      const key = JSON.stringify(s);
      if (groups.get(s.id)?.key === key) continue;
      const old = groups.get(s.id);
      if (old) disposeGroup(old.group);
      const group = new THREE.Group();
      group.userData.sectionId = s.id;
      for (const [kind, points] of Object.entries(s.parts) as [
        Surface,
        number[],
      ][]) {
        if (!points.length) continue;
        const mesh = new THREE.Mesh(
          geometry(points, kind),
          material(s.stylePreset, kind, s.covering),
        );
        mesh.userData.sectionId = s.id;
        mesh.userData.surface = kind;
        mesh.userData.fineDetail = kind === "detail" || kind === "roofDetail";
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
      }
      groups.set(s.id, { key, group });
      root.add(group);
      rebuilds++;
    }
    root.rotation.y = ((b.frame.axis + b.frame.rotation) * Math.PI) / 180;
    root.position.copy(
      enginePoint(b.frame.origin.x, b.frame.origin.y, b.sections[0].position.z),
    );
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root),
      center = box.getCenter(new THREE.Vector3()),
      size = box.getSize(new THREE.Vector3()),
      span = Math.max(size.x, size.z, 10) * 3;
    ground.position.set(center.x, root.position.y - 0.012, center.z);
    ground.scale.set(span, span, 1);
    sun.position
      .copy(center)
      .add(new THREE.Vector3(span * 0.3, span * 0.6, span * 0.2));
    sun.target.position.copy(center);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -span / 2;
    sc.right = sc.top = span / 2;
    sc.near = 0.1;
    sc.far = span * 3;
    sc.updateProjectionMatrix();
    sun.shadow.needsUpdate = true;
    host.dataset.meshRebuilds = String(rebuilds);
    host.dataset.triangles = String(
      model.sections.reduce(
        (n, s) =>
          n + Object.values(s.parts).reduce((m, p) => m + p.length / 9, 0),
        0,
      ),
    );
    if (!initialized) {
      fit(true);
      initialized = true;
    } else if (previousCenter) {
      const delta = center.clone().sub(previousCenter);
      camera.position.add(delta);
      controls.target.add(delta);
      controls.update();
    }
    previousCenter = center.clone();
    highlight();
    invalidate();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  const intersection = new IntersectionObserver((entries) => {
    visible = entries[0].isIntersecting;
    if (!visible && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    if (visible) invalidate();
  });
  intersection.observe(host);
  const visibility = () => {
    if (document.hidden && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    } else invalidate();
  };
  document.addEventListener("visibilitychange", visibility);
  controls.addEventListener("change", invalidate);
  const raycaster = new THREE.Raycaster(),
    pointers = new Set<number>();
  function wallHit(
    e: Pick<PointerEvent, "clientX" | "clientY">,
    ornamentTool = false,
  ): WallHit | null {
    if (!activeBuilding || !wallContext) return null;
    const r = canvas.getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      return null;
    raycaster.setFromCamera(
      new THREE.Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        (-(e.clientY - r.top) / r.height) * 2 + 1,
      ),
      camera,
    );
    const occluder = raycaster
        .intersectObject(root, true)
        .find(
          (h) =>
            h.object.userData.sectionId &&
            (!ornamentTool ||
              ![
                "detail",
                "roofDetail",
                "ornamentWood",
                "ornamentDark",
                "ornamentOchre",
                "ornamentPale",
              ].includes(h.object.userData.surface)),
        ),
      localRay = raycaster.ray
        .clone()
        .applyMatrix4(root.matrixWorld.clone().invert());
    let nearest: { hit: WallHit; distance: number } | null = null;
    for (const h of wallContext.hosts) {
      if (h.ref.kind !== "exterior") continue;
      const length = Math.hypot(h.b.x - h.a.x, h.b.y - h.a.y),
        u = { x: (h.b.x - h.a.x) / length, y: (h.b.y - h.a.y) / length },
        p = new THREE.Vector3();
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
        enginePoint(h.inward!.x, h.inward!.y, 0).normalize(),
        enginePoint(h.a.x, h.a.y, 0),
      );
      if (!localRay.intersectPlane(plane, p)) continue;
      const x = p.x * 1000,
        y = -p.z * 1000,
        z = p.y * 1000,
        offset = (x - h.a.x) * u.x + (y - h.a.y) * u.y;
      const section = activeBuilding.sections.find(
        (s) => h.ref.kind === "exterior" && s.id === h.ref.sectionId,
      )!;
      if (
        offset < 0 ||
        offset > length ||
        z < 0 ||
        z > section.exterior.wallHeight
      )
        continue;
      if (
        !wallContext.outer.some((a, i) => {
          const b = wallContext!.outer[(i + 1) % wallContext!.outer.length];
          return (
            (Math.abs(a.x - b.x) < 0.001 &&
              Math.abs(x - a.x) < 0.001 &&
              y >= Math.min(a.y, b.y) - 0.001 &&
              y <= Math.max(a.y, b.y) + 0.001) ||
            (Math.abs(a.y - b.y) < 0.001 &&
              Math.abs(y - a.y) < 0.001 &&
              x >= Math.min(a.x, b.x) - 0.001 &&
              x <= Math.max(a.x, b.x) + 0.001)
          );
        })
      )
        continue;
      const distance = p
        .applyMatrix4(root.matrixWorld)
        .distanceTo(raycaster.ray.origin);
      if (distance > (occluder?.distance ?? Infinity) + 0.3) continue;
      if (!nearest || distance < nearest.distance)
        nearest = {
          hit: { sectionId: section.id, edge: h.ref.edge, offset, z },
          distance,
        };
    }
    return nearest?.hit ?? null;
  }
  function pointerRay(e: Pick<PointerEvent, "clientX" | "clientY">) {
    const r = canvas.getBoundingClientRect();
    if (
      r.width < 1 ||
      r.height < 1 ||
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      return false;
    camera.updateMatrixWorld();
    root.updateMatrixWorld(true);
    raycaster.setFromCamera(
      new THREE.Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        (-(e.clientY - r.top) / r.height) * 2 + 1,
      ),
      camera,
    );
    return true;
  }
  function pickOrnament() {
    const visible = raycaster
      .intersectObject(root, true)
      .find((h) => h.object.visible && h.object.userData.sectionId);
    for (const p of ornamentPicks) p.mesh.matrixWorld.copy(root.matrixWorld);
    const near =
      camera.position.distanceTo(controls.target) / camera.zoom < extent * 3;
    const hit = raycaster
      .intersectObjects(
        ornamentPicks
          .filter((p) => near || !p.mesh.userData.fineDetail)
          .map((p) => p.mesh),
        false,
      )
      .find((h) => h.distance <= (visible?.distance ?? Infinity) + 0.002);
    return hit
      ? (ornamentPicks.find((p) => p.mesh === hit.object)?.anchor ?? null)
      : null;
  }
  function ornamentHit(
    e: Pick<PointerEvent, "clientX" | "clientY">,
  ): OrnamentHit | null {
    if (!activeBuilding || !pointerRay(e)) return null;
    const hit = raycaster
      .intersectObject(root, true)
      .find((h) => h.object.visible && h.object.userData.sectionId);
    if (!hit) return null;
    const point = root.worldToLocal(hit.point.clone());
    return {
      sectionId: hit.object.userData.sectionId,
      point: { x: point.x * 1000, y: -point.z * 1000, z: point.y * 1000 },
      wall: wallHit(e, true),
    };
  }
  function ornamentAnchorVisible(anchor: OrnamentAnchor) {
    if (!activeBuilding || !ornamentContext) return false;
    try {
      const section = activeBuilding.sections.find(
        (s) => s.id === anchor.sectionId,
      )!;
      const localCamera = root.worldToLocal(camera.position.clone());
      const frame = resolveOrnament(
        activeBuilding,
        section,
        anchor.ornament,
        ornamentContext.roofAt,
        ornamentContext.opening,
      );
      const facade =
        !isRoofOrnament(anchor.ornament.type) ||
        ["Gable panel", "Bargeboard"].includes(anchor.ornament.type);
      const outward =
        anchor.ornament.anchor.kind === "roof" ? frame.u : frame.v;
      const source = ornamentPlacement?.().getState()?.source;
      const clearSight = (target: THREE.Vector3) => {
        const distance = target.distanceTo(camera.position),
          probe = new THREE.Raycaster();
        probe.set(
          camera.position,
          target.clone().sub(camera.position).normalize(),
        );
        const own = source
          ? ornamentPicks.filter(
              (p) => p.anchor.ornament.id === source.ornament.id,
            )
          : [];
        for (const p of own) p.mesh.matrixWorld.copy(root.matrixWorld);
        const ownDistances = probe
          .intersectObjects(
            own.map((p) => p.mesh),
            false,
          )
          .map((h) => h.distance);
        const hit = probe
          .intersectObject(root, true)
          .find(
            (h) =>
              h.object.visible &&
              h.object.userData.sectionId &&
              !ownDistances.some((d) => Math.abs(d - h.distance) < 0.002),
          );
        if (!hit || hit.distance >= distance - 0.002) return true;
        // Existing cladding/framing on the same exposed host is support, not a
        // concealed wall. Roofs and other facades still occlude the target.
        if (
          facade &&
          hit.object.userData.sectionId === section.id &&
          !String(hit.object.userData.surface).startsWith("roof")
        ) {
          const p = root.worldToLocal(hit.point.clone());
          const normalDistance =
            (p.x * 1000 - frame.origin.x) * outward.x +
            (-p.z * 1000 - frame.origin.y) * outward.y;
          return Math.abs(normalDistance) <= 185;
        }
        return false;
      };
      if (facade) {
        if (
          (localCamera.x * 1000 - frame.origin.x) * outward.x +
            (-localCamera.z * 1000 - frame.origin.y) * outward.y <=
          0
        )
          return false;
        // Test the actual exposed supporting face. A trim itself may sit below
        // an overhang; it does not require floating outward to be placeable.
        const z =
          anchor.ornament.anchor.kind === "roof"
            ? (frame.origin.z + frame.height) / 2
            : frame.origin.z + frame.height / 2;
        return clearSight(
          enginePoint(frame.origin.x, frame.origin.y, z).applyMatrix4(
            root.matrixWorld,
          ),
        );
      }
      const points = ornamentTriangles(
        activeBuilding,
        section,
        anchor.ornament,
        ornamentContext,
        camera.position.distanceTo(controls.target) / camera.zoom < extent * 3,
      );
      let closest = -1,
        top = -1,
        best = Infinity,
        highest = -Infinity;
      for (let i = 0; i < points.length; i += 9) {
        const x = (points[i] + points[i + 3] + points[i + 6]) / 3000,
          y = (points[i + 2] + points[i + 5] + points[i + 8]) / 3000,
          z = -(points[i + 1] + points[i + 4] + points[i + 7]) / 3000;
        const d =
          (x - localCamera.x) ** 2 +
          (y - localCamera.y) ** 2 +
          (z - localCamera.z) ** 2;
        if (d < best) {
          best = d;
          closest = i;
        }
        if (y > highest) {
          highest = y;
          top = i;
        }
      }
      for (const i of new Set([closest, top])) {
        if (i < 0) continue;
        const target = enginePoint(
          (points[i] + points[i + 3] + points[i + 6]) / 3,
          (points[i + 1] + points[i + 4] + points[i + 7]) / 3,
          (points[i + 2] + points[i + 5] + points[i + 8]) / 3,
        ).applyMatrix4(root.matrixWorld);
        if (clearSight(target)) return true;
      }
    } catch {
      /* Invalid support is explained by the canonical placement validator. */
    }
    return false;
  }
  const ornamentGestures = ornamentPlacement
    ? installOrnamentGestures(
        canvas,
        controls,
        ornamentPlacement,
        ornamentHit,
        ornamentAnchorVisible,
      )
    : null;
  const ornamentPreviewGroup = new THREE.Group();
  const ornamentPreviewMaterial = new THREE.MeshBasicMaterial({
    color: "#24a367",
    transparent: true,
    opacity: 0.65,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const ornamentPreviewMesh = new THREE.Mesh(
    new THREE.BufferGeometry(),
    ornamentPreviewMaterial,
  );
  const markerMaterial = new THREE.LineBasicMaterial({ color: "#ce493b" });
  const marker = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    markerMaterial,
  );
  ornamentPreviewGroup.add(ornamentPreviewMesh, marker);
  function clearOrnamentPreview() {
    root.remove(ornamentPreviewGroup);
  }
  function ornamentPreview(state: OrnamentSession | null) {
    clearOrnamentPreview();
    if (!state) ornamentGestures?.reset();
    ornamentPreviewMesh.visible = false;
    marker.visible = false;
    if (state && activeBuilding && ornamentContext) {
      const d = state.draft;
      if (d)
        try {
          const section = activeBuilding.sections.find(
            (s) => s.id === d.sectionId,
          )!;
          const points = ornamentTriangles(
            activeBuilding,
            section,
            d.ornament,
            ornamentContext,
            true,
          );
          const old = ornamentPreviewMesh.geometry.getAttribute("position");
          if (old && old.count === points.length / 3) {
            const a = old.array as Float32Array;
            for (let i = 0; i < points.length; i += 3) {
              a[i] = points[i] / 1000;
              a[i + 1] = points[i + 2] / 1000;
              a[i + 2] = -points[i + 1] / 1000;
            }
            old.needsUpdate = true;
            ornamentPreviewMesh.geometry.computeBoundingBox();
            ornamentPreviewMesh.geometry.computeBoundingSphere();
          } else {
            ornamentPreviewMesh.geometry.dispose();
            ornamentPreviewMesh.geometry = geometry(points, "ornamentWood");
          }
          ornamentPreviewMaterial.color.set(
            state.issue ? "#ce493b" : "#24a367",
          );
          ornamentPreviewMesh.visible = true;
        } catch {
          /* Unsupported anchors use a red surface marker, never substitute saved geometry. */
        }
      if (!ornamentPreviewMesh.visible && state.hit) {
        const p = state.hit.point,
          points = [
            enginePoint(p.x - 180, p.y, p.z),
            enginePoint(p.x + 180, p.y, p.z),
            enginePoint(p.x, p.y, p.z - 180),
            enginePoint(p.x, p.y, p.z + 180),
          ];
        marker.geometry.dispose();
        marker.geometry = new THREE.BufferGeometry().setFromPoints(points);
        marker.visible = true;
      }
      root.add(ornamentPreviewGroup);
    }
    host.dataset.ornamentPreview = !state
      ? "none"
      : state.issue
        ? "invalid"
        : state.draft
          ? "valid"
          : "waiting";
    invalidate();
  }
  const windowGestures = installWindowGestures(
    canvas,
    controls,
    windowPlacement,
    wallHit,
    snapStep,
  );
  function clearPreview() {
    if (!previewGroup) return;
    root.remove(previewGroup);
    previewGroup.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.LineLoop) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    previewGroup = null;
  }
  function windowPreview(state: WindowSession | null) {
    clearPreview();
    if (!state) windowGestures.reset();
    if (state?.draft && activeBuilding && wallContext)
      try {
        const d = state.draft,
          s = activeBuilding.sections.find((s) => s.id === d.sectionId)!;
        const g = openingGeometry(wallContext, windowOpening(s, d.window)),
          n = g.host.inward!,
          w = d.window;
        const points = [
          [-w.width / 2, w.sill],
          [w.width / 2, w.sill],
          [w.width / 2, w.sill + w.height],
          [-w.width / 2, w.sill + w.height],
        ].map(([t, z]) =>
          enginePoint(
            g.host.a.x + g.u.x * (w.offset + t) - n.x * 180,
            g.host.a.y + g.u.y * (w.offset + t) - n.y * 180,
            z,
          ),
        );
        const color = state.issue ? "#ce493b" : "#24a367";
        previewGroup = new THREE.Group();
        const geo = new THREE.BufferGeometry().setFromPoints(points);
        geo.setIndex([0, 1, 2, 0, 2, 3]);
        geo.computeVertexNormals();
        previewGroup.add(
          new THREE.Mesh(
            geo,
            new THREE.MeshBasicMaterial({
              color,
              transparent: true,
              opacity: 0.35,
              side: THREE.DoubleSide,
              depthWrite: false,
            }),
          ),
          new THREE.LineLoop(
            new THREE.BufferGeometry().setFromPoints(points),
            new THREE.LineBasicMaterial({ color }),
          ),
        );
        root.add(previewGroup);
      } catch {
        /* Invalid/missing host is reported by the model validator, never saved. */
      }
    host.dataset.windowPreview = state?.draft
      ? state.issue
        ? "invalid"
        : "valid"
      : state
        ? "waiting"
        : "none";
    invalidate();
  }
  let start = { x: 0, y: 0 },
    multi = false;
  const down = (e: PointerEvent) => {
    pointers.add(e.pointerId);
    if (pointers.size === 1) {
      start = { x: e.clientX, y: e.clientY };
      multi = false;
    } else multi = true;
  };
  const up = (e: PointerEvent) => {
    if (
      !multi &&
      !windowPlacement().getState() &&
      !ornamentPlacement?.().getState() &&
      pointers.size === 1 &&
      Math.hypot(e.clientX - start.x, e.clientY - start.y) < 8
    ) {
      if (!pointerRay(e)) {
        pointers.delete(e.pointerId);
        return;
      }
      const hit = raycaster
        .intersectObject(root, true)
        .find((o) => o.object.userData.sectionId);
      const ornament = pickOrnament();
      if (ornament) {
        onOrnament(ornament.sectionId, ornament.ornament.id);
        pointers.delete(e.pointerId);
        return;
      }
      let windowHit: {
        sectionId: string;
        id: string;
        distance: number;
      } | null = null;
      if (activeBuilding) {
        const context = openingContext(activeBuilding),
          localRay = raycaster.ray
            .clone()
            .applyMatrix4(root.matrixWorld.clone().invert());
        for (const s of activeBuilding.sections)
          for (const w of s.exterior.windows) {
            const g = openingGeometry(context, windowOpening(s, w)),
              plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
                enginePoint(g.n.x, g.n.y, 0).normalize(),
                enginePoint(g.center.x, g.center.y, w.sill),
              ),
              point = new THREE.Vector3();
            if (!localRay.intersectPlane(plane, point)) continue;
            const x = point.x * 1000,
              y = -point.z * 1000,
              z = point.y * 1000;
            if (
              Math.abs((x - g.center.x) * g.u.x + (y - g.center.y) * g.u.y) >
                w.width / 2 + 100 ||
              z < w.sill - 100 ||
              z > w.sill + w.height + 100
            )
              continue;
            const distance = point
              .applyMatrix4(root.matrixWorld)
              .distanceTo(raycaster.ray.origin);
            if (distance > (hit?.distance ?? Infinity) + 0.25) continue;
            if (!windowHit || distance < windowHit.distance)
              windowHit = { sectionId: s.id, id: w.id, distance };
          }
      }
      if (windowHit) onWindow(windowHit.sectionId, windowHit.id);
      else if (hit) {
        const s = activeBuilding?.sections.find(
          (s) => s.id === hit.object.userData.sectionId,
        );
        const point = root.worldToLocal(hit.point.clone());
        const p = { x: point.x * 1000, y: -point.z * 1000 },
          z = point.y * 1000;
        const feature =
          s && activeBuilding && hit.object.userData.surface === "roof"
            ? crossRoofFields(s, activeBuilding).find(
                (f) =>
                  (containsPoint(f.domain, p) || onRing(f.domain, p)) &&
                  Math.abs(fieldHeight(f.planes, p) - z) < 2,
              )
            : null;
        if (feature && s) onRoof(s.id, feature.feature.id);
        else onPick(hit.object.userData.sectionId);
      }
    }
    pointers.delete(e.pointerId);
  };
  const cancel = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    multi = true;
  };
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", cancel);
  const contextLost = (e: Event) => {
    e.preventDefault();
    lost = true;
    ornamentGestures?.reset();
    ornamentPlacement?.().cancel();
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    onFailure(
      "WebGL context lost. Your project and autosave are unaffected. Retry 3D or continue in 2D.",
    );
  };
  canvas.addEventListener("webglcontextlost", contextLost);
  resize();
  return {
    update,
    windowPreview,
    ornamentPreview,
    fit: () => fit(false),
    reset: () => fit(true),
    select: (id: string, windowId = "", ornamentId = "") => {
      selected = id;
      selectedWindow = windowId;
      selectedOrnament = ornamentId;
      highlight();
    },
    projection: (ortho: boolean) => {
      const previous = camera;
      camera = ortho ? orthographic : perspective;
      camera.position.copy(previous.position);
      camera.quaternion.copy(previous.quaternion);
      camera.near = previous.near;
      camera.far = previous.far;
      camera.zoom = 1;
      controls.object = camera;
      controls.update();
      resize();
      invalidate();
    },
    pan: (yes: boolean) => {
      controls.mouseButtons.LEFT = yes ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
      controls.touches.ONE = yes ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE;
    },
    dispose: () => {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersection.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      canvas.removeEventListener("webglcontextlost", contextLost);
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", cancel);
      windowGestures.dispose();
      ornamentGestures?.dispose();
      clearOrnamentPreview();
      ornamentPreviewMesh.geometry.dispose();
      ornamentPreviewMaterial.dispose();
      marker.geometry.dispose();
      markerMaterial.dispose();
      for (const p of ornamentPicks) p.mesh.geometry.dispose();
      pickMaterial.dispose();
      if (ornamentHelper) {
        ornamentHelper.geometry.dispose();
        (ornamentHelper.material as THREE.Material).dispose();
      }
      clearPreview();
      controls.dispose();
      if (helper) {
        helper.geometry.dispose();
        (helper.material as THREE.Material).dispose();
      }
      if (windowHelper) {
        windowHelper.geometry.dispose();
        (windowHelper.material as THREE.Material).dispose();
      }
      for (const item of groups.values()) disposeGroup(item.group);
      for (const m of materials.values()) m.dispose();
      for (const t of textures) t.dispose();
      ground.geometry.dispose();
      groundMaterial.dispose();
      sun.shadow.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
export type ExteriorScene = ReturnType<typeof createExteriorScene>;
