// spike/m4/s1-module-resolution/worker.bare.mjs -- S1' primary variant: bare specifiers, relying
// entirely on whatever import-map inheritance the worker's realm actually has (§8.6's open
// question this spike settles).
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
self.postMessage({ ok: true, hasThree: !!THREE.Vector3, hasBvh: typeof MeshBVH === 'function' });
