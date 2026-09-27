// clashpanel/viewer/markers.js
// Panel-owned overlay markers (spec §9.2 "Marker"; PD-16): a location marker (Hard: one sphere at the
// witness point; Soft: two spheres + a line at closestPoints) and per-side bounds outlines (wireframe
// boxes in two distinct colours). Duplicated — not imported — from the Clash Finder extension's marker
// code (OD-10). Tier B: proven against fakes only; overlay rendering, colour fidelity and whether
// element bounds are world-space are live gates (G2 / PG-1 / F7).
//
// THREE is the injected r71 namespace. Strict subset used: Vector3 (constructor only — r71 has no
// setScalar), Mesh, SphereGeometry, MeshBasicMaterial, LineBasicMaterial, BufferGeometry#setFromPoints,
// Line. Overlay calls are ALWAYS mesh first, scene name second.

// PRESENTATION constants (spec §12.4) — visual tuning only, never limits; duplicated values.
export const MARKER_RADIUS_FRACTION = 0.002;
export const MIN_MARKER_RADIUS = 0.05;
export const MAX_MARKER_RADIUS = 2.0;
export const HARD_MARKER_COLOR = 0xff6a00;
export const SOFT_MARKER_COLOR = 0x2b8fff;
export const OUTLINE_COLORS = Object.freeze([0xffd400, 0xd400ff]);   // side 1, side 2
const OPACITY = 0.65;

const isPoint = (p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);

// A usable bounds box: 6 finite numbers, min <= max on every axis. Anything else is "unavailable".
export function validBox(box) {
  if (box === null || box === undefined || typeof box.length !== 'number' || box.length !== 6) return false;
  for (let i = 0; i < 6; i++) if (!Number.isFinite(box[i])) return false;
  return box[0] <= box[3] && box[1] <= box[4] && box[2] <= box[5];
}

// Like the Clash Finder radius: bounding-sphere radius of the union box × fraction, clamped. Invalid
// boxes are skipped; no valid box (or a non-finite result) ⇒ the minimum radius.
export function computeMarkerRadius(boxes) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let any = false;
  for (const b of boxes) {
    if (!validBox(b)) continue;
    any = true;
    for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], b[i]); max[i] = Math.max(max[i], b[i + 3]); }
  }
  if (!any) return MIN_MARKER_RADIUS;
  const radius = 0.5 * Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  if (!Number.isFinite(radius)) return MIN_MARKER_RADIUS;
  return Math.min(Math.max(radius * MARKER_RADIUS_FRACTION, MIN_MARKER_RADIUS), MAX_MARKER_RADIUS);
}

// Continuous polyline over all 12 box edges (edges retraced where needed): usable with plain Line.
function boxEdgePath(b) {
  const [x0, y0, z0, x1, y1, z1] = b;
  return [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, y0, z1],
    [x0, y1, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [x1, y0, z0],
  ];
}

