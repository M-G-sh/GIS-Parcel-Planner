/* GIS Parcel Planner — Street association geometry (planar local metres). */
(function(root){
  'use strict';
  const rad=Math.PI/180, A=6378137, E2=0.00669437999014;
  // Local metric frame on the WGS84 ellipsoid (prime-vertical and meridian radii at the origin),
  // the same scale as the main planner's localFrame, so lengths and areas agree between the two pages.
  function frame(lon,lat){const s=Math.sin(lat*rad),w=Math.sqrt(1-E2*s*s),kx=A/w*Math.cos(lat*rad)*rad,ky=A*(1-E2)/(w*w*w)*rad;return{
    toXY(p){return{x:(p[0]-lon)*kx,y:(p[1]-lat)*ky}},
    toLL(p){return[lon+p.x/kx,lat+p.y/ky]}
  }}
  // Edge length in metres on the WGS84 ellipsoid (local frame at the edge midpoint; mm-level for parcel edges).
  function edgeLength(p,q){const f=frame((p[0]+q[0])/2,(p[1]+q[1])/2),a=f.toXY(p),b=f.toXY(q);return Math.hypot(b.x-a.x,b.y-a.y)}
  function length(a,b){return Math.hypot(b.x-a.x,b.y-a.y)}
  function segmentDistance(p,a,b){const dx=b.x-a.x,dy=b.y-a.y,ll=dx*dx+dy*dy;
    if(ll<1e-12)return length(p,a);
    const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/ll));return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy)}
  function degDifference(ax,ay,bx,by){const d=Math.hypot(ax,ay)*Math.hypot(bx,by);if(d<1e-12)return 90;
    return Math.acos(Math.min(1,Math.max(0,Math.abs((ax*bx+ay*by)/d))))/rad}
  function overlapRatio(a,b,c,d){const vx=b.x-a.x,vy=b.y-a.y,den=vx*vx+vy*vy;if(den<1e-12)return 0;
    let t0=((c.x-a.x)*vx+(c.y-a.y)*vy)/den, t1=((d.x-a.x)*vx+(d.y-a.y)*vy)/den;
    if(t0>t1)[t0,t1]=[t1,t0];return Math.max(0,Math.min(1,t1)-Math.max(0,t0))}
  function roadSegments(roads, f){const out=[];roads.forEach((road,roadIndex)=>{const geom=road.geometry||{},lines=geom.type==='LineString'?[geom.coordinates]:geom.type==='MultiLineString'?geom.coordinates:[];
    lines.forEach(coords=>{for(let k=0;k<coords.length-1;k++){const a=f.toXY(coords[k]),b=f.toXY(coords[k+1]);if(length(a,b)<0.2)continue;
      out.push({a,b,roadIndex,props:road.properties||{},minX:Math.min(a.x,b.x),maxX:Math.max(a.x,b.x),minY:Math.min(a.y,b.y),maxY:Math.max(a.y,b.y)})}})});return out}
  function gridIndex(segs,size){const index=new Map(),oversized=[];segs.forEach((s,i)=>{const x0=Math.floor(s.minX/size),x1=Math.floor(s.maxX/size),y0=Math.floor(s.minY/size),y1=Math.floor(s.maxY/size);
    if((x1-x0+1)*(y1-y0+1)>4000){oversized.push(i);return;}for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++){const key=x+','+y,arr=index.get(key)||[];arr.push(i);index.set(key,arr)}});
    return{index,size,segments:segs,oversized}}
  function buildRoadIndex(roads,center,radius=34){
    const coords=roads.flatMap(r=>(r.geometry?.type==='LineString'?[r.geometry.coordinates]:r.geometry?.type==='MultiLineString'?r.geometry.coordinates:[]).flat());
    if(!center){if(!coords.length)center=[0,0];else center=coords.reduce((a,p)=>[a[0]+p[0]/coords.length,a[1]+p[1]/coords.length],[0,0])}
    const f=frame(center[0],center[1]),segments=roadSegments(roads,f),grid=gridIndex(segments,Math.max(20,radius*2));return{frame:f,segments,grid,center:center.slice()}}
  function nearby(g,a,b,radius){const x0=Math.floor((Math.min(a.x,b.x)-radius)/g.size),x1=Math.floor((Math.max(a.x,b.x)+radius)/g.size);
    const y0=Math.floor((Math.min(a.y,b.y)-radius)/g.size),y1=Math.floor((Math.max(a.y,b.y)+radius)/g.size),ids=new Set();
    for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)for(const id of g.index.get(x+','+y)||[])ids.add(id);
    // extremely long roads are omitted from the grid: always consider them separately
    g.oversized.forEach(i=>{const s=g.segments[i];if(s.maxX>=Math.min(a.x,b.x)-radius&&s.minX<=Math.max(a.x,b.x)+radius&&s.maxY>=Math.min(a.y,b.y)-radius&&s.minY<=Math.max(a.y,b.y)+radius)ids.add(i)});
    return Array.from(ids).map(id=>g.segments[id])}
  function inRing(p,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside}return inside}
  function closestPoint(p,a,b){const dx=b.x-a.x,dy=b.y-a.y,d=dx*dx+dy*dy,t=d?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/d)):0;return{x:a.x+t*dx,y:a.y+t*dy}}
  function match({polygon,polygons=null,roads,radius=34,angleLimit=35,minOverlap=.24,streetField='',widthField='',roadIndex=null,barrierPolygons=[]}){
    if(Array.isArray(polygons)){
      const rings=polygons.filter(r=>Array.isArray(r)&&r.length>=3);if(!rings.length)throw Error('يجب تحديد مضلع صالح لقطعة الأرض');
      const results=[];let edgeOffset=0,segmentCount=0,frameOut=roadIndex?.frame||null;
      rings.forEach((ring,part)=>{const blockers=barrierPolygons.concat(rings.filter((_,i)=>i!==part));
        const result=match({polygon:ring,roads,radius,angleLimit,minOverlap,streetField,widthField,roadIndex,barrierPolygons:blockers});
        frameOut=frameOut||result.frame;segmentCount=Math.max(segmentCount,result.segmentCount);
        result.results.forEach(row=>{row.localEdge=row.edge;row.part=part;row.edge=edgeOffset++;row.key=`part:${part}:${row.key}`;results.push(row)})});
      return{results,segmentCount,frame:frameOut}}
    if(!Array.isArray(polygon)||polygon.length<3)throw Error('يجب تحديد مضلع صالح لقطعة الأرض');
    if(!Array.isArray(roads))throw Error('طبقة الشوارع غير صالحة');
    const cen=polygon.reduce((a,p)=>[a[0]+p[0]/polygon.length,a[1]+p[1]/polygon.length],[0,0]);
    const f=roadIndex?.frame||frame(...cen),P=polygon.map(p=>f.toXY(p)),segments=roadIndex?.segments||roadSegments(roads,f),grid=roadIndex?.grid||gridIndex(segments,Math.max(20,radius*2));
    const blockers=barrierPolygons.filter(r=>Array.isArray(r)&&r.length>=3).map(r=>r.map(p=>f.toXY(p)));
    const results=P.map((a,i)=>{
      const b=P[(i+1)%P.length],dx=b.x-a.x,dy=b.y-a.y,len=length(a,b);
      if(len<.05)return {edge:i,key:edgeKey(polygon,i),length:len,status:'غير صالح',candidates:[]};
      const samples=[.15,.5,.85].map(t=>({x:a.x+t*dx,y:a.y+t*dy}));
      const byRoad=new Map();
      for(const s of nearby(grid,a,b,radius)){
        const diff=degDifference(dx,dy,s.b.x-s.a.x,s.b.y-s.a.y);
        if(diff>angleLimit)continue;
        const ov=overlapRatio(a,b,s.a,s.b);if(ov<minOverlap)continue;
        const roadPoint=closestPoint(samples[1],s.a,s.b);
        if(inRing(roadPoint,P))continue;
        // the parcel itself is a barrier too: a street beyond the opposite edge of a shallow parcel is not this edge's street
        const blocked=[P,...blockers].some(ring=>[.2,.4,.6,.8].some(t=>inRing({x:samples[1].x+(roadPoint.x-samples[1].x)*t,y:samples[1].y+(roadPoint.y-samples[1].y)*t},ring)));
        if(blocked)continue;
        const ds=samples.map(p=>segmentDistance(p,s.a,s.b)),midDistance=ds[1],avgDistance=(ds[0]+ds[1]+ds[2])/3;
        if(midDistance>radius*1.45||avgDistance>radius)continue;
        const score=.68*(avgDistance/radius)+.20*(diff/Math.max(angleLimit,1))+.12*(1-ov);
        const prev=byRoad.get(s.roadIndex);
        if(!prev||score<prev.score)byRoad.set(s.roadIndex,{roadIndex:s.roadIndex,score,avgDistance,midDistance,angle:diff,overlap:ov,roadSegment:s});
      }
      const candidates=[...byRoad.values()].sort((a,b)=>a.score-b.score).slice(0,5).map(c=>({
        ...c,street:String(roads[c.roadIndex]?.properties?.[streetField]??'').trim(),
        width:parseWidth(roads[c.roadIndex]?.properties?.[widthField])
      }));
      const top=candidates[0];
      const ambiguous=top&&candidates.length>1&&candidates[1].score-top.score<.1;
      const status=!top?'غير مرتبط':ambiguous?'يحتاج مراجعة':top.avgDistance<=radius*.42&&top.angle<=16?'مطابقة قوية':'مقترح';
      return{edge:i,key:edgeKey(polygon,i),length:len,status,candidates,selected:top||null,manual:false}
    });
    return{results,segmentCount:segments.length,frame:f}
  }
  function parseWidth(v){if(v===null||v===undefined||v==='')return null;const s=String(v).replace(/[٠-٩]/g,c=>'٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/[٫،]/g,'.').replace(/,/g,'').trim();const val=Number.parseFloat(s);return Number.isFinite(val)&&val>0&&val<300?val:null}
  function setback(width,rule,fixed=3,min=3){if(rule==='none')return null;if(rule==='fixed')return Math.max(0,+fixed||0);if(rule==='fifth'){return width===null?null:Math.max(min,width/5)}return null}
  // Distance in metres between [lon,lat] points on the WGS84 ellipsoid (same model as edge lengths, areas and the
  // main planner). Up to 10 km a local frame at the midpoint is used (mm-level); beyond that a spherical haversine.
  function distance(p,q){if(Math.abs(q[0]-p[0])<.1&&Math.abs(q[1]-p[1])<.1)return edgeLength(p,q);return haversine(p,q)}
  // Great-circle distance with Leaflet's radius (CRS.Earth.R = 6371000); only for long spans.
  function haversine(p,q){const R1=6371000,la1=p[1]*rad,la2=q[1]*rad,dLa=(q[1]-p[1])*rad,dLo=(q[0]-p[0])*rad;
    const h=Math.sin(dLa/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLo/2)**2;return 2*R1*Math.asin(Math.min(1,Math.sqrt(h)))}
  // Rounding rule string "mode:step", e.g. "nearest:0.5" or "up:1". "none" keeps two decimals.
  function roundBy(v,rule){if(!Number.isFinite(v))return null;const [mode,s]=String(rule||'none').split(':'),step=Number(s);
    if(!(step>0))return Math.round(v*100)/100;const k=v/step,n=mode==='up'?Math.ceil(k-1e-9):mode==='down'?Math.floor(k+1e-9):Math.round(k);
    return Math.round(n*step*100)/100}
  // User-defined setback rule. Not a regulatory requirement: every parameter comes from the page settings.
  // method: custom → max(width×ratio%, min), capped at max when given · fixed → constant · manual → null.
  function computeSetback(width,o={}){const m=o.method||'manual';
    if(m==='fixed'){const v=Number(o.fixed);return Number.isFinite(v)&&v>=0?roundBy(v,'none'):null}
    if(m!=='custom'||!(width>0))return null;const ratio=Number(o.ratio);if(!Number.isFinite(ratio)||ratio<0)return null;
    let v=width*ratio/100;const min=Number(o.min),max=o.max===''||o.max===null||o.max===undefined?NaN:Number(o.max);
    if(Number.isFinite(min)&&min>0)v=Math.max(v,min);if(Number.isFinite(max)&&max>0)v=Math.min(v,max);return roundBy(v,o.rounding)}
  // Stable edge identity: start and end vertex of the ring, independent of table order.
  function edgeKey(polygon,i){const n=polygon.length,a=polygon[i],b=polygon[(i+1)%n],k=p=>Number(p[0]).toFixed(7)+','+Number(p[1]).toFixed(7);return k(a)+'>'+k(b)}
  // Signed shoelace area of a planar ring [{x,y}] (positive = counter-clockwise).
  function ringArea(P){let a=0;for(let i=0;i<P.length;i++){const p=P[i],q=P[(i+1)%P.length];a+=p.x*q.y-q.x*p.y}return a/2}
  function properCross(a,b,c,d){const o=(p,q,r)=>(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x),d1=o(c,d,a),d2=o(c,d,b),d3=o(a,b,c),d4=o(a,b,d);
    return((d1>1e-9&&d2<-1e-9)||(d1<-1e-9&&d2>1e-9))&&((d3>1e-9&&d4<-1e-9)||(d3<-1e-9&&d4>1e-9))}
  // Inward offset of a planar ring by a separate distance per edge (edge i = P[i]→P[i+1]).
  // Returns {ring,area} or null when the offset collapses an edge or self-intersects: never a guessed area.
  function insetPolygon(P,distances){
    const pts=[],dist=[];P.forEach((p,i)=>{const q=P[(i+1)%P.length];if(Math.hypot(q.x-p.x,q.y-p.y)>1e-6){pts.push(p);dist.push(Math.max(0,Number(distances?.[i])||0))}});
    const n=pts.length;if(n<3)return null;const s=Math.sign(ringArea(pts))||1;
    const lines=pts.map((a,i)=>{const b=pts[(i+1)%n],dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy),nx=-dy/l*s,ny=dx/l*s;return{p:{x:a.x+nx*dist[i],y:a.y+ny*dist[i]},v:{x:dx/l,y:dy/l}}});
    const ring=lines.map((L2,i)=>{const L1=lines[(i-1+n)%n],cr=L1.v.x*L2.v.y-L1.v.y*L2.v.x;if(Math.abs(cr)<1e-9)return{...L2.p};
      const t=((L2.p.x-L1.p.x)*L2.v.y-(L2.p.y-L1.p.y)*L2.v.x)/cr;return{x:L1.p.x+L1.v.x*t,y:L1.p.y+L1.v.y*t}});
    const area=ringArea(ring);if(Math.sign(area)!==s||Math.abs(area)<.01)return null;
    for(let i=0;i<n;i++){const a=ring[i],b=ring[(i+1)%n];if((b.x-a.x)*lines[i].v.x+(b.y-a.y)*lines[i].v.y<-1e-6)return null}
    for(let i=0;i<n;i++)for(let j=i+2;j<n;j++){if(i===0&&j===n-1)continue;if(properCross(ring[i],ring[(i+1)%n],ring[j],ring[(j+1)%n]))return null}
    return{ring,area:Math.abs(area)}}
  // Original and buildable area of a parcel made of parts [{outer,holes}] in [lon,lat], with setbacks per outer edge.
  // Holes are subtracted unchanged from both areas, so a part with holes is reported as approximate.
  function buildableArea(parts,setbacksFor){if(!Array.isArray(parts)||!parts.length)return null;
    const pts=parts.flatMap(p=>p.outer||[]);if(!pts.length)return null;const c=pts.reduce((a,p)=>[a[0]+p[0]/pts.length,a[1]+p[1]/pts.length],[0,0]),f=frame(c[0],c[1]);
    let original=0,buildable=0,valid=true,approx=false;
    parts.forEach((part,k)=>{const outer=(part.outer||[]).map(p=>f.toXY(p)),holes=(part.holes||[]).reduce((a,h)=>a+Math.abs(ringArea(h.map(p=>f.toXY(p)))),0);
      const gross=Math.abs(ringArea(outer));original+=gross-holes;if(holes>0)approx=true;
      const inset=insetPolygon(outer,setbacksFor(k,outer.length));if(!inset){valid=false;return}buildable+=Math.max(0,inset.area-holes)});
    return{original,buildable:valid?buildable:null,difference:valid?original-buildable:null,valid,approx}}
  /* ---- Full parcel geometry: MultiPolygon parts, holes, stable edge ids, buildable area by polygon clipping ---- */
  const isMultiParts=parts=>Array.isArray(parts)&&(parts.length>1||parts.some(p=>(p.holes||[]).length));
  // Main part = largest outer ring (area rounded to 0.01 m², ties → first part): the part edited in the main planner's edge table.
  function mainPartIndex(parts){let best=0,ba=-1;(parts||[]).forEach((p,i)=>{const R=p.outer||[];if(R.length<3)return;const f=frame(R[0][0],R[0][1]),a=Math.round(Math.abs(ringArea(R.map(q=>f.toXY(q))))*100);if(a>ba){ba=a;best=i}});return best}
  // Display order of edges of a multipart parcel: main outer ring, other outer rings by part, holes by part and ring
  // (the same numbering in the main planner and in «مزيد»).
  function ringDisplayOrder(parts,mainPart){const outs=[],holes=[];(parts||[]).forEach((p,k)=>{(k===mainPart?outs.unshift.bind(outs):outs.push.bind(outs))({part:k,ring:0});(p.holes||[]).forEach((h,j)=>holes.push({part:k,ring:j+1}))});
    let h=0;return outs.concat(holes).map(r=>({...r,holeNo:r.ring?++h:0}))}
  // Stable edge id: parcel identity + part + ring (0 = outer, k = hole k) + edge index + the edge's own lon/lat end points.
  function edgeId(parcelId,part,ring,edge,a,b){const k=p=>Number(p[0]).toFixed(7)+','+Number(p[1]).toFixed(7);return`${parcelId}#p${part}r${ring}e${edge}#${k(a)}>${k(b)}`}
  function parseEdgeId(key){const m=/^(.*)#p(\d+)r(\d+)e(\d+)#(-?[\d.]+),(-?[\d.]+)>(-?[\d.]+),(-?[\d.]+)$/.exec(String(key||''));if(!m)return null;
    return{parcelId:m[1],part:+m[2],ring:+m[3],edge:+m[4],a:[+m[5],+m[6]],b:[+m[7],+m[8]]}}
  // Same vertex clean-up as the main planner's dedupe(): repeated points (< 2 cm) and near-collinear points (< 1 cm off the chord).
  function dedupeRingLL(ring){if(!Array.isArray(ring)||ring.length<3)return ring||[];const c=ring.reduce((a,p)=>[a[0]+p[0]/ring.length,a[1]+p[1]/ring.length],[0,0]),f=frame(c[0],c[1]);
    let out=[];ring.forEach(p=>{const q=f.toXY(p),last=out[out.length-1];if(!last||Math.hypot(q.x-last.q.x,q.y-last.q.y)>.02)out.push({p,q})});
    if(out.length>3&&Math.hypot(out[0].q.x-out[out.length-1].q.x,out[0].q.y-out[out.length-1].q.y)<.02)out.pop();
    for(let k=0;k<out.length&&out.length>3;){const a=out[(k-1+out.length)%out.length].q,b=out[k].q,c2=out[(k+1)%out.length].q;
      const ar=Math.abs((b.x-a.x)*(c2.y-b.y)-(b.y-a.y)*(c2.x-b.x))/2,base=Math.hypot(c2.x-a.x,c2.y-a.y)||1;if(ar/base<.01)out.splice(k,1);else k++}
    return out.map(o=>o.p)}
  // Setback strips of one ring, ported unchanged from the main planner's setbackStrips(): a band of width sb along every edge
  // plus the corner wedge. sign = +1 when the parcel interior lies left of the ring direction (outer CCW / hole CW), else -1.
  function ringStrips(P,sbs,sign){const n=P.length,out=[],sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y}),add=(a,b)=>({x:a.x+b.x,y:a.y+b.y}),mul=(a,s)=>({x:a.x*s,y:a.y*s}),cross=(a,b)=>a.x*b.y-a.y*b.x;
    const E=P.map((a,i)=>{const b=P[(i+1)%n],d=sub(b,a),len=Math.hypot(d.x,d.y)||1;return{a,b,len,nOut:mul({x:-d.y/len,y:d.x/len},-sign),sb:Math.max(0,Number(sbs?.[i])||0)}});
    const ln=E.map(e=>{const d=mul(sub(e.b,e.a),1/e.len),nin=mul(e.nOut,-1);return{d,nin,p:add(e.a,mul(nin,e.sb))}});
    E.forEach((e,i)=>{if(e.sb>0){const o=mul(ln[i].nin,e.sb);out.push([e.a,e.b,add(e.b,o),add(e.a,o)])}});
    for(let i=0;i<n;i++){const j=(i-1+n)%n,A=ln[j],B=ln[i],sa=E[j].sb,sb=E[i].sb;if(!(sa>0||sb>0))continue;
      const v=P[i],pa=add(v,mul(A.nin,sa)),pb=add(v,mul(B.nin,sb)),cr=cross(A.d,B.d);if(Math.abs(cr)<1e-9)continue;
      const X=add(A.p,mul(A.d,cross(sub(B.p,A.p),B.d)/cr)),reflex=cr*sign<0;
      const w=reflex&&Math.hypot(X.x-v.x,X.y-v.y)>4*Math.max(sa,sb)?[v,pa,pb]:[v,pa,X,pb];
      out.push(w.filter((p,k)=>k===0||(Math.hypot(p.x-w[k-1].x,p.y-w[k-1].y)>1e-9&&Math.hypot(p.x-v.x,p.y-v.y)>1e-9)))}
    return out.filter(q=>q.length>=3&&Math.abs(ringArea(q))>1e-6)}
  const ringSelfCrosses=R=>{const n=R.length;for(let i=0;i<n;i++)for(let j=i+2;j<n;j++){if(i===0&&j===n-1)continue;if(properCross(R[i],R[(i+1)%n],R[j],R[(j+1)%n]))return true}return false};
  const inRingXY=(p,ring)=>{let c=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)c=!c}return c};
  const ringsCross=(A,B)=>A.some((a,i)=>B.some((c,j)=>properCross(a,A[(i+1)%A.length],c,B[(j+1)%B.length])));
  // Planar parts [{outer:[{x,y}],holes:[[{x,y}]]}] → list of reasons the geometry cannot be handled exactly (empty = supported).
  function validateParts(parts,clipper){const errors=[];if(!Array.isArray(parts)||!parts.length)return['لا توجد هندسة للقطعة.'];
    parts.forEach((p,k)=>{const name=`الجزء ${k+1}`;if(!p.outer||p.outer.length<3){errors.push(`${name}: الحد الخارجي غير صالح.`);return}
      if(ringSelfCrosses(p.outer)){errors.push(`${name}: الحد الخارجي يتقاطع مع نفسه.`);return}
      if(Math.abs(ringArea(p.outer))<.01){errors.push(`${name}: الحد الخارجي غير صالح (مساحة صفرية).`);return}
      (p.holes||[]).forEach((h,j)=>{if(h.length<3){errors.push(`${name}: الفراغ ${j+1} غير صالح.`);return}
        if(ringSelfCrosses(h)){errors.push(`${name}: الفراغ ${j+1} يتقاطع مع نفسه.`);return}
        if(Math.abs(ringArea(h))<.01){errors.push(`${name}: الفراغ ${j+1} غير صالح (مساحة صفرية).`);return}
        if(!h.every(q=>inRingXY(q,p.outer))||ringsCross(h,p.outer))errors.push(`${name}: الفراغ ${j+1} يخرج عن حد الجزء.`);
        (p.holes||[]).slice(j+1).forEach((h2,i2)=>{if(ringsCross(h,h2)||inRingXY(h2[0],h)||inRingXY(h[0],h2))errors.push(`${name}: الفراغان ${j+1} و${j+i2+2} متداخلان.`)})})});
    for(let a=0;a<parts.length;a++)for(let b=a+1;b<parts.length;b++){const A=parts[a].outer,B=parts[b].outer;if(!A||!B)continue;
      let hit=ringsCross(A,B)||inRingXY(B[0],A)||inRingXY(A[0],B);
      // a part lying inside a hole of another part (island) is legitimate
      if(hit&&!ringsCross(A,B)){const inHole=(X,P2)=>(P2.holes||[]).some(h=>inRingXY(X[0],h)&&X.every(q=>inRingXY(q,h)));if(inHole(B,parts[a])||inHole(A,parts[b]))hit=false}
      if(hit)errors.push(`الجزءان ${a+1} و${b+1} متداخلان.`)}
    return errors}
  const toRingArr=R=>{const r=R.map(p=>[p.x,p.y]);r.push(r[0].slice());return r};
  // Original and buildable area of planar parts. Buildable = parcel (all parts, minus holes) − setback strips of every edge
  // (outer and hole rings), with the main planner's strip geometry. sbsFor(part,ring,n) → setbacks of that ring's edges.
  // Needs a polygon-clipping implementation; returns valid:false with a reason instead of an estimate when it cannot be exact.
  function buildableClip(parts,sbsFor,clipper){const errors=validateParts(parts);
    const original=parts.reduce((s,p)=>s+Math.abs(ringArea(p.outer||[]))-(p.holes||[]).reduce((t,h)=>t+Math.abs(ringArea(h)),0),0);
    if(errors.length)return{original,buildable:null,difference:null,parts:[],valid:false,errors};
    const strips=[];let anySb=false;
    parts.forEach((p,k)=>{const rings=[p.outer,...(p.holes||[])];rings.forEach((R,r)=>{const sbs=sbsFor(k,r,R.length)||[];if(sbs.some(v=>v>0))anySb=true;
      const s=Math.sign(ringArea(R))||1;strips.push(...ringStrips(R,sbs,r===0?s:-s))})});
    const subject=parts.map(p=>[toRingArr(p.outer),...(p.holes||[]).map(toRingArr)]);
    const area=pgs=>pgs.reduce((s,pg)=>s+Math.abs(ringArea(pg[0].slice(0,-1).map(([x,y])=>({x,y}))))-pg.slice(1).reduce((t,h)=>t+Math.abs(ringArea(h.slice(0,-1).map(([x,y])=>({x,y})))),0),0);
    if(!anySb)return{original,buildable:original,difference:0,parts:subject,valid:true,errors:[]};
    if(!clipper?.difference)return{original,buildable:null,difference:null,parts:[],valid:false,errors:['مكتبة قص المضلعات (polygon-clipping) غير محمّلة؛ لا يمكن حساب المساحة بعد الارتدادات بدقة.']};
    // same snap-grid retries as the main planner for near-degenerate floating point input (≤ 1 mm)
    for(const g of [0,1e-6,1e-4,1e-3]){const sn=g?ring=>ring.map(([x,y])=>[Math.round(x/g)*g,Math.round(y/g)*g]):ring=>ring;
      try{const res=clipper.difference(subject.map(pg=>pg.map(sn)),...strips.map(q=>[sn(toRingArr(q))])),b=area(res);
        if(b>original+.01)continue;return{original,buildable:b,difference:original-b,parts:res,valid:true,errors:[]}}catch(e){}}
    return{original,buildable:null,difference:null,parts:[],valid:false,errors:['تعذّر قص المضلعات لهذه الهندسة.']}}
  // Same parcel structure: equal number of parts and holes, and each ring with the same area (±0.1 m² + 0.1 %) and centroid (±0.2 m).
  function sameStructure(A,B){if(!Array.isArray(A)||!Array.isArray(B)||A.length!==B.length)return false;const pts=A.flatMap(p=>p.outer||[]);if(!pts.length)return false;
    const c=pts.reduce((s,p)=>[s[0]+p[0]/pts.length,s[1]+p[1]/pts.length],[0,0]),f=frame(c[0],c[1]),ring=R=>{const P=R.map(p=>f.toXY(p)),a=Math.abs(ringArea(P)),x=P.reduce((s,p)=>s+p.x,0)/P.length,y=P.reduce((s,p)=>s+p.y,0)/P.length;return{a,x,y}};
    const same=(r1,r2)=>{const a=ring(r1),b=ring(r2);return Math.abs(a.a-b.a)<=.1+a.a*.001&&Math.hypot(a.x-b.x,a.y-b.y)<=.2};
    return A.every((p,k)=>(p.holes||[]).length===(B[k].holes||[]).length&&same(p.outer,B[k].outer)&&(p.holes||[]).every((h,j)=>same(h,B[k].holes[j])))}
  const lib={mainPartIndex,ringDisplayOrder,frame,edgeLength,length,segmentDistance,degDifference,overlapRatio,roadSegments,buildRoadIndex,match,parseWidth,setback,distance,roundBy,computeSetback,edgeKey,ringArea,insetPolygon,buildableArea,
    isMultiParts,edgeId,parseEdgeId,dedupeRingLL,ringStrips,validateParts,buildableClip,sameStructure};
  if(typeof module!=='undefined'&&module.exports)module.exports=lib;
  root.StreetGeometry=lib;
})(typeof window!=='undefined'?window:globalThis);
