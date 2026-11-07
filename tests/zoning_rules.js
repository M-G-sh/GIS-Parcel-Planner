'use strict';
/* Unit tests of zoning-rules.js (الاشتراطات التنظيمية): the regulatory calculation shared by the main page and «مزيد».
   Run: node tests/zoning_rules.js */
const assert=require('node:assert/strict'),path=require('node:path');
const Z=require(path.join(__dirname,'..','zoning-rules.js'));
const near=(a,b,msg,eps=1e-6)=>assert.ok(Math.abs(a-b)<=eps,`${msg}: ${a} ≠ ${b}`);
let n=0;const ok=msg=>{n++;console.log('  ✓ '+msg)};
const full={zUse:'residential',ratio:'60',floors:'3',far:'',zRef:'دليل اشتراطات البناء — قرار 123',zRefDate:'1446/05/12هـ',zStatus:'approved'};
const run=(tx,A,G,gState='ok',extra={})=>{const R=Z.readRegs(tx);return Z.compute({A,G,gState,regs:R,approval:Z.approval(R,extra.ctx||{}),...extra})};

// numbers as typed (Arabic digits, separators, percent)
assert.equal(Z.num('٦٠'),60);assert.equal(Z.num('60%'),60);assert.equal(Z.num('٦٠٪'),60);assert.equal(Z.num('1,200'),1200);assert.equal(Z.num('2٫5'),2.5);
assert.equal(Z.num('abc'),null);assert.equal(Z.num(''),null);assert.equal(Z.num(null),null);ok('numbers: Arabic digits, ٫ decimal, thousands separator, % sign; text → null');
assert.equal(Z.classifyUse('سكني'),'residential');assert.equal(Z.classifyUse('سكني تجاري'),'mixed');assert.equal(Z.classifyUse('تجاري'),'commercial');assert.equal(Z.classifyUse('جامع'),'mosque');
assert.equal(Z.classifyUse('مرافق تعليمية'),'public');assert.equal(Z.classifyUse('زراعي'),'other');assert.equal(Z.classifyUse(''),'');ok('land-use text → class (unknown text = «غير ذلك», empty = غير محدد)');
assert.equal(Z.classifyStatus('معتمد'),'approved');assert.equal(Z.classifyStatus('غير معتمد'),'unverified');assert.equal(Z.classifyStatus('قيد المراجعة'),'review');assert.equal(Z.classifyStatus(''),'');
ok('approval status text: «غير معتمد» is never read as «معتمد»');

// 1) setbacks bind: 1200 m² land, 600 m² inside the setbacks, coverage 60 % = 720 m²
let r=run({...full,far:'1.2'},1200,600);
near(r.covLimit,720,'coverage limit');near(r.footprint,600,'footprint');assert.equal(r.binding,'setback');near(r.byFloors,1800,'floors × footprint');near(r.byFar,1440,'FAR × land');
near(r.gross,1440,'gross = min');assert.equal(r.grossBind,'far');assert.equal(r.grossState,'ok');near(r.nbTotal,600,'not buildable');assert.deepEqual(r.nb.map(x=>x.k),['setback']);assert.ok(r.approved&&r.footApproved&&r.grossApproved);
ok('setbacks bind: footprint 600 = min(600, 720); gross 1440 = min(600×3, 1.2×1200); not buildable 600 (setbacks)');
// 2) coverage binds: 936 m² inside the setbacks, 720 m² allowed
r=run(full,1200,936);near(r.footprint,720,'footprint');assert.equal(r.binding,'coverage');near(r.nb.find(x=>x.k==='setback').area,264,'setback band');near(r.nb.find(x=>x.k==='coverage').area,216,'beyond coverage');
near(r.nbTotal,480,'not buildable');near(r.gross,2160,'gross by floors');assert.equal(r.grossState,'far-missing','FAR unknown → gross provisional');assert.ok(!r.grossApproved);
ok('coverage binds: footprint 720 = min(936, 720); not buildable 264 (setbacks) + 216 (coverage) = 480; FAR unknown → gross 2160 provisional');
r=run({...full,farNA:true},1200,936);assert.equal(r.grossState,'ok');near(r.gross,2160,'gross');ok('«FAR غير مطبق»: gross = footprint × floors, approved');
// 3) coverage missing: no regulatory footprint, only the geometric bound
r=run({...full,ratio:''},1200,936);assert.equal(r.footprint,null);assert.equal(r.footState,'geo-only');assert.equal(r.covPct,null);
let t=Z.texts(r,(v,d=2)=>v.toFixed(d));assert.ok(t.cov===Z.MISSING&&t.foot.startsWith(Z.MISSING));assert.equal(r.gross,null);assert.equal(t.gross,Z.MISSING);
ok('coverage missing: «الاشتراط غير محدد» for coverage, footprint and gross; no number shown as a regulatory area');
r=run({...full,ratio:'',far:'2'},1200,936);assert.equal(r.gross,2400);assert.equal(r.grossState,'footprint-missing');ok('FAR alone: gross 2400 marked as FAR only (footprint unknown)');
r=run({...full,ratio:'0'},1200,936);assert.equal(r.covPct,null);assert.ok(Z.readRegs({ratio:'0'}).coverageBad);r=run({...full,ratio:'130'},1200,936);assert.equal(r.covPct,null);
assert.ok(Z.readRegs({floors:'2.5'}).floorsBad);ok('invalid values (0 %, 130 %, 2.5 floors) are flagged and treated as missing');
// 4) setbacks unknown / provisional
r=run(full,1200,null,'none');assert.equal(r.G,null);assert.equal(r.footprint,null);assert.equal(r.footState,'geo-unknown');near(r.covLimit,720,'coverage limit still shown');assert.equal(r.nbTotal,null);
r=run(full,1200,936,'partial');near(r.footprint,720,'footprint');assert.equal(r.footState,'partial');assert.ok(!r.footApproved);assert.equal(r.grossState,'far-missing');
ok('setbacks unknown → no footprint; partly unknown → provisional footprint, not approved');
// 5) documented exceptions count only with a reference; floor-area exceptions are never added to the gross
r=run({...full,zExc:[{kind:'cover',area:'20',desc:'غرفة حارس',ref:'المادة 5'},{kind:'cover',area:'50',desc:'مظلة',ref:''},{kind:'gross',area:'300',desc:'قبو',ref:'المادة 9'}]},1200,936);
near(r.covEx,20,'coverage exception');near(r.covTotal,740,'720 + 20');near(r.footprint,740,'footprint');near(r.grossEx,300,'gross exception');near(r.gross,2220,'gross without the exception');
assert.deepEqual(r.regs.exc.map(e=>e.counted),[true,false,true]);ok('exceptions: 20 m² with reference counted (limit 740), 50 m² without reference ignored, 300 m² basement shown apart');
// 6) approval needs use, reference, status «معتمد» and a matching rule
const why=tx=>Z.approval(Z.readRegs(tx)).reasons.join('|');
assert.match(why({...full,zRef:''}),/مرجع/);assert.match(why({...full,zStatus:'review'}),/قيد المراجعة/);assert.match(why({...full,zUse:''}),/الاستخدام/);assert.equal(why(full),'');
ok('approval: no reference / «قيد المراجعة» / no land use → «غير معتمد» with the reason');
// 7) mosque program against the limit (the program itself is not changed)
r=run(full,1200,600,'ok',{roofed:650});assert.equal(r.mosque.ok,false);near(r.mosque.over,50,'over');r=run(full,1200,600,'ok',{roofed:420});assert.equal(r.mosque.ok,true);
ok('mosque program: roofed 650 > 600 flagged (over 50), 420 within the limit');
// 8) holes are outside the land area and listed as such
r=run(full,1100,700,'ok',{holesArea:100});assert.ok(r.nb.find(x=>x.k==='holes').outside);near(r.nbTotal,1100-660,'land − footprint');ok('holes: listed apart («خارج مساحة الأرض أصلًا»), not counted twice');

