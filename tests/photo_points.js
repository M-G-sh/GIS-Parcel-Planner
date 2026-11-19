'use strict';
/* Unit test of photo-points.js (no browser): photo-name position, photo columns found by their values, matching to a parcel
   (by name, inside, nearest within 40 m, holes), and — when they are on this computer — real File Geodatabases: every point
   layer read (also several layers in one database, photos repeated across layers kept once) and photos read from inside.
   Run: node tests/photo_points.js   (geodatabases: PP_GDBS="path1;path2", default the survey databases on drive G:) */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const PP=require('../photo-points.js');
const ok=m=>console.log('  ✓',m);

// 1) position written in the photo name
assert.deepEqual(PP.posFromName('2026-11-04_05-23-52_21.37948_39.78721.jpg'),{lat:21.37948,lon:39.78721});
assert.equal(PP.posFromName('IMG_0001.jpg'),null);ok('position read from the photo name');

// 2) the photo name / link columns are found by their values, whatever their names
assert.deepEqual(PP.detectFields([{a:'x',b:'p_1.JPG',c:'https://h/p_1.jpg'},{a:'y',b:'p_2.jpg',c:'https://h/p_2.jpg'}]),{name:'b',url:'c'});
assert.deepEqual(PP.detectFields([{a:'x',b:3}]),{name:'',url:''});ok('photo columns found by their values');

// 3) matching: a 20 × 20 m parcel with a 6 × 6 m hole; points inside, in the hole, 5 m and 60 m outside, and one named
const lat0=21.4,lon0=39.8,my=1/110574,mx=1/(111320*Math.cos(lat0*Math.PI/180)),ll=(x,y)=>({lat:lat0+y*my,lon:lon0+x*mx});
const ring=[ll(-10,-10),ll(10,-10),ll(10,10),ll(-10,10)],hole=[ll(-3,-3),ll(3,-3),ll(3,3),ll(-3,3)];
const P=(name,x,y)=>({name,...ll(x,y)});
const set={points:[P('in.jpg',6,6),P('hole.jpg',0,0),P('near.jpg',0,15),P('far.jpg',0,70),P('named.jpg',500,500)]};
let m=PP.matchParcel(set,[ring,hole],{});
assert.deepEqual(m.map(c=>[c.pt.name,c.how,Math.round(c.dist)]),[['in.jpg','inside',0],['hole.jpg','near',3],['near.jpg','near',5]]);
m=PP.matchParcel(set,[ring,hole],{'اسم الصورة':'NAMED.jpg'});assert.equal(m[0].pt.name,'named.jpg');assert.equal(m[0].how,'name');
ok('inside first, a point in a hole is outside, nearest within 40 m, a photo named in the parcel comes first');

// 4) real geodatabases (skipped when absent)
const list=(process.env.PP_GDBS||['G:/4_11_2026/4_11_2026/DB_4_11_2026.gdb','G:/DB_Abd_elaziz/New File Geodatabase.gdb'].join(';')).split(';').filter(d=>fs.existsSync(path.join(d,'a00000001.gdbtable')));
const source=dir=>({has:n=>fs.existsSync(path.join(dir,n)),size:n=>fs.statSync(path.join(dir,n)).size,
  read:async(n,s,e)=>{const fd=fs.openSync(path.join(dir,n),'r');try{const b=Buffer.alloc(Math.max(0,e-s)),r=fs.readSync(fd,b,0,b.length,s);return new Uint8Array(b.buffer,b.byteOffset,r)}finally{fs.closeSync(fd)}}});
(async()=>{
  if(!list.length)ok('no geodatabase on this computer: part 4 skipped');
  for(const dir of list){const t=Date.now(),set=await PP.pointsFromGdb(source(dir));
    assert.ok(set.points.length>0&&set.layers.length>=1,'points read');
    const names=set.points.map(p=>p.name).filter(Boolean);assert.equal(new Set(names.map(n=>n.toLowerCase())).size,names.length,'a photo kept once');
    if(set.attach)for(const p of [set.points[0],set.points[set.points.length>>1],set.points.at(-1)]){const a=await PP.attachmentOf(set,p);
      assert.ok(a&&a.bytes[0]===0xff&&a.bytes[1]===0xd8,'JPEG read from inside the .gdb for '+p.name);assert.equal(a.name.toLowerCase(),p.name.toLowerCase(),'the attachment of that point')}
    ok(`${path.basename(dir)}: ${set.layers.map(l=>l.name).join(' + ')} → ${set.points.length} points, ${set.attach?set.attach.count:0} attached photos (${Date.now()-t} ms)`)}
  console.log('ALL OK')})().catch(e=>{console.error(e);process.exit(1)});
