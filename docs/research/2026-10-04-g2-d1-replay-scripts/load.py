import json,math,os
# Repo-relative: this script lives in docs/research/2026-10-04-g2-d1-replay-scripts/; R1 is read-only input.
HERE=os.path.dirname(os.path.abspath(__file__))
EV=os.path.join(HERE,'..','evidence','g2-live-20261004-75a3ccb9','R1-clashpanel-viewerbridge-g2-result.json')
d=json.load(open(EV))
def mm(A,B): return [[sum(A[i][k]*B[k][j] for k in range(len(B))) for j in range(len(B[0]))] for i in range(len(A))]
def colmajor(a): return [[a[c*4+r] for c in range(4)] for r in range(4)]
def affine_from_corners(rec):
    cs=rec['evidence']['corners']
    P=[c['corner'] for c in cs]; C=[c['clip'] for c in cs]
    dx=P[4][0]-P[0][0]; dy=P[2][1]-P[0][1]; dz=P[1][2]-P[0][2]
    col=lambda i,j,dd:[(C[i][r]-C[j][r])/dd for r in range(4)]
    cx=col(4,0,dx); cy=col(2,0,dy); cz=col(1,0,dz)
    # translation: clip(P0) - A P0
    b=[C[0][r]-(cx[r]*P[0][0]+cy[r]*P[0][1]+cz[r]*P[0][2]) for r in range(4)]
    M=[[cx[r],cy[r],cz[r],b[r]] for r in range(4)]
    # residual over all corners
    res=0
    for p,c in zip(P,C):
        for r in range(4):
            v=M[r][0]*p[0]+M[r][1]*p[1]+M[r][2]*p[2]+M[r][3]
            res=max(res,abs(v-c[r]))
    return M,res,P,C
