// test/clashtest/support/schemaMutations.mjs
import { TYPES, STRING_CAPS, EVIDENCE_BY_MODE } from '../../../clashtest/results/resultSetSchema.js';

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const specOf = (of) => (typeof of === 'string' ? { kind: 'object', of } : of);
const at = (root, path) => path.split('/').slice(1).reduce((o, k) => o?.[k], root);
const setAt = (root, path, value) => {
  const keys = path.split('/').slice(1);
  const parent = keys.slice(0, -1).reduce((o, k) => o[k], root);
  parent[keys[keys.length - 1]] = value;
  return root;
};
const deleteAt = (root, path) => {
  const keys = path.split('/').slice(1);
  const parent = keys.slice(0, -1).reduce((o, k) => o[k], root);
  delete parent[keys[keys.length - 1]];
  return root;
};
const put = (path, value) => (clone) => setAt(clone, path, value);

/** One violation per class, per DECLARED field, at every place that field actually occurs in
 *  `set`. Because it reads the production `TYPES` table, a new schema row automatically produces
 *  new mutations — the two cannot drift. */
export function* schemaMutations(set) {
  yield* walk(set, 'ResultSet', '');
}

function* walk(value, typeName, path) {
  const type = TYPES.get(typeName);
  for (const [name, spec] of Object.entries(type.fields)) {
    const at2 = `${path}/${name}`;
    if (!(name in value)) continue;                       // not reachable in this fixture
    if (spec.delegated === true) continue;
    if (spec.free === true) {
      // `evidence` is declared free because its shape is PER-MODE and the schema's `custom` hook
      // checks it. The generator must descend with that same per-mode type, or every evidence row
      // would look unreachable and the anti-drift test would waive real coverage.
      if (type.custom === 'evidenceByMode' && name === 'evidence'
          && EVIDENCE_BY_MODE[value.mode] !== undefined) {
        yield* walk(value[name], EVIDENCE_BY_MODE[value.mode], at2);
      }
      continue;
    }
    yield* mutationsFor(typeName, name, spec, at2, value[name]);
    yield* descend(value[name], spec, at2);
  }
}

function* descend(value, spec, path) {
  if (spec.kind === 'object' && isPlain(value) && spec.free !== true) yield* walk(value, spec.of, path);
  if (spec.kind === 'array' && Array.isArray(value)) {
    const item = specOf(spec.of);
    for (let i = 0; i < value.length; i += 1) yield* descend(value[i], item, `${path}/${i}`);
  }
}

function* mutationsFor(type, field, spec, path, value) {
  const row = (code, apply) => ({ type, field, path, code, apply });
  if (spec.optional !== true) yield row(spec.missingCode ?? 'missing-field', (c) => deleteAt(c, path));
  if (spec.nullable !== true) yield row('null-not-allowed', put(path, null));
  switch (spec.kind) {
    case 'literal':
      yield row(spec.code ?? 'literal-invalid', put(path, typeof spec.value === 'boolean' ? !spec.value : '~'));
      break;
    case 'boolean':
      yield row('type-invalid', put(path, 'true'));
      break;
    case 'number':
      yield row('type-invalid', put(path, String(value ?? 1)));
      yield row('type-invalid', put(path, Number.NaN));      // non-finite is a TYPE failure, not a bound one
      if (spec.integer === true) {
        yield row('number-out-of-range', put(path, 1.5));
        yield row('number-out-of-range', put(path, (spec.min ?? 0) - 1));
        yield row('number-out-of-range', put(path, Number.MAX_SAFE_INTEGER + 2));
      }
      break;
    case 'string':
      yield row('type-invalid', put(path, 42));
      if (spec.values !== undefined) yield row(spec.code ?? 'enum-invalid', put(path, '~no-such-value~'));
      else if (spec.pattern !== undefined) yield row(spec.code ?? 'digest-syntax-invalid', put(path, 'sha256:nope'));
      else yield row('string-too-long', put(path, 'x'.repeat(STRING_CAPS[spec.cap] + 1)));
      break;
    case 'object':
      yield row('container-invalid', put(path, []));
      break;
    case 'array':
      yield row('container-invalid', put(path, {}));
      if (spec.exact !== undefined) yield row('array-length-invalid', put(path, Array(spec.exact + 1).fill(0)));
      else if (spec.max !== undefined && spec.max < 5_000) {
        // Only for ceilings small enough to materialise; the large ones are covered by the
        // `arrayLimitFor` capture test instead (see P5.4), which refuses before allocation.
        yield row('array-too-long', put(path, Array.from({ length: spec.max + 1 }, () => value?.[0] ?? 0)));
      }
      if ((spec.uniqueBy !== undefined || spec.unique === true) && Array.isArray(value) && value.length > 0) {
        yield row(spec.uniqueCode ?? 'duplicate-key',
          put(path, [...value, isPlain(value[0]) ? { ...value[0] } : value[0]]));
      }
      break;
    default:
      break;
  }
}
