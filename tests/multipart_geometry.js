'use strict';
/* MultiPolygon / holes geometry core shared by both pages.
   Needs polygon-clipping (the same 0.15.7 the pages load):  npm i polygon-clipping@0.15.7
   Run: node tests/multipart_geometry.js */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const G=require('../street-geometry.js'),clip=require('polygon-clipping');
const R=a=>a.map(([x,y])=>({x,y})),near=(a,b,tol,msg)=>assert.ok(Math.abs(a-b)<=tol,`${msg}: ${a} vs ${b}`);
const rect=(x0,y0,x1,y1)=>R([[x0,y0],[x1,y0],[x1,y1],[x0,y1]]),cw=r=>r.slice().reverse();

// 1 · ringStrips is the main planner's setbackStrips(), extracted from index.html and run unchanged
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const grab=re=>{const m=re.exec(html);assert.ok(m,'source not found: '+re);return m[0]};
const src=[grab(/const sub=\(a,b\)=>[^\r\n]*/),grab(/const dot=\(a,b\)=>[^\r\n]*/),grab(/function polyArea\(P\)\{[^\r\n]*/),grab(/function setbackStrips\(m\)\{[\s\S]*?return out\.filter\(q=>q\.length>=3&&Math\.abs\(polyArea\(q\)\)>1e-6\)\}/)].join('\n');
const ctx={};vm.createContext(ctx);vm.runInContext(src+'\nthis.setbackStrips=setbackStrips;this.polyArea=polyArea;',ctx);
const mainStrips=(P,sbs)=>{const sign=ctx.polyArea(P)>=0?1:-1,n=P.length,edges=P.map((p,i)=>{const b=P[(i+1)%n],d={x:b.x-p.x,y:b.y-p.y},len=Math.hypot(d.x,d.y)||1;return{a:p,b,len,nOut:{x:-d.y/len*-sign,y:d.x/len*-sign},sb:sbs[i]}});
  return ctx.setbackStrips({P,edges,sign})};
const shapes=[[rect(0,0,30,40),[5,0,2,3]],[R([[0,0],[40,0],[40,15],[15,15],[15,40],[0,40]]),[2,2,2,2,2,2]],[cw(R([[0,0],[40,0],[40,15],[15,15],[15,40],[0,40]])),[1,4,0,2,3,1]],
  [R([[0,0],[50,5],[45,40],[20,30],[5,45]]),[3,0,4,2,1]],[R([[0,0],[60,0],[60,60],[40,60],[40,2],[20,2],[20,60],[0,60]]),[4,4,4,4,4,4,4,4]]];
shapes.forEach(([P,sbs],k)=>{const a=mainStrips(P,sbs),b=G.ringStrips(P,sbs,Math.sign(G.ringArea(P))||1);
  assert.deepEqual(JSON.parse(JSON.stringify(b)),JSON.parse(JSON.stringify(a)),`shape ${k+1}: strips identical to the main planner`)});

// 2 · areas: simple, concave, hole, multipart, island in a hole — exact values
const sb=v=>(k,r,n)=>new Array(n).fill(v);
let r=G.buildableClip([{outer:rect(0,0,30,40),holes:[]}],(k,ring,n)=>[5,0,0,3],clip);near(r.original,1200,1e-6,'rect');near(r.buildable,27*35,1e-6,'rect buildable');
r=G.buildableClip([{outer:R([[0,0],[40,0],[40,15],[15,15],[15,40],[0,40]]),holes:[]}],sb(2),clip);near(r.original,975,1e-6,'L');near(r.buildable,36*11+11*25,1e-6,'L buildable');
assert.ok(Math.abs(r.buildable-G.insetPolygon(R([[0,0],[40,0],[40,15],[15,15],[15,40],[0,40]]),[2,2,2,2,2,2]).area)<1e-6,'clip ≡ validated inset on a simple polygon');
r=G.buildableClip([{outer:rect(0,0,40,40),holes:[cw(rect(15,15,25,25))]}],sb(2),clip);near(r.original,1600-100,1e-6,'hole');near(r.buildable,36*36-14*14,1e-6,'hole buildable: setback around the hole too');
r=G.buildableClip([{outer:rect(0,0,40,40),holes:[cw(rect(10,10,20,20))]},{outer:rect(50,0,70,20),holes:[]}],sb(1),clip);
near(r.original,1600-100+400,1e-6,'multipart');near(r.buildable,(38*38-12*12)+18*18,1e-6,'multipart buildable');assert.equal(r.parts.length,2);
const holeFree=G.buildableClip([{outer:rect(0,0,40,40),holes:[]}],sb(0),clip);assert.equal(holeFree.buildable,1600,'no setbacks: buildable = area, no clipping needed');
r=G.buildableClip([{outer:rect(0,0,40,40),holes:[cw(rect(5,5,35,35))]},{outer:rect(15,15,25,25),holes:[]}],sb(0),clip);near(r.original,1600-900+100,1e-6,'island inside a hole');

// 3 · unsupported geometry is refused with a reason, never estimated
const bad=[[{outer:rect(0,0,30,30),holes:[cw(rect(20,10,40,20))]}],'يخرج'],overlap=[[{outer:rect(0,0,30,30),holes:[]},{outer:rect(20,20,50,50),holes:[]}],'متداخلان'],
  bow=[[{outer:R([[0,0],[30,30],[30,0],[0,30]]),holes:[]}],'يتقاطع'],holes2=[[{outer:rect(0,0,40,40),holes:[cw(rect(5,5,20,20)),cw(rect(10,10,30,30))]}],'متداخلان'];
for(const [parts,word] of [bad,overlap,bow,holes2]){r=G.buildableClip(parts,sb(1),clip);assert.equal(r.valid,false);assert.equal(r.buildable,null);assert.ok(r.errors.join(' ').includes(word),r.errors.join(' '))}
r=G.buildableClip([{outer:rect(0,0,40,40),holes:[cw(rect(10,10,20,20))]}],sb(1),null);assert.equal(r.valid,false,'no clipping library → no number');assert.match(r.errors[0],/polygon-clipping/);
r=G.buildableClip([{outer:rect(0,0,30,30),holes:[]}],sb(16),clip);assert.ok(r.valid&&r.buildable===0,'setbacks larger than the parcel leave nothing buildable');

// 4 · stable edge ids: parcel + part + ring + edge + end points
const id=G.edgeId('parcel:900:abc',1,2,3,[39.85,21.48],[39.8501,21.4802]),p=G.parseEdgeId(id);
assert.deepEqual([p.parcelId,p.part,p.ring,p.edge],['parcel:900:abc',1,2,3]);assert.deepEqual(p.a,[39.85,21.48]);assert.equal(G.parseEdgeId('39.8,21.4>39.9,21.5'),null);

// 5 · structure comparison used before applying results to the main planner
const f=G.frame(39.85,21.48),LL=P=>P.map(q=>f.toLL(q)),A=[{outer:LL(rect(0,0,40,40)),holes:[LL(cw(rect(10,10,20,20)))]},{outer:LL(rect(50,0,70,20)),holes:[]}];
assert.ok(G.sameStructure(A,JSON.parse(JSON.stringify(A))));assert.ok(!G.sameStructure(A,A.slice(0,1)),'missing part');
assert.ok(!G.sameStructure(A,[{...A[0],holes:[]},A[1]]),'missing hole');assert.ok(!G.sameStructure(A,[{outer:LL(rect(0,0,40,39)),holes:A[0].holes},A[1]]),'changed ring');
const jitter=A.map(p=>({outer:p.outer.map(q=>[q[0]+3e-8,q[1]-3e-8]),holes:p.holes.map(h=>h.map(q=>[q[0]+3e-8,q[1]]))}));assert.ok(G.sameStructure(A,jitter),'mm round-trip tolerated');

// 6 · the fixture cases have the expected structure after the planner's vertex clean-up
const cases=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures','geometry-cases.geojson'),'utf8')).features;
assert.deepEqual(cases.map(c=>c.properties.PARCEL_NO),['G-RECT','G-L','G-MULTI','G-HOLE','G-BAD']);
console.log('Multipart geometry: strips identical to the main planner on 5 shapes; exact areas for simple, concave, hole, multipart and island;');
console.log('  4 unsupported geometries refused with reasons; edge ids, structure check and mm tolerance passed');
