import sys,os; sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from load import *
EPS=1e-4
def mat4mulvec4(m,v):  # m column-major flat 16 (JS order)
    return [m[0]*v[0]+m[4]*v[1]+m[8]*v[2]+m[12]*v[3],
            m[1]*v[0]+m[5]*v[1]+m[9]*v[2]+m[13]*v[3],
            m[2]*v[0]+m[6]*v[1]+m[10]*v[2]+m[14]*v[3],
            m[3]*v[0]+m[7]*v[1]+m[11]*v[2]+m[15]*v[3]]
def clip_from_K(K,p): return mat4mulvec4(K[16:],mat4mulvec4(K[:16],[p[0],p[1],p[2],1]))
def excess(c): x,y,z,w=c; return max(abs(x),abs(y),z,-z)/w-1
def inside(c,k=1+EPS):
    x,y,z,w=c; return w>0 and abs(x)<=w*k and abs(y)<=w*k and -w*k<=z<=w*k
out=[]
def P(*a): 
    s=' '.join(str(x) for x in a); print(s); out.append(s)
# ---- C6 (full camera preserved) ----
rec=d['checks']['C6']; K=rec['evidence']['cameraK']
P('== C6: recompute clip from preserved cameraK x preserved world corners ==')
md=0; worst=-1e9; allin=True
for c in rec['evidence']['corners']:
    cl=clip_from_K(K,c['corner']); md=max(md,max(abs(a-b) for a,b in zip(cl,c['clip'])))
    e=excess(cl); worst=max(worst,e); allin&=inside(cl)
    assert abs(e-c['excess'])<1e-12 and inside(cl)==c['inside']
P(' max|clip_recomputed - clip_preserved| =',md,' worstExcess recomputed =',worst,' preserved =',rec['fields']['worstExcess'],' diff=',worst-rec['fields']['worstExcess'],' pass=',allin)
P(' bitwise-equal worstExcess:',worst==rec['fields']['worstExcess'])
# orthonormality of V rotation
V=colmajor(K[:16]); 
rows=[V[i][:3] for i in range(3)]
dot=lambda a,b:sum(x*y for x,y in zip(a,b))
P(' V rows norms',[round(math.sqrt(dot(r,r)),9) for r in rows],' dots',round(dot(rows[0],rows[1]),9),round(dot(rows[0],rows[2]),9),round(dot(rows[1],rows[2]),9))
Pm=K[16:]; P(' projection is orthographic (P[3],P[7],P[11],P[15])=',Pm[3],Pm[7],Pm[11],Pm[15])
P(' ortho half-width/half-height (1/P00,1/P11) =',1/Pm[0],1/Pm[5],' aspect',Pm[5]/Pm[0])
P(' eye distance from origin along view axis (|t|)=',math.sqrt(sum(x*x for x in K[12:15])),' translation',K[12:15])
# ---- N2, C8 : only clip preserved ----
for name,rec in [('N2',d['controls']['N2']),('C8',d['checks']['C8'])]:
    P('== %s: recompute excess/inside from preserved clip (camera matrices NOT preserved) =='%name)
    worst=-1e9; allin=True
    for c in rec['evidence']['corners']:
        e=excess(c['clip']); worst=max(worst,e); allin&=inside(c['clip'])
        assert abs(e-c['excess'])<1e-12 and inside(c['clip'])==c['inside']
    wp=rec['fields']['worstExcess']
    P(' worstExcess recomputed=',worst,' preserved=',wp,' bitwise-equal=',worst==wp,' pass=',allin,' w all =1?',all(c['clip'][3]==1 for c in rec['evidence']['corners']))
    M,res,Pw,C=affine_from_corners(rec); P(' single-ortho-affine-camera consistency: max resid over 8 corners x 4 rows =',res)
