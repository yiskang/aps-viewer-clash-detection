#!/usr/bin/env python3
"""Offline F7 evidence characterization. Reads ONLY the retained live-run JSON. Writes to scratchpad."""
import json, math, struct, collections, os, statistics

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
SRC = REPO + '/docs/research/evidence/2026-09-29-g1-svf2-f1-f8-mechanical-b811888-live-run-result.json'
OUT = os.path.dirname(os.path.abspath(__file__))

d = json.load(open(SRC))
f = d['checks']['F7']['fields']
C = f['boundsToleranceConstants']
u, PF, GR = C['u'], C['passFactor'], C['grossRelative']
AX = ['x', 'y', 'z']
agree = f['boundsAgreement']; ewb = f['elementWorldBounds']; fbu = f['fragmentBoundsUnion']
env = f['conservativeEnvelopeUnion']; sk = f['skippedFragments']
scale = f['boundsScalePerDbId']; res = f['boundsResiduals']
G = f['modelGlobalOffset']

def ulp32(x):
    x = abs(float(x))
    if x == 0: return 2.0 ** -149
    b = struct.unpack('<I', struct.pack('<f', x))[0]
    f32 = struct.unpack('<f', struct.pack('<I', b))[0]
    # use float32 rounding of x, then spacing to next float32
    nb = struct.unpack('<I', struct.pack('<f', f32))[0] + 1
    return struct.unpack('<f', struct.pack('<I', nb))[0] - f32

def is_f32(x):
    return struct.unpack('<f', struct.pack('<f', x))[0] == x

def q(vals):
    v = sorted(vals); n = len(v)
    if n == 0: return None
    def p(pp):
        k = (n - 1) * pp; lo = math.floor(k); hi = math.ceil(k)
        return v[lo] + (v[hi] - v[lo]) * (k - lo)
    return {'n': n, 'min': v[0], 'median': p(0.5), 'p90': p(0.9), 'p99': p(0.99), 'max': v[-1]}

def mannwhitney(a, b):
    # two-sided, normal approx with tie correction
    allv = sorted([(x, 0) for x in a] + [(x, 1) for x in b])
    ranks = [0.0] * len(allv); i = 0; tie = 0.0
    while i < len(allv):
        j = i
        while j + 1 < len(allv) and allv[j + 1][0] == allv[i][0]: j += 1
        r = (i + j) / 2 + 1
        for k in range(i, j + 1): ranks[k] = r
        t = j - i + 1; tie += t ** 3 - t; i = j + 1
    n1, n2 = len(a), len(b); N = n1 + n2
    R1 = sum(r for r, (_, g) in zip(ranks, allv) if g == 0)
    U1 = R1 - n1 * (n1 + 1) / 2
    mu = n1 * n2 / 2
    sig = math.sqrt(n1 * n2 / 12 * ((N + 1) - tie / (N * (N - 1))))
    z = (U1 - mu) / sig if sig > 0 else 0.0
    pval = math.erfc(abs(z) / math.sqrt(2))
    return {'U1': U1, 'z': z, 'p_two_sided_normal_approx': pval, 'CLES_P(a>b)': U1 / (n1 * n2)}

# ---------- 1. counts ----------
cnt = collections.Counter(agree.values())
counts = {'byClass': dict(cnt), 'sum': sum(cnt.values()), 'censusCount': f['censusCount'],
          'censusedDbIdsLen': len(f['censusedDbIds']),
          'scaleEntries': len(scale), 'residualEntries': len(res),
          'scaleKeysEqualNonNRG': set(scale) == {k for k, v in agree.items() if v != 'no-reference-geometry'},
          'residualKeysEqualScaleKeys': set(res) == set(scale),
          'verdict': d['checks']['F7']['verdict'], 'reason': d['checks']['F7']['reason']}

