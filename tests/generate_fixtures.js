'use strict';
/* Builds the 120-parcel verification layer and its street layer (synthetic test data, not official records).
   Usage: node tests/generate_fixtures.js   (writes tests/fixtures/grid-*.json[geojson])

   Layout, in local metres (x east, y north): 12 columns × 10 rows of parcels, 30 m wide.
   Row 4 is 12 m deep, the others 35 m. Streets (20 m reserve, centreline 10 m from the parcel edge):
     H0 below row 0 · H1 between rows 1/2 · H2 between rows 4/5 · H3 between rows 6/7 · H4 above row 9
     V1 between columns 3/4 · V2 between columns 7/8
   Expected:
     rows 0,1,2,4,5,6,7,9 → one horizontal street; columns 3,4,7,8 add a vertical street (corner parcels: two streets)
     row 3 → no horizontal street: H2 is 22 m away but row 4 parcels stand between (occlusion)
     row 8 → no horizontal street: the nearest street centreline is 45 m away (beyond the search radius) */
const fs=require('node:fs'),path=require('node:path');
const G=require('../street-geometry.js');
const OUT=path.join(__dirname,'fixtures'),f=G.frame(39.80,21.45);
const COLS=12,ROWS=10,W=30,depth=r=>r===4?12:35,gapBefore=new Set([2,5,7]),vGapAfter=new Set([3,7]),GAP=20;
const colX=[];let x=0;for(let c=0;c<COLS;c++){colX[c]=x;x+=W;if(vGapAfter.has(c))x+=GAP}const maxX=x;
const rowY=[];let y=0;for(let r=0;r<ROWS;r++){if(gapBefore.has(r))y+=GAP;rowY[r]=y;y+=depth(r)}const maxY=y;
const ll=(px,py)=>{const p=f.toLL({x:px,y:py});return[+p[0].toFixed(9),+p[1].toFixed(9)]};

const H=[{name:'شارع الأمير سلطان',y:-10,width:20},{name:'شارع الملك فهد',y:rowY[2]-10,width:15},{name:'شارع الورود',y:rowY[5]-10,width:''},
  {name:'شارع النخيل',y:rowY[7]-10,width:'١٢'},{name:'شارع الياسمين',y:rowY[9]+depth(9)+10,width:18}];
const V=[{name:'طريق الملك عبدالعزيز',x:colX[4]-10,width:25},{name:'شارع التحلية',x:colX[8]-10,width:'30'}];
const roads={type:'FeatureCollection',features:[
  ...H.map((s,i)=>({type:'Feature',properties:{OBJECTID:i+1,STREET_NAME:s.name,WIDTH_M:s.width,CLASS:'محلي'},geometry:{type:'LineString',coordinates:[ll(-20,s.y),ll(maxX+20,s.y)]}})),
  ...V.map((s,i)=>({type:'Feature',properties:{OBJECTID:H.length+i+1,STREET_NAME:s.name,WIDTH_M:s.width,CLASS:'رئيسي'},geometry:{type:'LineString',coordinates:[ll(s.x,-20),ll(s.x,maxY+20)]}}))]};

const horizontal=r=>({0:0,1:1,2:1,4:2,5:2,6:3,7:3,9:4})[r],vertical=c=>c===3||c===4?0:c===7||c===8?1:undefined;
const districts=['النرجس','الملقا','الياسمين','العارض','القيروان'];
const parcels={type:'FeatureCollection',features:[]},expected={};
for(let r=0;r<ROWS;r++)for(let c=0;c<COLS;c++){
  const no=`P-R${r}C${String(c).padStart(2,'0')}`,x0=colX[c],y0=rowY[r],x1=x0+W,y1=y0+depth(r);
  // counter-clockwise from the south-west corner: edge 0 south, 1 east, 2 north, 3 west
  const ring=[ll(x0,y0),ll(x1,y0),ll(x1,y1),ll(x0,y1),ll(x0,y0)];
  parcels.features.push({type:'Feature',properties:{OBJECTID:parcels.features.length+1,PARCEL_NO:no,PLAN_NO:'3120/أ',DISTRICT:districts[Math.floor(r/2)],MUNICIPALITY:'بلدية شمال الرياض',
    LAND_USE:c%5===0?'تجاري':'سكني',BLOCK_NO:`B${Math.floor(c/4)+1}`,DEED_AREA:W*depth(r)},geometry:{type:'Polygon',coordinates:[ring]}});
  const streets={},h=horizontal(r),v=vertical(c);
  if(h!==undefined){const edge=[0,4].includes(h)?(h===0?0:2):(r===2||r===5||r===7?0:2);streets[edge]={street:H[h].name,width:G.parseWidth(H[h].width)}}
  if(v!==undefined){const edge=c===3||c===7?1:3;streets[edge]={street:V[v].name,width:G.parseWidth(V[v].width)}}
  expected[no]={row:r,col:c,area:W*depth(r),edges:streets}}
