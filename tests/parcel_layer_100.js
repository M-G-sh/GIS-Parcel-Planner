'use strict';
/* 120-parcel layer: street association per parcel, occlusion by neighbouring parcels, widths, isolation between parcels,
   multipart edges and buildable area. Run: node tests/parcel_layer_100.js  (after node tests/generate_fixtures.js) */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const G=require('../street-geometry.js');
const FX=path.join(__dirname,'fixtures'),read=n=>JSON.parse(fs.readFileSync(path.join(FX,n),'utf8'));
const parcels=read('grid-120-parcels.geojson').features,roads=read('grid-roads.geojson').features,expected=read('grid-expected.json');
assert.ok(parcels.length>=100,'layer has at least 100 parcels');
const rings=parcels.map(p=>p.geometry.coordinates[0].slice(0,-1)),index=G.buildRoadIndex(roads),opts={streetField:'STREET_NAME',widthField:'WIDTH_M',radius:34,angleLimit:35};
// same barrier selection as Street Tools: only parcels whose box is within 1.5 × radius of the selected parcel
const box=r=>{const f=index.frame,P=r.map(p=>f.toXY(p));return{x0:Math.min(...P.map(p=>p.x)),x1:Math.max(...P.map(p=>p.x)),y0:Math.min(...P.map(p=>p.y)),y1:Math.max(...P.map(p=>p.y))}},boxes=rings.map(box);
const near=i=>{const b=boxes[i],pad=opts.radius*1.5+5;return rings.filter((_,j)=>j!==i&&boxes[j].x1>=b.x0-pad&&boxes[j].x0<=b.x1+pad&&boxes[j].y1>=b.y0-pad&&boxes[j].y0<=b.y1+pad)};
const run=(i,barriers)=>G.match({...opts,polygons:[rings[i]],roads,roadIndex:index,barrierPolygons:barriers}).results;
const summary=rows=>rows.map(r=>r.selected?`${r.edge}:${r.selected.street}:${r.selected.width}`:`${r.edge}:-`).join('|');

let t0=Date.now();const results=rings.map((_,i)=>run(i,near(i)));const indexedMs=Date.now()-t0;
const byCount={0:[],1:[],2:[]};
results.forEach((rows,i)=>{const no=parcels[i].properties.PARCEL_NO,want=expected[no];assert.ok(want,`expected entry for ${no}`);
  assert.equal(rows.length,4,`${no}: four edges`);
  rows.forEach(r=>{const w=want.edges[r.edge];
    if(w){assert.equal(r.selected?.street,w.street,`${no} edge ${r.edge+1}: street`);assert.equal(r.selected?.width,w.width,`${no} edge ${r.edge+1}: width`);assert.notEqual(r.status,'غير مرتبط')}
    else assert.equal(r.selected,null,`${no} edge ${r.edge+1}: must stay unmatched, got ${r.selected?.street}`)});
  byCount[Object.keys(want.edges).length].push(no)});
assert.ok(byCount[0].length&&byCount[1].length&&byCount[2].length,'layer covers parcels with no, one and two streets');

// occlusion: row 3 has a parallel street 22 m from its north edge, but row 4 parcels stand between them
const occluded=parcels.findIndex(p=>p.properties.PARCEL_NO==='P-R3C01');
assert.equal(run(occluded,[]).find(r=>r.edge===2).selected?.street,'شارع الورود','without barriers the street behind the neighbour would be linked');
assert.equal(results[occluded].find(r=>r.edge===2).selected,null,'with the neighbouring parcel as barrier it is not linked');
// no width is invented: H2 has an empty width field, H3 stores Arabic digits
assert.equal(results[parcels.findIndex(p=>p.properties.PARCEL_NO==='P-R4C05')][2].selected.width,null);
assert.equal(results[parcels.findIndex(p=>p.properties.PARCEL_NO==='P-R7C02')][0].selected.width,12);

// spatially filtered barriers give the same answer as the whole layer, and order of analysis does not matter
t0=Date.now();const brute=rings.map((_,i)=>summary(run(i,rings.filter((__,j)=>j!==i))));const bruteMs=Date.now()-t0;
assert.deepEqual(results.map(summary),brute,'nearby barriers ≡ all parcels as barriers');
const order=rings.map((_,i)=>i).sort((a,b)=>((a*7919)%rings.length)-((b*7919)%rings.length));
const shuffled=new Array(rings.length);order.forEach(i=>{shuffled[i]=summary(run(i,near(i)))});assert.deepEqual(shuffled,brute,'results independent of selection order');
// edge keys are distinct per parcel, so stored results can never be applied to a neighbour sharing a boundary
const keys=results.map(rows=>rows.map(r=>r.key).join('#'));assert.equal(new Set(keys).size,keys.length);

// buildable area: setbacks per edge on a 30 × 35 m parcel
const f=G.frame(39.8,21.45),rect=[[0,0],[30,0],[30,35],[0,35]].map(([x,y])=>({x,y}));
assert.ok(Math.abs(G.insetPolygon(rect,[0,0,0,0]).area-1050)<1e-6);
assert.ok(Math.abs(G.insetPolygon(rect,[5,0,0,0]).area-900)<1e-6,'front setback 5 m → 30 × 30');
assert.ok(Math.abs(G.insetPolygon(rect,[3,3,3,3]).area-24*29)<1e-6,'3 m all round → 24 × 29');
assert.equal(G.insetPolygon(rect,[0,16,0,16]),null,'setbacks wider than the parcel collapse it: no area is reported');
const lshape=[[0,0],[40,0],[40,15],[15,15],[15,40],[0,40]].map(([x,y])=>({x,y}));
assert.ok(Math.abs(G.insetPolygon(lshape,[2,2,2,2,2,2]).area-(36*11+11*25))<1e-6,'concave L-shape inset');
const llRect=rect.map(p=>f.toLL(p)),area=G.buildableArea([{outer:llRect,holes:[]}],()=>[5,0,0,0]);
assert.ok(Math.abs(area.original-1050)<.05&&Math.abs(area.buildable-900)<.05&&Math.abs(area.difference-150)<.05,'area from lon/lat');

// multipart parcel: two outer rings → 8 edges, part-aware keys; the hole is not a street frontage
const multi=read('multipart-parcel.geojson').features[0].geometry.coordinates.map(poly=>poly[0].slice(0,-1));
const mm=G.match({...opts,polygons:multi,roads:[]});
assert.equal(mm.results.length,8);assert.deepEqual(mm.results.map(r=>r.part),[0,0,0,0,1,1,1,1]);
assert.ok(mm.results.every(r=>/^part:[01]:/.test(r.key)));assert.equal(new Set(mm.results.map(r=>r.key)).size,8);

console.log(`120-parcel layer: ${results.length} parcels · no street ${byCount[0].length}, one street ${byCount[1].length}, two streets ${byCount[2].length}`);
console.log(`  analysis with nearby barriers ${indexedMs} ms, with every parcel as barrier ${bruteMs} ms (same results)`);
console.log('  occlusion, missing/Arabic-digit widths, order independence, distinct edge keys, buildable area and multipart edges passed');