export function createMarkerSet({ THREE, overlays, names }) {
  if (!THREE || !overlays || typeof names?.overlayMarkers !== 'string' || typeof names?.overlayOutlines !== 'string') {
    throw new TypeError('createMarkerSet: THREE, overlays and names {overlayMarkers, overlayOutlines} are required');
  }
  const created = new Map();       // mesh -> scene name (every object this set created, by reference)
  const perObject = new Set();     // per-object geometries (lines, outline boxes): disposed at removal
  const scenesAdded = new Set();
  let shared = null;

  function ensureShared() {
    if (shared === null) {
      const basic = (color) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: OPACITY, depthTest: false, depthWrite: false });
      const line = (color) => new THREE.LineBasicMaterial({ color, transparent: true, opacity: OPACITY, depthTest: false });
      shared = {
        sphere: new THREE.SphereGeometry(1, 12, 8),   // unit sphere, scaled per instance
        hard: basic(HARD_MARKER_COLOR),
        soft: basic(SOFT_MARKER_COLOR),
        softLine: line(SOFT_MARKER_COLOR),
        outline: OUTLINE_COLORS.map(line),
      };
    }
    return shared;
  }

  function ensureScene(name, beforeScene) {
    if (!overlays.hasScene(name)) {
      if (beforeScene) beforeScene(name);
      scenesAdded.add(name);          // write-ahead: an addScene that throws AFTER creating the scene is still ours
      overlays.addScene(name);
    }
  }

  // Hooks: beforeAdd(mesh, sceneName) runs immediately before each overlays.addMesh (the bridge records
  // the write-ahead intent and re-checks its token there); beforeScene(sceneName) immediately before an
  // overlays.addScene. A throw from either aborts before that mutation.
  function add(mesh, name, beforeAdd) {
    created.set(mesh, name);
    if (beforeAdd) beforeAdd(mesh, name);
    overlays.addMesh(mesh, name);
    return mesh;
  }

  function sphere(material, p, radius) {
    const mesh = new THREE.Mesh(ensureShared().sphere, material);
    mesh.scale.set(radius, radius, radius);
    mesh.position.set(p[0], p[1], p[2]);
    if (typeof mesh.updateMatrixWorld === 'function') mesh.updateMatrixWorld(true);
    return mesh;
  }

  function lineThrough(points, material) {
    const geometry = new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
    perObject.add(geometry);
    return new THREE.Line(geometry, material);
  }

  // req: {point?, closestPoints?:{first,second}, radius}. Returns the meshes added (possibly none).
  function addLocation(req, { beforeAdd, beforeScene } = {}) {
    const radius = Number.isFinite(req?.radius) && req.radius > 0 ? req.radius : MIN_MARKER_RADIUS;
    const cp = req?.closestPoints;
    const name = names.overlayMarkers;
    const out = [];
    if (cp && isPoint(cp.first) && isPoint(cp.second)) {
      const s = ensureShared();
      ensureScene(name, beforeScene);
      out.push(add(sphere(s.soft, cp.first, radius), name, beforeAdd));
      out.push(add(sphere(s.soft, cp.second, radius), name, beforeAdd));
      out.push(add(lineThrough([cp.first, cp.second], s.softLine), name, beforeAdd));
    } else if (isPoint(req?.point)) {
      const s = ensureShared();
      ensureScene(name, beforeScene);
      out.push(add(sphere(s.hard, req.point, radius), name, beforeAdd));
    }
    return out;
  }

  // Evidence-gated outlines: boundsFn(model, dbId) -> number[6] | null; null/throw/invalid ⇒ omitted.
  function addOutlines(sides, boundsFn, { beforeAdd, beforeScene } = {}) {
    const name = names.overlayOutlines;
    const meshes = [];
    let omitted = 0;
    sides.forEach((side, i) => {
      let box = null;
      try { box = boundsFn(side.model, side.dbId); } catch { box = null; }
      if (!validBox(box)) { omitted += 1; return; }
      const s = ensureShared();
      ensureScene(name, beforeScene);
      meshes.push(add(lineThrough(boxEdgePath(box), s.outline[i % s.outline.length]), name, beforeAdd));
    });
    return { meshes, omitted };
  }

  // Remove ONE mesh this set created, by exact reference; per-object geometry disposed after removal.
  // Returns false for a mesh this set never created (foreign meshes are never touched). Throws if the
  // overlay call throws (the caller decides on retry); the mesh then stays tracked.
  function remove(mesh) {
    const name = created.get(mesh);
    if (name === undefined) return false;
    overlays.removeMesh(mesh, name);
    created.delete(mesh);
    if (mesh.geometry && perObject.has(mesh.geometry)) { perObject.delete(mesh.geometry); mesh.geometry.dispose(); }
    return true;
  }

  function removeAll() {
    let removed = 0;
    for (const mesh of [...created.keys()]) {
      try { if (remove(mesh)) removed += 1; } catch { /* stays tracked; reported by count */ }
    }
    return removed;
  }

  // After every mesh is gone: dispose shared geometry/materials and remove the scenes this set added.
  // A scene that still holds a Panel-created mesh whose removal failed is KEPT (never removeScene under a
  // tracked mesh), and so are the shared resources (never dispose what is still drawn); both are retried on
  // the next call. Returns true when everything this set owns is gone.
  function disposeShared() {
    try {
      if (shared !== null && created.size === 0) {
        shared.sphere.dispose();
        shared.hard.dispose();
        shared.soft.dispose();
        shared.softLine.dispose();
        for (const m of shared.outline) m.dispose();
        shared = null;
      }
    } finally {
      const occupied = new Set(created.values());
      for (const name of [...scenesAdded]) {
        if (occupied.has(name)) continue;
        try {
          if (overlays.hasScene(name)) overlays.removeScene(name);
          scenesAdded.delete(name);
        } catch { /* kept: retried on the next call */ }
      }
    }
    return shared === null && created.size === 0 && scenesAdded.size === 0;
  }

  return Object.freeze({ addLocation, addOutlines, remove, removeAll, disposeShared, size: () => created.size, owns: (m) => created.has(m) });
}
