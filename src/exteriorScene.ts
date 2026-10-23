import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Building } from "./model";
import type { ExteriorModel, Surface } from "./exteriorGeometry";
/** Isolated engine conversion: model XY horizontal / Z up (mm) → Three XZ / Y up (m). */
export const enginePoint = (x: number, y: number, z: number) =>
  new THREE.Vector3(x / 1000, z / 1000, -y / 1000);
const palettes = {
  Norse: {
    wall: "#79563a",
    roof: "#302d29",
    stone: "#77766b",
    timber: "#38291e",
    door: "#60432e",
  },
  Medieval: {
    wall: "#ded2ad",
    roof: "#4d5353",
    stone: "#858071",
    timber: "#493528",
    door: "#705039",
  },
  Mixed: {
    wall: "#bca780",
    roof: "#4c3c30",
    stone: "#7e7b70",
    timber: "#453225",
    door: "#624832",
  },
};
export function createExteriorScene(
  host: HTMLDivElement,
  onPick: (id: string) => void,
  onFailure: (text: string) => void,
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
  function texture(style: keyof typeof palettes, kind: Surface) {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = palettes[style][kind];
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
    else if (kind === "wall" && style === "Norse")
      for (let y = 0; y < 128; y += 16) {
        ctx.fillStyle = "rgba(0,0,0,.24)";
        ctx.fillRect(0, y, 128, 2);
        ctx.fillStyle = "rgba(220,190,130,.1)";
        ctx.fillRect(0, y + 3, 128, 1);
      }
    else if (kind === "stone")
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
  function material(style: keyof typeof palettes, kind: Surface) {
    const key = style + kind;
    let m = materials.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({
        map: texture(style, kind),
        roughness: 0.94,
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
        renderer.render(scene, camera);
        host.dataset.renderCount = String(
          Number(host.dataset.renderCount || 0) + 1,
        );
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
          material(s.material, kind),
        );
        mesh.userData.sectionId = s.id;
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
      pointers.size === 1 &&
      Math.hypot(e.clientX - start.x, e.clientY - start.y) < 8
    ) {
      const r = canvas.getBoundingClientRect();
      raycaster.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - r.left) / r.width) * 2 - 1,
          (-(e.clientY - r.top) / r.height) * 2 + 1,
        ),
        camera,
      );
      const hit = raycaster
        .intersectObject(root, true)
        .find((o) => o.object.userData.sectionId);
      if (hit) onPick(hit.object.userData.sectionId);
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
    fit: () => fit(false),
    reset: () => fit(true),
    select: (id: string) => {
      selected = id;
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
      controls.dispose();
      if (helper) {
        helper.geometry.dispose();
        (helper.material as THREE.Material).dispose();
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