// rules by land use and area, each with its source
const site={city:'الرياض',amana:'أمانة منطقة الرياض',municipality:'بلدية العليا',district:'حي الروضة',planNo:'1234'};
let mk=Z.makeRule({...full,zRef:''},site,'district','');assert.equal(mk.rule,null);assert.match(mk.errors.join(' '),/المرجع/);
mk=Z.makeRule({...full,zUse:''},site,'district','');assert.match(mk.errors.join(' '),/تصنيف/);
mk=Z.makeRule(full,{...site,district:''},'district','');assert.match(mk.errors.join(' '),/الحي غير محدد/);
mk=Z.makeRule(full,site,'district','',new Date('2026-11-07T10:00:00Z'));assert.ok(mk.rule);const rule=mk.rule;
assert.deepEqual(rule.scope,{city:'الرياض',amana:'أمانة منطقة الرياض',municipality:'بلدية العليا',district:'حي الروضة'});assert.equal(rule.values.ratio,'60');assert.equal(rule.values.zRef,full.zRef);
ok('a rule is refused without reference, land use or the chosen area; saved with its scope up to «الحي»');
assert.ok(Z.matchRule(rule,{...site,district:'حي  الروضه',planNo:'999'},'residential').ok,'normalised text, other plan in the same district');
let m=Z.matchRule(rule,{...site,district:'حي النرجس'},'residential');assert.ok(!m.ok);assert.deepEqual(m.why,['الحي']);
m=Z.matchRule(rule,site,'commercial');assert.deepEqual(m.why,['الاستخدام']);
m=Z.matchRule(rule,{...site,district:''},'residential');assert.ok(!m.ok,'unknown district never matches');
ok('rule matching: same use and area (ة/ه, extra spaces ignored); another district, another use or an unknown district → no match');
const city=Z.makeRule({...full,ratio:'50'},site,'city','',new Date('2026-11-07T10:00:00Z')).rule,plan=Z.makeRule({...full,ratio:'55'},site,'planNo','',new Date('2026-11-07T10:00:00Z')).rule;
assert.equal(Z.autoRule([city,rule,plan],site,'residential').id,plan.id,'most specific first');assert.equal(Z.autoRule([city,{...city,id:'x'}],site,'residential'),null,'tie → user decides');
assert.equal(Z.autoRule([rule],{...site,district:'حي النرجس'},'residential'),null);ok('automatic rule: the most specific match; a tie or no match applies nothing');
const tx={zSrc:{ratio:'',floors:'',zRef:'',zStatus:''}};Z.applyRule(rule,tx);assert.equal(tx.ratio,'60');assert.equal(tx.zRef,full.zRef);assert.equal(tx.zRule,rule.id);assert.equal(tx.zSrc.ratio,'rule');
ok('applying a rule copies its values, reference and status, and marks their source «قاعدة»');
const mem={v:{},getItem(k){return this.v[k]??null},setItem(k,v){this.v[k]=String(v)}};assert.ok(Z.saveRules([rule,plan],mem));assert.equal(Z.loadRules(mem).length,2);
mem.v[Z.RULES_KEY]='not json';assert.deepEqual(Z.loadRules(mem),[]);ok('rules stored and read back; damaged storage reads as no rules');
console.log(`zoning_rules: ${n} checks passed`);