# ---------- per-dbId records for the 899 ----------
def rec(k):
    r = {'dbId': int(k), 'class': agree[k], 'axes': {}}
    nb, rb, eb = ewb[k], fbu[k], env[k]
    r['elementWorldBounds'] = nb; r['fragmentBoundsUnion'] = rb; r['conservativeEnvelopeUnion'] = eb
    r['skippedFragments'] = sk[k]
    r['fragmentCountLowerBound'] = 1 + len(sk[k])  # has >=1 tight-ref fragment plus skipped ones
    for i, a in enumerate(AX):
        s = scale[k][a]; rr = res[k][a]
        Tp, Tg, Sa = s['T_pass'], s['T_gross'], s['S_a']
        coordMag = max(abs(nb[i]), abs(nb[i + 3]))
        ext_node = nb[i + 3] - nb[i]; ext_ref = rb[i + 3] - rb[i]; ext_env = eb[i + 3] - eb[i]
        comp = {}
        for name in ('rMin', 'rMax', 'eMin', 'eMax'):
            v = rr[name]
            # coordinate the component refers to (node-side value)
            c = nb[i] if name in ('rMin', 'eMin') else nb[i + 3]
            comp[name] = {'value': v, 'over_T_pass': v / Tp, 'over_T_gross': v / Tg,
                          'in_u_Sa': v / (u * Sa), 'nodeCoord': c, 'ulp32_nodeCoord': ulp32(c),
                          'over_ulp32_nodeCoord': v / ulp32(c), 'violatesTpass': v > Tp,
                          'violatesTgross': v > Tg}
        r['axes'][a] = {'S_a': Sa, 'T_pass': Tp, 'T_gross': Tg, 'coordMagnitude': coordMag,
                        'ulp32_coordMagnitude': ulp32(coordMag),
                        'extent_node': ext_node, 'extent_ref': ext_ref, 'extent_env': ext_env,
                        'nodeMinIsFloat32': is_f32(nb[i]), 'nodeMaxIsFloat32': is_f32(nb[i + 3]),
                        'components': comp}
    return r

recs = {k: rec(k) for k in scale}
exc = [recs[k] for k in sorted(recs, key=int) if agree[k] == 'exceeds-envelope']
agr = [recs[k] for k in sorted(recs, key=int) if agree[k] == 'agrees']

# ---------- 2. exceedances ----------
exc_out = []
for r in exc:
    viol = []
    for a in AX:
        A = r['axes'][a]
        for name, c in A['components'].items():
            if c['violatesTpass']:
                band = 'beyond-T_gross' if c['violatesTgross'] else '(T_pass,T_gross]'
                viol.append({'axis': a, 'component': name, 'residual': c['value'], 'S_a': A['S_a'],
                             'T_pass': A['T_pass'], 'T_gross': A['T_gross'],
                             'residual_over_T_pass': c['over_T_pass'], 'residual_over_T_gross': c['over_T_gross'],
                             'residual_in_u_Sa': c['in_u_Sa'], 'band': band,
                             'nodeCoord': c['nodeCoord'], 'ulp32_nodeCoord': c['ulp32_nodeCoord'],
                             'residual_over_ulp32_nodeCoord': c['over_ulp32_nodeCoord']})
    maxratio = max(v['residual_over_T_pass'] for v in viol)
    exc_out.append({'dbId': r['dbId'], 'violations': viol, 'maxResidualOverTpass': maxratio,
                    'containment_max_over_T_pass': max(r['axes'][a]['components'][n]['over_T_pass'] for a in AX for n in ('rMin', 'rMax')),
                    'elementWorldBounds': r['elementWorldBounds'], 'fragmentBoundsUnion': r['fragmentBoundsUnion'],
                    'conservativeEnvelopeUnion': r['conservativeEnvelopeUnion'],
                    'extent_node': [r['axes'][a]['extent_node'] for a in AX],
                    'coordMagnitude': [r['axes'][a]['coordMagnitude'] for a in AX],
                    'S_a': [r['axes'][a]['S_a'] for a in AX],
                    'skippedFragments': r['skippedFragments'], 'fragmentCountLowerBound': r['fragmentCountLowerBound'],
                    'nodeBoundsAllFloat32Representable': all(r['axes'][a]['nodeMinIsFloat32'] and r['axes'][a]['nodeMaxIsFloat32'] for a in AX)})
json.dump({'source': SRC, 'constants': C, 'count': len(exc_out), 'exceedances': exc_out},
          open(OUT + '/2026-09-29-g1-f7-calibration-exceedances.json', 'w'), indent=1)

