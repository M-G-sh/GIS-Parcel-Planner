'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const G=require('../street-geometry.js');
const parcels=JSON.parse(fs.readFileSync(__dirname+'/fixtures/two-parcels.geojson','utf8')).features;
const roads=JSON.parse(fs.readFileSync(__dirname+'/fixtures/two-roads.geojson','utf8')).features;
const index=G.buildRoadIndex(roads);
assert.equal(index.segments.length,2);
for(let i=0;i<parcels.length;i++){
  const polygon=parcels[i].geometry.coordinates[0].slice(0,-1),barrierPolygons=parcels.filter((_,j)=>j!==i).map(f=>f.geometry.coordinates[0].slice(0,-1));
  const options={polygon,roads,streetField:'STREET_NAME',widthField:'WIDTH_M',radius:34,angleLimit:35,barrierPolygons};
  const brute=G.match(options),indexed=G.match({...options,roadIndex:index});
  assert.deepEqual(indexed.results.map(r=>({street:r.selected?.street,width:r.selected?.width,status:r.status})),brute.results.map(r=>({street:r.selected?.street,width:r.selected?.width,status:r.status})));
  assert.equal(indexed.results[0].selected?.street,i?'ROAD-B':'ROAD-A');
}
const target=parcels[0].geometry.coordinates[0].slice(0,-1);
const inside={type:'Feature',properties:{STREET_NAME:'inside',WIDTH_M:99},geometry:{type:'LineString',coordinates:[[39.82335,21.4254],[39.82395,21.4254]]}};
assert.equal(G.match({polygon:target,roads:[inside],streetField:'STREET_NAME',widthField:'WIDTH_M',radius:34}).results[3].selected,null);
const barrier=[[39.82335,21.42504],[39.82395,21.42504],[39.82395,21.42516],[39.82335,21.42516]];
const blocked=G.match({polygon:target,roads:[roads[0]],streetField:'STREET_NAME',widthField:'WIDTH_M',radius:34,barrierPolygons:[barrier]});
assert.equal(blocked.results[0].selected,null);
console.log('Indexed road matching: candidate equivalence, per-parcel selection, inside-road and occlusion checks passed');
