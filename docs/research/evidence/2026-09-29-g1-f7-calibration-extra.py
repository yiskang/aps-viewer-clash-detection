import json, collections, math
import os
HERE=os.path.dirname(os.path.abspath(__file__))
d=json.load(open(HERE+'/2026-09-29-g1-svf2-f1-f8-mechanical-b811888-live-run-result.json'))
f=d['checks']['F7']['fields']; A=f['boundsAgreement']; nb=f['elementWorldBounds']; rb=f['fragmentBoundsUnion']; eb=f['conservativeEnvelopeUnion']; S=f['boundsScalePerDbId']; R=f['boundsResiduals']
def slack(k): return max(max(rb[k][i]-eb[k][i], eb[k][i+3]-rb[k][i+3]) for i in range(3))
def slackmin(k): return [ (rb[k][i]-eb[k][i]) + (eb[k][i+3]-rb[k][i+3]) for i in range(3)]
out={}
for cls in ('exceeds-envelope','agrees'):
    ks=[k for k in S if A[k]==cls]
    sl=[slack(k) for k in ks]
    # env-ref slack relative to T_pass (max over axes of total slack / T_pass)
    slr=[max(slackmin(k)[i]/S[k]['xyz'[i]]['T_pass'] for i in range(3)) for k in ks]
    nonzero=sum(1 for x in slr if x>1)
    # env loose vs ref (env strictly larger than ref by > T_pass on some axis) -> suggests rotation / out-of-range verts
    # excess relative to node extent
    exc_rel=[]
    for k in ks:
        m=0
        for i in range(3):
            ext=nb[k][i+3]-nb[k][i]
            e=max(R[k]['xyz'[i]]['eMin'],R[k]['xyz'[i]]['eMax'])
            if ext>0: m=max(m,e/ext)
        exc_rel.append(m)
    # node - ref total excess per axis vs env - ref total
    ratio=[]
    for k in ks:
        for i in range(3):
            envsl=(rb[k][i]-eb[k][i])+(eb[k][i+3]-rb[k][i+3]); nodesl=(rb[k][i]-nb[k][i])+(nb[k][i+3]-rb[k][i+3])
            ratio.append((envsl,nodesl))
    out[cls]={'n':len(ks),'dbIdsWithEnvLooserThanRefByOver1Tpass':nonzero,
      'maxAxisEnvMinusRefTotal_overTpass_quantiles':sorted(slr)[::max(1,len(slr)//10)][:12],
      'maxExcessOverNodeExtent_max':max(exc_rel),'maxExcessOverNodeExtent_median':sorted(exc_rel)[len(exc_rel)//2]}
    if cls=='exceeds-envelope':
        out[cls]['perDb']={k:{'envLooseAxes_overTpass':[round(slackmin(k)[i]/S[k]['xyz'[i]]['T_pass'],1) for i in range(3)],
            'nodeMinusRefTotalPerAxis':[ (rb[k][i]-nb[k][i])+(nb[k][i+3]-rb[k][i+3]) for i in range(3)],
            'envMinusRefTotalPerAxis':[ (rb[k][i]-eb[k][i])+(eb[k][i+3]-rb[k][i+3]) for i in range(3)],
            'refExtent':[rb[k][i+3]-rb[k][i] for i in range(3)],
            'maxExcessOverNodeExtent':exc_rel[j]} for j,k in enumerate(ks)}
# among agrees: how many have env looser than ref (rotated-like)?
ks=[k for k in S if A[k]=='agrees']
loose=[k for k in ks if max(slackmin(k)[i]/S[k]['xyz'[i]]['T_pass'] for i in range(3))>1]
out['agrees_envLooseCount']=len(loose)
ksE=[k for k in S if A[k]=='exceeds-envelope']
looseE=[k for k in ksE if max(slackmin(k)[i]/S[k]['xyz'[i]]['T_pass'] for i in range(3))>1]
out['exceeds_envLooseCount']=len(looseE)
# 2x2: env-loose vs class
out['contingency_envLoose_x_class']={'exceeds&loose':len(looseE),'exceeds&tight':len(ksE)-len(looseE),'agrees&loose':len(loose),'agrees&tight':len(ks)-len(loose)}
json.dump(out,open(HERE+'/2026-09-29-g1-f7-calibration-extra.json','w'),indent=1)
print(json.dumps({k:v for k,v in out.items() if k!='exceeds-envelope'},indent=1))
e=out['exceeds-envelope']; print({k:v for k,v in e.items() if k!='perDb'})
for k,v in e['perDb'].items(): print(k, v['envLooseAxes_overTpass'], [round(x,5) for x in v['nodeMinusRefTotalPerAxis']],[round(x,5) for x in v['envMinusRefTotalPerAxis']],[round(x,4) for x in v['refExtent']], round(v['maxExcessOverNodeExtent'],4))