# ---------- 3. comparison ----------
def maxpos_ratio(r, names, a=None):
    axes = [a] if a else AX
    return max(r['axes'][x]['components'][n]['over_T_pass'] for x in axes for n in names)

comparison = {}
metrics = {
    'max_all4_over_T_pass': lambda r, a: maxpos_ratio(r, ('rMin', 'rMax', 'eMin', 'eMax'), a),
    'max_env_over_T_pass': lambda r, a: maxpos_ratio(r, ('eMin', 'eMax'), a),
    'max_containment_over_T_pass': lambda r, a: maxpos_ratio(r, ('rMin', 'rMax'), a),
    'S_a': lambda r, a: r['axes'][a]['S_a'],
    'coordMagnitude': lambda r, a: r['axes'][a]['coordMagnitude'],
    'extent_node': lambda r, a: r['axes'][a]['extent_node'],
    'max_env_over_ulp32_nodeCoord': lambda r, a: max(r['axes'][a]['components'][n]['over_ulp32_nodeCoord'] for n in ('eMin', 'eMax')),
    'S_a_over_coordMagnitude': lambda r, a: r['axes'][a]['S_a'] / r['axes'][a]['coordMagnitude'] if r['axes'][a]['coordMagnitude'] else None,
}
for m, fn in metrics.items():
    comparison[m] = {}
    for a in AX:
        ev = [fn(r, a) for r in exc]; av = [fn(r, a) for r in agr]
        ev = [x for x in ev if x is not None]; av = [x for x in av if x is not None]
        comparison[m][a] = {'exceeds': q(ev), 'agrees': q(av), 'mannWhitney_exc_vs_agr': mannwhitney(ev, av)}
# per-dbId (all-axis) metrics
for m, fn in {'fragmentCountLowerBound': lambda r: r['fragmentCountLowerBound'],
              'numSkipped': lambda r: len(r['skippedFragments']),
              'maxExtent': lambda r: max(r['axes'][a]['extent_node'] for a in AX),
              'minExtent': lambda r: min(r['axes'][a]['extent_node'] for a in AX)}.items():
    ev = [fn(r) for r in exc]; av = [fn(r) for r in agr]
    comparison[m] = {'exceeds': q(ev), 'agrees': q(av), 'mannWhitney_exc_vs_agr': mannwhitney(ev, av)}

# How close are agrees to T_pass (max of all 12 components)
agr_max = [maxpos_ratio(r, ('rMin', 'rMax', 'eMin', 'eMax')) for r in agr]
exc_max = [maxpos_ratio(r, ('rMin', 'rMax', 'eMin', 'eMax')) for r in exc]
# Containment side in all 899
cont_all = [maxpos_ratio(r, ('rMin', 'rMax')) for r in recs.values()]
env_all_exc = [maxpos_ratio(r, ('eMin', 'eMax')) for r in exc]

# Residual sign/zero structure
def comp_stats(group):
    out = {}
    for n in ('rMin', 'rMax', 'eMin', 'eMax'):
        vals = [r['axes'][a]['components'][n]['value'] for r in group for a in AX]
        out[n] = {'n': len(vals), 'zero': sum(v == 0 for v in vals), 'positive': sum(v > 0 for v in vals),
                  'negative': sum(v < 0 for v in vals), 'maxPositive': max([v for v in vals if v > 0], default=None)}
    return out

# violating axes / component histogram
viol_hist = collections.Counter((v['axis'], v['component']) for e in exc_out for v in e['violations'])
viol_per_db = collections.Counter(len(e['violations']) for e in exc_out)
band_hist = collections.Counter(v['band'] for e in exc_out for v in e['violations'])

# clustering
exc_ids = [e['dbId'] for e in exc_out]
gaps = [b - a for a, b in zip(exc_ids, exc_ids[1:])]
# identical boxes / identical extents
ext_key = collections.Counter(tuple(round(x, 9) for x in e['extent_node']) for e in exc_out)
agr_ext = collections.Counter(tuple(round(r['axes'][a]['extent_node'], 9) for a in AX) for r in agr)
ext_share = {str(k): {'exceedsCount': v, 'agreesCountWithSameExtent': agr_ext.get(k, 0)} for k, v in ext_key.items()}
# residual pattern keys (violation component + residual value)
resid_key = collections.Counter(tuple((v['axis'], v['component'], v['residual']) for v in e['violations']) for e in exc_out)

