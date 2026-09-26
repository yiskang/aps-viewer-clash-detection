// test/clashpanel/support/fakeThree.mjs
// r71-subset THREE double: exactly the classes the Panel's viewer layer may use. Vector3 deliberately has NO setScalar
// (absent in r71). Geometries/materials count their dispose() calls so a test can prove shared resources are disposed
// once, only after their meshes are gone, and per-object geometry is disposed at removal.
export function createFakeThree() {
  const created = { geometry: [], material: [], mesh: [], line: [] };

  class Vector3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    copy(v) { return this.set(v.x, v.y, v.z); }
    clone() { return new Vector3(this.x, this.y, this.z); }
    add(v) { return this.set(this.x + v.x, this.y + v.y, this.z + v.z); }
    sub(v) { return this.set(this.x - v.x, this.y - v.y, this.z - v.z); }
    multiplyScalar(s) { return this.set(this.x * s, this.y * s, this.z * s); }
    length() { return Math.hypot(this.x, this.y, this.z); }
    distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
    equals(v) { return this.x === v.x && this.y === v.y && this.z === v.z; }
    toArray() { return [this.x, this.y, this.z]; }
  }
  class Color {
    constructor(hex = 0xffffff) { this.hex = hex; }
    set(hex) { this.hex = hex; return this; }
  }
  class Box3 {
    constructor(min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity)) { this.min = min; this.max = max; }
    set(min, max) { this.min = min; this.max = max; return this; }
    setFromPoints(points) {
      this.min = new Vector3(Infinity, Infinity, Infinity);
      this.max = new Vector3(-Infinity, -Infinity, -Infinity);
      for (const p of points) {
        this.min.set(Math.min(this.min.x, p.x), Math.min(this.min.y, p.y), Math.min(this.min.z, p.z));
        this.max.set(Math.max(this.max.x, p.x), Math.max(this.max.y, p.y), Math.max(this.max.z, p.z));
      }
      return this;
    }
    isEmpty() { return this.max.x < this.min.x || this.max.y < this.min.y || this.max.z < this.min.z; }
    getCenter(target = new Vector3()) { return target.set((this.min.x + this.max.x) / 2, (this.min.y + this.max.y) / 2, (this.min.z + this.max.z) / 2); }
    getSize(target = new Vector3()) { return target.set(this.max.x - this.min.x, this.max.y - this.min.y, this.max.z - this.min.z); }
  }
  class BufferGeometry {
    constructor() { this.points = []; this.disposeCount = 0; created.geometry.push(this); }
    setFromPoints(points) {
      if (!Array.isArray(points) || !points.every((p) => p instanceof Vector3)) throw new TypeError('BufferGeometry.setFromPoints: expected an array of Vector3');
      this.points = points.map((p) => p.clone());
      return this;
    }
    dispose() { this.disposeCount += 1; }
  }
  class SphereGeometry extends BufferGeometry {
    constructor(radius = 50, widthSegments = 8, heightSegments = 6) { super(); this.parameters = { radius, widthSegments, heightSegments }; }
  }
  class Material {
    constructor(parameters = {}) { this.parameters = { ...parameters }; this.disposeCount = 0; created.material.push(this); }
    dispose() { this.disposeCount += 1; }
  }
  class MeshBasicMaterial extends Material {}
  class LineBasicMaterial extends Material {}
  class Object3D {
    constructor() { this.position = new Vector3(); this.scale = new Vector3(1, 1, 1); this.name = ''; this.userData = {}; this.visible = true; }
  }
  class Mesh extends Object3D {
    constructor(geometry, material) {
      super();
      if (!(geometry instanceof BufferGeometry)) throw new TypeError('Mesh: geometry must be a BufferGeometry');
      if (!(material instanceof Material)) throw new TypeError('Mesh: material must be a Material');
      this.geometry = geometry; this.material = material; this.isMesh = true; created.mesh.push(this);
    }
  }
  class Line extends Object3D {
    constructor(geometry, material) {
      super();
      if (!(geometry instanceof BufferGeometry)) throw new TypeError('Line: geometry must be a BufferGeometry');
      if (!(material instanceof Material)) throw new TypeError('Line: material must be a Material');
      this.geometry = geometry; this.material = material; this.isLine = true; created.line.push(this);
    }
  }
  const THREE = { REVISION: '71', Vector3, Color, Box3, BufferGeometry, SphereGeometry, MeshBasicMaterial, LineBasicMaterial, Object3D, Mesh, Line };
  const stats = {
    created,
    liveGeometries: () => created.geometry.filter((g) => g.disposeCount === 0),
    liveMaterials: () => created.material.filter((m) => m.disposeCount === 0),
    overDisposed: () => [...created.geometry, ...created.material].filter((x) => x.disposeCount > 1),
  };
  return { THREE, stats };
}