fs.mkdirSync(OUT,{recursive:true});
fs.writeFileSync(path.join(OUT,'grid-120-parcels.geojson'),JSON.stringify(parcels));
fs.writeFileSync(path.join(OUT,'grid-roads.geojson'),JSON.stringify(roads));
fs.writeFileSync(path.join(OUT,'grid-expected.json'),JSON.stringify(expected,null,1));
// Geometry cases (local metres around 39.85E 21.48N), one street 10 m south of every parcel:
//   G-RECT simple 30×40 · G-L concave L · G-MULTI two parts, the larger with a 10×10 hole · G-HOLE one part with a hole
//   G-BAD hole crossing the outer boundary (unsupported: must be refused, never estimated)
{const g=G.frame(39.85,21.48),L2=pts=>{const r=pts.map(([px,py])=>{const p=g.toLL({x:px,y:py});return[+p[0].toFixed(9),+p[1].toFixed(9)]});r.push(r[0].slice());return r};
  const cw=pts=>pts.slice().reverse();
  const cases=[
    ['G-RECT',{type:'Polygon',coordinates:[L2([[0,0],[30,0],[30,40],[0,40]])]}],
    ['G-L',{type:'Polygon',coordinates:[L2([[60,0],[100,0],[100,15],[75,15],[75,40],[60,40]])]}],
    ['G-MULTI',{type:'MultiPolygon',coordinates:[[L2([[130,0],[170,0],[170,40],[130,40]]),L2(cw([[140,10],[150,10],[150,20],[140,20]]))],[L2([[180,0],[200,0],[200,20],[180,20]])]]}],
    ['G-HOLE',{type:'Polygon',coordinates:[L2([[230,0],[270,0],[270,40],[230,40]]),L2(cw([[245,15],[255,15],[255,25],[245,25]]))]}],
    ['G-BAD',{type:'Polygon',coordinates:[L2([[300,0],[330,0],[330,30],[300,30]]),L2(cw([[320,10],[340,10],[340,20],[320,20]]))]}]];
  fs.writeFileSync(path.join(OUT,'geometry-cases.geojson'),JSON.stringify({type:'FeatureCollection',features:cases.map(([no,geometry],i)=>({type:'Feature',properties:{OBJECTID:900+i,PARCEL_NO:no,PLAN_NO:'GEOM-1'},geometry}))}));
  fs.writeFileSync(path.join(OUT,'geometry-roads.geojson'),JSON.stringify({type:'FeatureCollection',features:[{type:'Feature',properties:{STREET_NAME:'شارع الاختبار',WIDTH_M:20},geometry:{type:'LineString',coordinates:[L2([[-20,-10],[360,-10]])[0],L2([[360,-10]])[0]]}}]}))}