# ---------- descriptive sweep ----------
sweep = {}
for pf in (16, 32, 64, 128, 256, 1024):
    def ok(r, pf=pf):
        for a in AX:
            A = r['axes'][a]; T = pf * u * A['S_a']
            for n in ('rMin', 'rMax', 'eMin', 'eMax'):
                if A['components'][n]['value'] > T: return False
        return True
    sweep[f'passFactor={pf}'] = {'exceedances_passing': sum(ok(r) for r in exc), 'of': len(exc),
                                 'agrees_still_passing': sum(ok(r) for r in agr), 'agreesOf': len(agr)}
ulp_rules = {}
for kf in (1, 2, 4, 8, 16):
    def ok2(r, kf=kf, which='coord'):
        for a in AX:
            A = r['axes'][a]
            for n, c in A['components'].items():
                if c['value'] > max(A['T_pass'], kf * c['ulp32_nodeCoord']): return False
        return True
    def ok3(r, kf=kf):
        for a in AX:
            A = r['axes'][a]
            for n, c in A['components'].items():
                if c['value'] > max(A['T_pass'], kf * ulp32(A['S_a'])): return False
        return True
    ulp_rules[f'max(T_pass, {kf}*ulp32(|nodeCoord|))'] = {'exceedances_passing': sum(ok2(r) for r in exc), 'of': len(exc)}
    ulp_rules[f'max(T_pass, {kf}*ulp32(S_a))'] = {'exceedances_passing': sum(ok3(r) for r in exc), 'of': len(exc)}

# ---------- 5. no-reference-geometry ----------
nrg = [k for k, v in agree.items() if v == 'no-reference-geometry']
nrg_reasons = collections.Counter(json.dumps([x['reason'] for x in sk[k]]) for k in nrg)
nrg_nskip = collections.Counter(len(sk[k]) for k in nrg)
nrg_nodeNull = sum(ewb[k] is None for k in nrg)
nrg_fbuNull = sum(fbu[k] is None for k in nrg)
nrg_envNull = sum(env[k] is None for k in nrg)
nrg_inScale = sum(k in scale for k in nrg)
# for NRG, compare nodeBox with envelope (descriptive; not scored by harness)
def nrg_env_cmp(k):
    nb, eb = ewb[k], env[k]
    if nb is None or eb is None: return None
    return [eb[i] - nb[i] for i in range(3)] + [nb[i + 3] - eb[i + 3] for i in range(3)]
nrg_cmp = {k: nrg_env_cmp(k) for k in nrg}
nrg_env_equal = sum(1 for v in nrg_cmp.values() if v is not None and all(x == 0 for x in v))
nrg_env_maxpos = max((max(v) for v in nrg_cmp.values() if v is not None), default=None)
nrg_env_exceeding = sum(1 for v in nrg_cmp.values() if v is not None and max(v) > 0)
nrg_extent = [max(ewb[k][i + 3] - ewb[k][i] for i in range(3)) for k in nrg if ewb[k]]
nrg_minextent = [min(ewb[k][i + 3] - ewb[k][i] for i in range(3)) for k in nrg if ewb[k]]
nrg_degenerate = sum(1 for k in nrg if ewb[k] and min(ewb[k][i + 3] - ewb[k][i] for i in range(3)) == 0)
nrg_ids = sorted(int(k) for k in nrg)
skipped_non_nrg = [k for k in scale if sk[k]]
skipped_non_nrg_class = collections.Counter(agree[k] for k in skipped_non_nrg)
allskippedfragids = [x['fragmentId'] for k in sk for x in sk[k]]

# dbIds whose fragment count is exactly known
known_two = [k for k in scale if len(sk[k]) == 1]  # 1 skipped + >=1 ref => >=2; max per dbId is 2 => exactly 2
exc_in_known_two = sum(1 for e in exc_out if str(e['dbId']) in known_two)

