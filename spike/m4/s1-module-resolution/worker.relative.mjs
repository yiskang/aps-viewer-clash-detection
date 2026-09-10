// spike/m4/s1-module-resolution/worker.relative.mjs -- S1' fallback variant #1: relative paths
// directly to the vendored files, bypassing the import map entirely.
//
// Real bug found running this task's own manual verification (matching the established Phase 3
// pattern of the brief's excerpts needing an empirical check against the live app): the brief's
// own excerpt used `../../wwwroot/vendor/...`, but `wwwroot/` is mounted by BOTH server.js:7 and
// this task's own spike-server.mjs via `express.static('wwwroot')`, which serves that directory's
// CONTENTS at the URL ROOT -- confirmed directly in wwwroot/index.html's own import map
// (`"three": "/vendor/three/build/three.module.js"`, wwwroot/index.html:49), never
// `/wwwroot/vendor/...`. This worker is served at
// `/spike/m4/s1-module-resolution/worker.relative.mjs`, three path segments below the served
// root, so the correct relative path is `../../../vendor/...` (three `../`, no `wwwroot` segment)
// -- confirmed empirically: `new URL('../../../vendor/three/build/three.module.js', <this file's
// URL>).pathname === '/vendor/three/build/three.module.js'`.
import * as THREE from '../../../vendor/three/build/three.module.js';
import { MeshBVH } from '../../../vendor/three-mesh-bvh/src/index.js';
self.postMessage({ ok: true, hasThree: !!THREE.Vector3, hasBvh: typeof MeshBVH === 'function' });