# C8 target bounds vs c4Table
cb=[c for c in d['c4Table'] if c['dbId']==104][0]
cs=d['checks']['C8']['evidence']['corners']
xs=sorted(set(c['corner'][0] for c in cs)); ys=sorted(set(c['corner'][1] for c in cs)); zs=sorted(set(c['corner'][2] for c in cs))
box=[xs[0],ys[0],zs[0],xs[-1],ys[-1],zs[-1]]
P('== C8 target bounds ==')
P(' C8 evidence corner-box =',box); P(' c4Table[A,104].candidateBox == referenceBox ==',cb['candidateBox']==cb['referenceBox'],' and == C8 box:',cb['candidateBox']==box,' fragmentCount',cb['fragmentCount'])
# C8 per plane distances (ndc units, ortho w=1)
def planes(corners):
    r={'left(x>=-1)':min(c['clip'][0]/c['clip'][3]+1 for c in corners),'right(x<=1)':min(1-c['clip'][0]/c['clip'][3] for c in corners),
       'bottom(y>=-1)':min(c['clip'][1]/c['clip'][3]+1 for c in corners),'top(y<=1)':min(1-c['clip'][1]/c['clip'][3] for c in corners),
       'near(z>=-1)':min(c['clip'][2]/c['clip'][3]+1 for c in corners),'far(z<=1)':min(1-c['clip'][2]/c['clip'][3] for c in corners)}
    return {k:round(v,9) for k,v in r.items()}
for name,rec in [('C6',d['checks']['C6']),('N2',d['controls']['N2']),('C8',d['checks']['C8'])]:
    P('== six-plane min signed distance (NDC units; negative=outside) over 8 corners:',name); P(' ',planes(rec['evidence']['corners']))
    mx=max(max(abs(c['clip'][0]),abs(c['clip'][1]),abs(c['clip'][2])) for c in rec['evidence']['corners']); P(' max|ndc| =',mx)
# ---- camera reconstruction ----
K6=d['checks']['C6']['evidence']['cameraK']
M6=mm(colmajor(K6[16:]),colmajor(K6[:16]))
M2=affine_from_corners(d['controls']['N2'])[0]; M8=affine_from_corners(d['checks']['C8'])[0]
cams={'C6':M6,'N2':M2,'C8':M8}
def ndcp(M,p): return [sum(M[r][k]*p[k] for k in range(3))+M[r][3] for r in range(3)]
def ext(M,box):
    pts=[ndcp(M,[x,y,z]) for x in (box[0],box[3]) for y in (box[1],box[4]) for z in (box[2],box[5])]
    return [(min(q[i] for q in pts),max(q[i] for q in pts)) for i in range(3)]
U=[min(c['corner'][0] for c in d['checks']['C6']['evidence']['corners']),min(c['corner'][1] for c in d['checks']['C6']['evidence']['corners']),min(c['corner'][2] for c in d['checks']['C6']['evidence']['corners']),
   max(c['corner'][0] for c in d['checks']['C6']['evidence']['corners']),max(c['corner'][1] for c in d['checks']['C6']['evidence']['corners']),max(c['corner'][2] for c in d['checks']['C6']['evidence']['corners'])]
# U identical between C6 and N2 evidence
P('== union box U: C6 evidence corners == N2 evidence corners ?', [c['corner'] for c in d['checks']['C6']['evidence']['corners']]==[c['corner'] for c in d['controls']['N2']['evidence']['corners']],' U=',U)
b104=cb['candidateBox']; b105=[c for c in d['c4Table'] if c['dbId']==105][0]['candidateBox']
P('== Per-sample, per-known-target framing signature: center NDC (cx,cy), half-extent h=max(hx,hy), hx,hy ==')
rows=[]
for sn,M in cams.items():
    for tn,t in (('U(C6 target)',U),('A:104(C8 target)',b104),('A:105',b105)):
        e=ext(M,t); cx=(e[0][0]+e[0][1])/2; cy=(e[1][0]+e[1][1])/2; hx=(e[0][1]-e[0][0])/2; hy=(e[1][1]-e[1][0])/2
        P(' sample=%-4s target=%-17s center=(%+.6f,%+.6f) hx=%.6f hy=%.6f h=%.6f'%(sn,tn,cx,cy,hx,hy,max(hx,hy)))
# visible extents
for sn,M in cams.items():
    lx=math.hypot(M[0][0],M[0][1]); ly=math.sqrt(sum(v*v for v in M[1][:3]))
    P(' sample=%s visible full width=%.4f height=%.4f units (ortho), aspect=%.6f'%(sn,2/lx,2/ly,ly and (2/lx)/(2/ly)))
# view-center line
def cross(a,b): return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]
def centerline(M):
    a,b,c=M[0][0],M[0][1],-M[0][3]; e,f,g=M[1][0],M[1][1],-M[1][3]
    det=a*f-b*e; x=(c*f-b*g)/det; y=(a*g-c*e)/det
    return (x,y)