// Layout cases (local metres around 46.70E 24.70N, Riyadh): parcels large enough for a small mosque, housing and parking.
//   Y-RECT 80×60 · Y-L 80×60 minus a 40×30 notch · Y-MULTI part 1 80×60 with a 20×15 hole near a corner + part 2 40×30 (25 m gap)
{const g=G.frame(46.70,24.70),L2=pts=>{const r=pts.map(([px,py])=>{const p=g.toLL({x:px,y:py});return[+p[0].toFixed(9),+p[1].toFixed(9)]});r.push(r[0].slice());return r};
  const cw=pts=>pts.slice().reverse(),cases=[
    ['Y-RECT',{type:'Polygon',coordinates:[L2([[0,0],[80,0],[80,60],[0,60]])]}],
    ['Y-L',{type:'Polygon',coordinates:[L2([[200,0],[280,0],[280,30],[240,30],[240,60],[200,60]])]}],
    ['Y-MULTI',{type:'MultiPolygon',coordinates:[[L2([[400,0],[480,0],[480,60],[400,60]]),L2(cw([[452,36],[472,36],[472,51],[452,51]]))],[L2([[505,0],[545,0],[545,30],[505,30]])]]}]];
  fs.writeFileSync(path.join(OUT,'layout-cases.geojson'),JSON.stringify({type:'FeatureCollection',features:cases.map(([no,geometry],i)=>({type:'Feature',properties:{OBJECTID:700+i,PARCEL_NO:no,PLAN_NO:'LAYOUT-1'},geometry}))}));
  // Y-REV: the small part is listed first; the main (largest) part is part 2 and must still be numbered first
  fs.writeFileSync(path.join(OUT,'layout-reversed.geojson'),JSON.stringify({type:'FeatureCollection',features:[{type:'Feature',properties:{OBJECTID:710,PARCEL_NO:'Y-REV',PLAN_NO:'LAYOUT-1'},
    geometry:{type:'MultiPolygon',coordinates:[[L2([[600,0],[640,0],[640,30],[600,30]])],[L2([[660,0],[740,0],[740,60],[660,60]]),L2(cw([[712,36],[732,36],[732,51],[712,51]]))]]}}]}))}
// Transaction-form cases (local metres around 46.75E 24.75N), every street centreline 10 m from its edge:
//   T-ONE one street (south) · T-CORNER two streets (south + east) · T-FOUR a street on each of its four edges
//   T-MULTI two parts, the larger with a 10×10 hole, one street south of both parts · T-EMPTY no street and no saved data
{const g=G.frame(46.75,24.75),P=([px,py])=>{const p=g.toLL({x:px,y:py});return[+p[0].toFixed(9),+p[1].toFixed(9)]},L2=pts=>{const r=pts.map(P);r.push(r[0].slice());return r};
  const cw=pts=>pts.slice().reverse(),box=(x0,y0,x1,y1)=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1]],cases=[
    ['T-ONE',{type:'Polygon',coordinates:[L2(box(0,0,30,40))]}],
    ['T-CORNER',{type:'Polygon',coordinates:[L2(box(100,0,130,40))]}],
    ['T-FOUR',{type:'Polygon',coordinates:[L2(box(200,0,240,30))]}],
    ['T-MULTI',{type:'MultiPolygon',coordinates:[[L2(box(300,0,340,40)),L2(cw(box(315,15,325,25)))],[L2(box(350,0,370,20))]]}],
    ['T-EMPTY',{type:'Polygon',coordinates:[L2(box(500,0,530,30))]}]];
  const roads=[['شارع الواحة',20,[[-20,-10],[50,-10]]],['شارع النور',25,[[90,-10],[150,-10]]],['شارع الضياء',15,[[140,-20],[140,50]]],
    ['شارع الفرقان',30,[[185,-10],[255,-10]]],['شارع الهدى',20,[[250,-15],[250,45]]],['شارع الإيمان',15,[[185,40],[255,40]]],['شارع السلام',12,[[190,-15],[190,45]]],
    ['شارع المجمع',20,[[290,-10],[380,-10]]]];
  fs.writeFileSync(path.join(OUT,'tx-cases.geojson'),JSON.stringify({type:'FeatureCollection',features:cases.map(([no,geometry],i)=>({type:'Feature',properties:{OBJECTID:800+i,PARCEL_NO:no,PLAN_NO:'TX-1',DISTRICT:'حي الاختبار'},geometry}))}));
  fs.writeFileSync(path.join(OUT,'tx-roads.geojson'),JSON.stringify({type:'FeatureCollection',features:roads.map(([name,w,pts],i)=>({type:'Feature',properties:{OBJECTID:i+1,STREET_NAME:name,WIDTH_M:w},geometry:{type:'LineString',coordinates:pts.map(P)}}))}))}
