// Read-only: list bucket objects (with sizes) and GET each manifest. No mutation.
import { listObjects, getManifest, urnify } from '/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/services/aps.js';
import { writeFile } from 'node:fs/promises';

const out = [];
const objects = await listObjects();
for (const o of objects) {
  const urn = urnify(o.objectId);
  let m = null, err = null;
  try { m = await getManifest(urn); } catch (e) { err = String(e && e.message || e); }
  const derivs = (m && m.derivatives) || [];
  const svf2 = derivs.filter((d) => d.outputType === 'svf2');
  const has3d = (nodes) => JSON.stringify(nodes || []).includes('"role":"3d"');
  out.push({
    name: o.objectKey, size: o.size, urn,
    manifestStatus: m ? m.status : null, manifestProgress: m ? m.progress : null,
    outputTypes: derivs.map((d) => d.outputType),
    svf2Derivatives: svf2.map((d) => ({ status: d.status, has3dViewable: has3d(d.children) })),
    error: err,
  });
}
await writeFile(process.argv[2], JSON.stringify(out, null, 2));
console.log(out.length);