for sn,M in cams.items(): P(' sample=%s view-centre line passes world (x,y)=(%.6f,%.6f) at z=0; direction (0.57735,-0.57735,0.57735)'%((sn,)+centerline(M)))
Uc=[(U[i]+U[i+3])/2 for i in range(3)]; P(' U centre =',Uc,' ndc of U centre under N2 =',ndcp(M2,Uc),' under C6 =',ndcp(M6,Uc))
P(' N2 sample vs fit(U) 0.9 rule: U half-extents (hx,hy)=',[ (e[1]-e[0])/2 for e in ext(M2,U)[:2]])
# fit104 prediction under the N2-calibrated rule (center + h=0.9 binding)
def fit_scale_mult(M,box,m=0.9):
    e=ext(M,box); h=max((e[0][1]-e[0][0])/2,(e[1][1]-e[1][0])/2); return m/h
P(' predicted scale multiplier (rel. N2 camera) for a 0.9-margin fit of A:104 =',fit_scale_mult(M2,b104),' observed C8/N2 scale multiplier =',M8[0][0]/M2[0][0],' observed C8/C6 =',M8[0][0]/M6[0][0],' predicted fit104/C6 =',fit_scale_mult(M2,b104)*M2[0][0]/M6[0][0])
P(' log-scale position of C8 between N2 and predicted fit(104) =',math.log(M8[0][0]/M2[0][0])/math.log(fit_scale_mult(M2,b104)*1.0))
# C8 camera: corner coincidence
cor=[U[0],U[4],U[5]]
P('== C8 sample: NDC of union corner (xmin,ymax,zmax) =',ndcp(M8,cor),' (a 0.9-margin tight fit of an element occupying that corner predicts x~0,y~0.9)')
ny=ndcp(M8,cor)[1]
for lbl,a in (('square footprint 0.5833 (B-family b1 extent)',0.5833282470703125),('square footprint 1.0 (A-family a1 extent)',1.0)):
    c=(2*ny+M8[1][0]*a-M8[1][1]*a)/M8[1][2]
    P(' %s -> implied height %.4f, implied centre z=%.4f; implied centre ndc=%s'%(lbl,c,cor[2]-c/2,[round(v,7) for v in ndcp(M8,[cor[0]+a/2,cor[1]-a/2,cor[2]-c/2])]))
P(' implied footprint squareness (a-b) from ndc_x(centre)=0:',-ndcp(M8,cor)[0]/(M8[0][0]/2))
# U-corner worst excess under C8 camera (proxy for a correctly observed N2)
e=ext(M8,U); P('== proxy: U under C8-sample camera ext x',e[0],' y',e[1],' -> worstExcess(U|C8cam) =',max(abs(e[0][0]),abs(e[0][1]),abs(e[1][0]),abs(e[1][1]),abs(e[2][0]),abs(e[2][1]))-1)
P(' U under N2 cam worstExcess', max(max(abs(a),abs(b)) for a,b in ext(M2,U))-1,' U under C6 cam', max(max(abs(a),abs(b)) for a,b in ext(M6,U))-1)
# timings
r=d['spyLedger']['records']; t={x['seq']:x['atMs'] for x in r}
P('== timing (atMs, ms) ==')
ev=[(292,'C6 fit(U) call'),(293,'add cameraTransitionCompleted (L1)'),(295,'N2 fit([111],B) call'),(296,'add (L2)'),(297,'remove'),(298,'remove'),(299,'C8 fit([104],A) call'),(300,'add (L3)'),(301,'remove'),(302,'C8 fit([105],A) call'),(303,'add (L4)'),(304,'remove')]
for s,l in ev: P(' seq %d %-40s %.1f'%(s,l,t[s]))
P(' C6 call -> N2 call %.1f ; N2 call -> C8 call %.1f ; C8#1 call -> C8#2 call %.1f'%(t[295]-t[292],t[299]-t[295],t[302]-t[299]))
P(' C6 call -> E1 %.1f ; E1 -> E2 %.1f ; E2 -> E3 %.1f ; N2 call->E1 %.1f ; C8#1 add delay after call %.1f ; add L3 -> E2 %.1f'%(t[297]-t[292],t[301]-t[297],t[304]-t[301],t[297]-t[295],t[300]-t[299],t[301]-t[300]))
open(sys.argv[1] if len(sys.argv)>1 else os.path.join(HERE,'recompute_out.txt'),'w').write('\n'.join(out))