// Zoning cases (synthetic, metric boxes around 46.80E 24.80N) for tests/e2e_zoning.js, with the requirements as GIS attributes:
//   Z-SB 30×40, coverage 60 % (setbacks of 5 m make the setbacks bind) · Z-COV the same with 2 m setbacks (coverage binds)
//   Z-L concave L (1200 m²), commercial, 50 %, 2 floors, FAR 1.2, status «قيد المراجعة» · Z-MULTI two parts + a 10×10 hole, 40 %
//   Z-NONE no requirement at all · Z-RULE same district and use as Z-COV, no requirement (a saved rule applies) · Z-OTHER another district
{const g=G.frame(46.80,24.80),P=([px,py])=>{const p=g.toLL({x:px,y:py});return[+p[0].toFixed(9),+p[1].toFixed(9)]},L2=pts=>{const r=pts.map(P);r.push(r[0].slice());return r};
  const cw=pts=>pts.slice().reverse(),box=(x0,y0,x1,y1)=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1]];
  const site={'المدينة':'الرياض','الأمانة':'أمانة منطقة الرياض','اسم البلدية':'بلدية العليا','اسم الحي':'حي الروضة','رقم المخطط':'1234'};
  const reg={'تصنيف الاستخدام':'سكني','نسبة التغطية':'60','عدد الأدوار':'3','مرجع الاشتراط':'دليل اشتراطات البناء (اختبار) — المادة 12','تاريخ الاشتراط':'1446/05/12هـ','حالة الاعتماد':'معتمد'};
  const cases=[
    ['Z-SB',{type:'Polygon',coordinates:[L2(box(0,0,30,40))]},{...site,...reg}],
    ['Z-COV',{type:'Polygon',coordinates:[L2(box(100,0,130,40))]},{...site,...reg}],
    ['Z-L',{type:'Polygon',coordinates:[L2([[200,0],[240,0],[240,20],[220,20],[220,40],[200,40]])]},{...site,'تصنيف الاستخدام':'تجاري','نسبة التغطية':'50','عدد الأدوار':'2','FAR':'1.2','مرجع الاشتراط':'اشتراطات المحور التجاري (اختبار)','حالة الاعتماد':'قيد المراجعة'}],
    ['Z-MULTI',{type:'MultiPolygon',coordinates:[[L2(box(300,0,340,40)),L2(cw(box(315,15,325,25)))],[L2(box(350,0,370,20))]]},{...site,'تصنيف الاستخدام':'سكني','نسبة التغطية':'40','مرجع الاشتراط':'دليل اشتراطات البناء (اختبار) — المادة 14','حالة الاعتماد':'معتمد'}],
    ['Z-NONE',{type:'Polygon',coordinates:[L2(box(500,0,530,30))]},{}],
    ['Z-RULE',{type:'Polygon',coordinates:[L2(box(600,0,630,30))]},{...site,'رقم المخطط':'1240','تصنيف الاستخدام':'سكني'}],
    ['Z-OTHER',{type:'Polygon',coordinates:[L2(box(700,0,730,30))]},{...site,'اسم الحي':'حي النرجس','تصنيف الاستخدام':'سكني'}]];
  fs.writeFileSync(path.join(OUT,'zoning-cases.geojson'),JSON.stringify({type:'FeatureCollection',features:cases.map(([no,geometry,props],i)=>({type:'Feature',properties:{OBJECTID:900+i,PARCEL_NO:no,...props},geometry}))}))}
const counts=Object.values(expected).reduce((a,e)=>{const n=Object.keys(e.edges).length;a[n]=(a[n]||0)+1;return a},{});
console.log(`fixtures: ${parcels.features.length} parcels, ${roads.features.length} streets · parcels by matched streets: ${JSON.stringify(counts)}`);
