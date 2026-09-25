// test/clashtest/viewer/support/layering.mjs
export const ALLOWED_IMPORTS = [
  /^\.\/[A-Za-z0-9_-]+\.js$/,
  /^\.\.\/planning\/(ElementEnumerator|scopeDigest)\.js$/,
  /^\.\.\/util\/slicer\.js$/,
  /^\.\.\/identity\/ModelRegistry\.js$/,                       // assertRegistryBelongsToWorld only (Task 11)
  /^\.\.\/\.\.\/collision\/(errors|constants)\.js$/,
];
export const FORBIDDEN_GLOBALS = [
  ['Autodesk', /\bAutodesk\b/], ['Viewing', /\bViewing\b/], ['window', /\bwindow\b/],
  ['document', /\bdocument\b/], ['globalThis.THREE', /\bglobalThis\.THREE\b/],
];

export function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

export function importSpecifiers(source) {
  const out = [];
  const patterns = [
    /(?:^|[\n;])\s*(?:import|export)\s[^'"`;]*?\sfrom\s*['"]([^'"]+)['"]/g, // import x from / export {..} from
    /(?:^|[\n;])\s*import\s*['"]([^'"]+)['"]/g,                                // import 'x'
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,                                       // import('x')
  ];
  for (const re of patterns) for (const m of source.matchAll(re)) out.push(m[1]);
  return [...new Set(out)];
}

export function violations(source) {
  const code = stripComments(source);
  return {
    imports: importSpecifiers(code).filter((s) => !ALLOWED_IMPORTS.some((re) => re.test(s))),
    globals: FORBIDDEN_GLOBALS.filter(([, re]) => re.test(code)).map(([name]) => name),
  };
}
