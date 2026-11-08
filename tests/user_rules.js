'use strict';
/* User rules («قواعد المستخدم», supplied by the user — not official requirements), pure calculations of zoning-rules.js:
     front = street width ÷ 5, at least 3 m and at most 6 m; no width → none (no guessed width)
     side / rear from the parcel's field: empty / missing → 0 undocumented, explicit 0 → 0 documented
     ground floor = 65 % of the land, each upper floor = 75 % of the land, both never beyond the buildable zone
     total floor area = ground + upper × (floors − 1)
   Run: node tests/user_rules.js */
const assert=require('node:assert/strict'),Z=require('../zoning-rules.js');
const near=(a,b,msg)=>assert.ok(Math.abs(a-b)<1e-9,`${msg}: ${a} vs ${b}`);
let n=0;const ok=m=>{n++;console.log('  ✓',m)};

// 1 · front setback
const want={10:3,15:3,20:4,25:5,30:6,40:6};
for(const [w,sb] of Object.entries(want))assert.equal(Z.userFront(+w),sb,`street ${w} m`);
assert.equal(Z.userFront(12),3);assert.equal(Z.userFront(16),3.2);assert.equal(Z.userFront('٢٠'),4,'Arabic digits');
for(const w of [null,undefined,'','abc',0,-5])assert.equal(Z.userFront(w),null,`no width (${w}) → no setback`);
ok('front = width ÷ 5 within 3…6 m: 10→3 · 15→3 · 20→4 · 25→5 · 30→6 · 40→6; no width → not calculated');
assert.equal(Z.userFront(20,{div:4,min:2,max:8}),5,'editable divisor');assert.equal(Z.userFront(50,{div:5,min:3,max:8}),8,'editable maximum');
ok('front rule parameters are editable');

// 2 · side / rear fields
assert.deepEqual(Z.userEdgeSb(''),{sb:0,documented:false});assert.deepEqual(Z.userEdgeSb(null),{sb:0,documented:false});assert.deepEqual(Z.userEdgeSb(undefined),{sb:0,documented:false});
assert.deepEqual(Z.userEdgeSb('0'),{sb:0,documented:true});assert.deepEqual(Z.userEdgeSb(0),{sb:0,documented:true});
assert.deepEqual(Z.userEdgeSb('2'),{sb:2,documented:true});assert.deepEqual(Z.userEdgeSb('1.5'),{sb:1.5,documented:true});
ok('empty / missing field → 0 m undocumented; explicit 0 → 0 m documented; values kept');

// 3 · ground and upper floors for 500 / 1000 / 2000 m², with the buildable zone G binding or not
const regs=(o={})=>Z.readRegs({ratio:'65',upRatio:'75',floors:'2',...o});
for(const A of [500,1000,2000]){
  // a generous zone (G ≥ 75 %): both ratios bind
  let c=Z.compute({A,G:A*0.9,regs:regs()});near(c.footprint,A*0.65,`${A} ground`);near(c.upper,A*0.75,`${A} upper`);near(c.gross,A*0.65+A*0.75,`${A} total`);
  assert.equal(c.binding,'coverage');assert.equal(c.upBinding,'ratio');near(c.covLimit,A*0.65,'theoretical ground');near(c.upLimit,A*0.75,'theoretical upper');
  // a tight zone (G < 65 %): the setbacks bind both floors — no projection beyond the buildable zone
  c=Z.compute({A,G:A*0.5,regs:regs()});near(c.footprint,A*0.5,`${A} ground (zone)`);near(c.upper,A*0.5,`${A} upper capped by the zone`);assert.equal(c.upBinding,'setback');near(c.gross,A,`${A} total`);
  // between: ground by ratio, upper by the zone
  c=Z.compute({A,G:A*0.7,regs:regs()});near(c.footprint,A*0.65,'ground');near(c.upper,A*0.7,'upper limited by the zone');
}
ok('500 / 1000 / 2000 m²: ground = min(zone, 65 %), upper = min(zone, 75 %), theoretical and actual kept apart');

// 4 · floors and missing data
let c=Z.compute({A:1000,G:900,regs:regs({floors:'3'})});near(c.gross,650+750*2,'3 floors');
c=Z.compute({A:1000,G:900,regs:regs({floors:'1'})});near(c.gross,650,'1 floor = ground only');
c=Z.compute({A:1000,G:900,regs:regs({floors:''})});assert.equal(c.gross,null,'floors unknown → total not shown');near(c.upper,750,'upper still known');
c=Z.compute({A:1000,G:null,gState:'none',regs:regs()});assert.equal(c.footprint,null);assert.equal(c.upper,null);assert.equal(c.upState,'geo-unknown');assert.equal(c.gross,null);
c=Z.compute({A:1000,G:600,gState:'partial',regs:regs()});assert.equal(c.upState,'partial');assert.equal(c.footState,'partial');assert.equal(c.grossState,'far-missing','existing rule: FAR not given');
c=Z.compute({A:1000,G:900,regs:regs({far:'1.2'})});near(c.gross,1200,'FAR still caps the total when given');
c=Z.compute({A:1000,G:900,regs:Z.readRegs({ratio:'60',floors:'2'})});near(c.gross,1200,'without an upper ratio: footprint × floors as before');assert.equal(c.upper,null);
assert.equal(Z.readRegs({upRatio:'130'}).upperBad,true,'130 % refused');
ok('total = ground + upper × (floors − 1); unknown floors / setbacks → not shown; FAR and the previous rule unchanged');

// 5 · texts
const t=Z.texts(Z.compute({A:1000,G:700,regs:regs()}),(v,d)=>v.toFixed(d));
assert.match(t.upper,/700\.00 م² \(75٪ × الأرض = 750\.00 م²؛ محدود بمنطقة البناء\)/);assert.match(t.gross,/أرضي \+ علوي × 1/);
ok('texts: upper floor with its theoretical limit, total described as ground + upper');
assert.deepEqual(Z.userCfg(),{on:true,div:5,min:3,max:6,ground:65,upper:75});ok('defaults: ÷5 · 3…6 m · 65 % · 75 %');
console.log(`user_rules: ${n} checks passed`);