summary = {
    'counts': counts,
    'residualSignStructure': {'exceeds': comp_stats(exc), 'agrees': comp_stats(agr)},
    'violationHistogram_axis_component': {f'{a}.{n}': v for (a, n), v in sorted(viol_hist.items())},
    'violationsPerDbId': dict(viol_per_db), 'violationBands': dict(band_hist),
    'exceeds_maxAll12_over_T_pass': q(exc_max), 'agrees_maxAll12_over_T_pass': q(agr_max),
    'all899_containment_max_over_T_pass': q(cont_all),
    'all899_containment_positive_count': sum(1 for x in cont_all if x > 0),
    'comparison': comparison,
    'clustering': {'exceedDbIds': exc_ids, 'gaps': gaps, 'gapHistogram': dict(collections.Counter(gaps)),
                   'sharedNodeExtentGroups': ext_share,
                   'identicalViolationPatterns': {str(k): v for k, v in resid_key.items() if v > 1}},
    'descriptiveSweep_NOT_PRESCRIPTIVE': {'passFactor': sweep, 'ulpBased': ulp_rules},
    'noReferenceGeometry': {'count': len(nrg), 'skipReasonPatterns': dict(nrg_reasons), 'numSkippedHistogram': dict(nrg_nskip),
                            'elementWorldBoundsNull': nrg_nodeNull, 'fragmentBoundsUnionNull': nrg_fbuNull,
                            'conservativeEnvelopeUnionNull': nrg_envNull, 'inBoundsScalePerDbId': nrg_inScale,
                            'nodeBoxEqualsEnvelopeExactly': nrg_env_equal, 'nodeBoxExceedsEnvelopeAnyComponent': nrg_env_exceeding,
                            'nodeBoxMinusEnvelopeMaxPositive': nrg_env_maxpos,
                            'nodeExtentMaxAxis': q(nrg_extent), 'nodeExtentMinAxis': q(nrg_minextent),
                            'nodeBoxDegenerateOnSomeAxis': nrg_degenerate,
                            'dbIdRange': [nrg_ids[0], nrg_ids[-1]]},
    'nonNRG_withSkippedFragment': {'count': len(skipped_non_nrg), 'byClass': dict(skipped_non_nrg_class)},
    'totalSkippedFragmentEntries': len(allskippedfragids), 'distinctSkippedFragmentIds': len(set(allskippedfragids)),
    'exceedances_withExactlyTwoFragmentsKnown': exc_in_known_two,
    'modelGlobalOffset': G, 'placementIsIdentity': f['placementIsIdentity'], 'unitScale': f['unitScale'], 'unitString': f['unitString'],
    'positionsArrayTypes': dict(collections.Counter(f['positionsArrayType'].values())),
    'worldMatrixElementTypes': dict(collections.Counter(f['worldMatrixElementType'].values())),
}
json.dump(summary, open(OUT + '/2026-09-29-g1-f7-calibration-summary.json', 'w'), indent=1, default=str)
json.dump({'nrg': {k: {'skipped': sk[k], 'node': ewb[k], 'env': env[k], 'nodeMinusEnv': nrg_cmp[k]} for k in sorted(nrg, key=int)}},
          open(OUT + '/2026-09-29-g1-f7-calibration-no-reference-geometry.json', 'w'), indent=1)
print(json.dumps({k: summary[k] for k in ('counts', 'violationHistogram_axis_component', 'violationsPerDbId', 'violationBands',
                                          'exceeds_maxAll12_over_T_pass', 'agrees_maxAll12_over_T_pass',
                                          'all899_containment_max_over_T_pass', 'all899_containment_positive_count',
                                          'clustering', 'descriptiveSweep_NOT_PRESCRIPTIVE', 'noReferenceGeometry',
                                          'nonNRG_withSkippedFragment', 'totalSkippedFragmentEntries',
                                          'distinctSkippedFragmentIds', 'exceedances_withExactlyTwoFragmentsKnown',
                                          'residualSignStructure', 'positionsArrayTypes', 'worldMatrixElementTypes')}, indent=1, default=str))
