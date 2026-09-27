// test/clashpanel/support/layering.mjs
// Layering guard for clashpanel/ (spec 5.1, AC-P10/AC-P11/AC-P12/AC-P13/AC-P19 static parts). Mirrors
// test/clashtest/viewer/support/layering.mjs (stripComments / importSpecifiers), but every specifier is resolved to a
// repo-relative path and judged against a PER-SUBTREE allow-list, so an import is judged by where it lands.
import { posix } from 'node:path';

const SEG = '[A-Za-z0-9_-]+';

/** Allowed import TARGETS (repo-relative, resolved) per subtree. Anything else is a violation. */
export const ALLOWED_IMPORTS = Object.freeze({
  core: [new RegExp(`^clashpanel/core/${SEG}\\.js$`), /^clashtest\/index\.js$/],
  viewer: [new RegExp(`^clashpanel/viewer/${SEG}\\.js$`), /^clashpanel\/core\/constants\.js$/],
  ui: [
    new RegExp(`^clashpanel/ui/${SEG}\\.js$`), new RegExp(`^clashpanel/ui/render/${SEG}\\.js$`),
    /^clashpanel\/core\/(constants|intents)\.js$/,
  ],
  index: [
    /^clashpanel\/core\/index\.js$/, new RegExp(`^clashpanel/viewer/${SEG}\\.js$`), new RegExp(`^clashpanel/ui/${SEG}\\.js$`),
  ],
});

/** core + viewer only: the headless layers never see a Viewer/DOM global (AC-P10). `globalThis.setTimeout` etc. stay legal. */
export const GLOBAL_BANS = Object.freeze([
  ['Autodesk', /\bAutodesk\b/], ['Viewing', /\bViewing\b/], ['window', /\bwindow\b/], ['document', /\bdocument\b/],
  ['globalThis.THREE', /\bglobalThis\s*\.\s*THREE\b/], ['globalThis[]', /\bglobalThis\s*\[/],
]);

/** every subtree: no Viewer theming (PD-16, AC-P19), no private Viewer API, no element counts (G-EC, AC-P12). */
export const IDENTIFIER_BANS = Object.freeze([
  ['theming', /ThemingColor/],                                         // set/clear/getThemingColor(s)
  ['Private.', /\bPrivate\./],
  ['viewer.impl', /\.\s*impl\b|\[\s*['"`]impl['"`]\s*\]/],
  ['elementCount', /elementCount/],
  ['non-literal import()', /\bimport\s*\(\s*(?!['"])/],
  ['require()', /\brequire\s*\(/],
]);

/** viewer only: the injected THREE is r71, whose Vector3 has no setScalar (use .set(x, y, z)). */
export const VIEWER_BANS = Object.freeze([['setScalar', /\bsetScalar\b/]]);

/** ui + index only: text is inserted with textContent, never as markup (AC-P13). */
export const UI_BANS = Object.freeze([
  ['innerHTML', /\binnerHTML\b/], ['outerHTML', /\bouterHTML\b/], ['insertAdjacentHTML', /\binsertAdjacentHTML\b/],
  ['document.write', /\bdocument\s*\.\s*write/], ['createContextualFragment', /\bcreateContextualFragment\b/],
  ['DOMParser', /\bDOMParser\b/],
]);

export const CLEAN = Object.freeze({ imports: [], globals: [], banned: [] });

export function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

export function importSpecifiers(source) {
  const out = [];
  const patterns = [
    /(?:^|[\n;])\s*(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g,   // import x from / export {..} from / export * from
    /(?:^|[\n;])\s*import\s*['"]([^'"]+)['"]/g,                               // import 'x'
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,                                    // import('x')
  ];
  for (const re of patterns) for (const m of source.matchAll(re)) out.push(m[1]);
  return [...new Set(out)];
}

/** Relative specifier -> repo-relative posix path; anything that is not `./` or `../` (bare, absolute, URL) -> null. */
export function resolveSpecifier(fromRel, spec) {
  if (!spec.startsWith('./') && !spec.startsWith('../')) return null;
  return posix.normalize(posix.join(posix.dirname(fromRel), spec));
}

/** 'core' | 'viewer' | 'ui' | 'index' for a recognised clashpanel/**.js path, else null. */
export function subtreeOf(rel) {
  if (rel === 'clashpanel/index.js') return 'index';
  if (new RegExp(`^clashpanel/core/${SEG}\\.js$`).test(rel)) return 'core';
  if (new RegExp(`^clashpanel/viewer/${SEG}\\.js$`).test(rel)) return 'viewer';
  if (new RegExp(`^clashpanel/ui/(?:render/)?${SEG}\\.js$`).test(rel)) return 'ui';
  return null;
}

/** null when `rel` may exist under clashpanel/; otherwise the reason it may not. */
export function placementProblem(rel) {
  if (rel === 'clashpanel/README.md') return null;
  if (!rel.endsWith('.js')) return `${rel}: clashpanel/ holds only .js modules and the root README.md`;
  return subtreeOf(rel) === null ? `${rel}: not in a known clashpanel subtree (core, viewer, ui, ui/render, index.js)` : null;
}

export function violations(rel, source) {
  const out = { imports: [], globals: [], banned: [] };
  const subtree = subtreeOf(rel);
  const code = stripComments(source);
  if (subtree !== null) {
    for (const spec of importSpecifiers(code)) {
      const resolved = resolveSpecifier(rel, spec);
      if (resolved === null || !ALLOWED_IMPORTS[subtree].some((re) => re.test(resolved))) out.imports.push(spec);
    }
  }
  const bans = [
    ...(subtree === 'core' || subtree === 'viewer' ? GLOBAL_BANS : []),
    ...IDENTIFIER_BANS,
    ...(subtree === 'viewer' ? VIEWER_BANS : []),
    ...(subtree === 'ui' || subtree === 'index' ? UI_BANS : []),
  ];
  for (const [name, re] of bans) {
    if (!re.test(code)) continue;
    if (GLOBAL_BANS.some(([n]) => n === name)) out.globals.push(name);
    else out.banned.push(name);
  }
  return out;
}

/** Reverse guard: every specifier (relative or absolute) in `source` that names the clashpanel tree. */
export function importsClashpanel(source) {
  return importSpecifiers(stripComments(source)).filter((s) => /(^|\/)clashpanel(\/|$)/.test(s));
}
