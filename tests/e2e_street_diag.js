'use strict';
/* Browser test of the street-link diagnostics of one edge (main planner, setbacks section):
   · the 3 nearest streets with their distance (from the edge middle and nearest point), angle and overlap
   · the reason of every refusal: far · direction · overlap · blocking parcel · behind the parcel itself
   · a dashed line on the map from the edge to every street, labelled with the distance
   · centre line / street boundary told apart when the road layer has a line-type field
   · a manual street choice (a confirmation when a parcel is in between), «no street», and back to automatic
   · nothing linked automatically when two streets are equally likely; the setback rules unchanged (front = width ÷ 5, 3…6 m)
   Synthetic cases built here (WGS84 GeoJSON); then road test.zip (ROAD_TEST_ZIP, default %USERPROFILE%/Downloads/road test.zip) if present.
   Needs playwright-core (NODE_PATH) and Chromium/Chrome (CHROME_PATH).  Run: node tests/e2e_street_diag.js */
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');const G=require('../street-geometry.js');
const ROOT=path.resolve(__dirname,'..');
function browserPath(){if(process.env.CHROME_PATH)return process.env.CHROME_PATH;const local=process.env.LOCALAPPDATA||'',c=[];
  try{for(const d of fs.readdirSync(path.join(local,'ms-playwright')).filter(d=>/^chromium-\d+$/.test(d)).sort().reverse())c.push(path.join(local,'ms-playwright',d,'chrome-win64','chrome.exe'))}catch(e){}
  c.push('C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe');return c.find(p=>fs.existsSync(p))}
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.geojson':'application/geo+json'};
const serve=dir=>new Promise(res=>{const srv=http.createServer((q,out)=>{const file=path.join(dir,decodeURIComponent(new URL(q.url,'http://x').pathname));
  if(!file.startsWith(dir)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){out.writeHead(404);out.end();return}
  out.writeHead(200,{'Content-Type':TYPES[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(file).pipe(out)});srv.listen(0,'127.0.0.1',()=>res(srv))});
const log=(...a)=>console.log('  ✓',...a);

/* each case in its own frame, 200 m apart; the parcel is 20 × 20 m at x −10…10, y 0…20; edge 1 is its south edge (y = 0) */
const LON0=46.60,LAT0=24.60,feats=[];let k=0;
function place(no,roads,extra=[],rp={}){const F=G.frame(LON0+(k++)*0.002,LAT0),ll=p=>F.toLL(p),ring=pts=>pts.map(ll).concat([ll(pts[0])]);
  feats.push({type:'Feature',properties:{PARCEL_NUM:no,SIDEDEFECT:'2',REARDEFECT:'2',FLOORSNO:'2'},geometry:{type:'Polygon',coordinates:[ring([{x:-10,y:0},{x:10,y:0},{x:10,y:20},{x:-10,y:20}])]}});
  extra.forEach(([n,pts])=>feats.push({type:'Feature',properties:{PARCEL_NUM:n,SIDEDEFECT:'2',REARDEFECT:'2'},geometry:{type:'Polygon',coordinates:[ring(pts)]}}));
  roads.forEach(([a,b,w,props={}])=>feats.push({type:'Feature',properties:{RoadWidth:String(w),...rp,...props},geometry:{type:'LineString',coordinates:[ll(a),ll(b)]}}))}
place('D-OK',[[{x:-14,y:-6},{x:14,y:-6},12,{LINE_TYPE:'محور'}]]);                                     // centre line 6 m south
place('D-FAR',[[{x:-14,y:-60},{x:14,y:-60},20,{LINE_TYPE:'محور'}]]);                                  // 60 m away
place('D-ANGLE',[[{x:-12,y:-14},{x:12,y:-2},12,{LINE_TYPE:'محور'}]]);                                  // ~27° … crossing direction: 45° below
place('D-OVERLAP',[[{x:8,y:-5},{x:16,y:-5},12,{LINE_TYPE:'محور'}]]);                                   // parallel, beside 2 m of the 20 m edge
place('D-BLOCK',[[{x:-14,y:-28},{x:14,y:-28},12,{LINE_TYPE:'محور'}]],[['D-BLOCKER',[{x:-10,y:-22},{x:10,y:-22},{x:10,y:-2},{x:-10,y:-2}]]]);
place('D-AMBIG',[[{x:-14,y:-6},{x:14,y:-6},12,{LINE_TYPE:'محور'}],[{x:-14,y:-6.4},{x:14,y:-6.4},20,{LINE_TYPE:'محور'}]]);
place('D-EDGE',[[{x:-14,y:-0.8},{x:14,y:-0.8},16,{LINE_TYPE:'حد الشارع'}]]);                           // street boundary line on the parcel boundary
// the angle case: replace its road by a line at 50° through the area south of the edge
feats.find(f=>f.properties.PARCEL_NUM==='D-ANGLE');

const PANEL=`(()=>{const b=document.getElementById('edgeDiag');return{hidden:b.hidden,text:b.innerText,rows:[...b.querySelectorAll('.diag-card')].map(c=>({ok:c.classList.contains('ok'),text:c.innerText})),
  lines:DIAG_LAYER?DIAG_LAYER.getLayers().filter(l=>l instanceof L.Polyline).length:0,labels:[...document.querySelectorAll('.mapdiag')].map(e=>e.textContent),out:DIAG_OUT&&DIAG_OUT.rows.map(r=>({ri:r.roadIndex,dist:r.dist,dMin:r.dMin,ok:r.ok,how:r.how,kind:r.kind,why:r.why.map(w=>w.k),blockedBy:r.blockedBy}))}})()`;
const VERTS=`S.verts.map(v=>({role:v.role,sb:v.sb,name:v.name,pick:v.streetPick??null}))`;

(async()=>{const exe=browserPath();assert.ok(exe,'no Chromium/Chrome/Edge found; set CHROME_PATH');
  const srv=await serve(ROOT),base=`http://127.0.0.1:${srv.address().port}/`,browser=await chromium.launch({executablePath:exe,headless:true});
  const errors=[],dialogs=[],tmp=fs.mkdtempSync(path.join(os.tmpdir(),'gis-diag-')),file=path.join(tmp,'diag.geojson');
  // the angle case: a road at 50° to the edge, crossing the area south of it
  {const i=feats.findIndex(f=>f.properties.PARCEL_NUM==='D-ANGLE'),c=feats[i].geometry.coordinates[0],lon=(c[0][0]+c[1][0])/2,F=G.frame(lon,LAT0),ll=p=>F.toLL(p);
    feats[i+1].geometry.coordinates=[ll({x:-10,y:-16}),ll({x:6,y:3.07})]}
  fs.writeFileSync(file,JSON.stringify({type:'FeatureCollection',features:feats}));
  let answer=true;
  try{const page=await (await browser.newContext({viewport:{width:1440,height:1000}})).newPage();page.on('pageerror',e=>errors.push(String(e)));
    page.on('dialog',d=>{dialogs.push(d.message());answer?d.accept():d.dismiss()});
    await page.goto(base+'index.html');await page.waitForFunction(()=>typeof compute==='function'&&window.polygonClipping);
    await page.evaluate(()=>new Promise(r=>{localStorage.clear();sessionStorage.clear();const q=indexedDB.deleteDatabase('gis-parcel-planner-final');q.onsuccess=q.onerror=q.onblocked=()=>r()}));
    await page.goto(base+'index.html');await page.waitForFunction(()=>typeof compute==='function'&&window.polygonClipping);
    await page.setInputFiles('#parcelFile',file);await page.waitForFunction(()=>PARCELS.length===8&&ROADS.length===8&&CUR_PC,null,{timeout:20000});
    assert.equal(await page.evaluate(()=>ROAD_FIELDS.type),'LINE_TYPE');log('road layer: width field RoadWidth, line-type field LINE_TYPE detected');
    const open=async no=>{const id=await page.evaluate(n=>PARCELS.find(p=>p.no===n).stableId,no);await page.selectOption('#parcelSel',id);
      await page.waitForFunction(i=>CUR_PC&&CUR_PC.stableId===i&&BLD_OUT&&BLD_OUT.parcel===i,id,{timeout:20000});await page.keyboard.press('Escape');
      await page.waitForFunction(()=>document.getElementById('bldModal').hidden);await page.evaluate(()=>setView('map'))};
    // the parcel's south edge (y = 0): the edge whose two vertices have the smallest y
    const south=()=>page.evaluate(()=>{let b=0,by=1e9;S.verts.forEach((v,i)=>{const w=S.verts[(i+1)%S.verts.length],y=(+v.y)+(+w.y);if(y<by){by=y;b=i}});return b});
    const diag=async no=>{await open(no);const e=await south();await page.click(`#sbody tr[data-edge="${e}"] .en`);await page.waitForFunction(()=>!document.getElementById('edgeDiag').hidden);return{e,p:await page.evaluate(PANEL)}};

    console.log('Linked, far, direction, overlap, blocked');
    let {e,p}=await diag('D-OK');let v=await page.evaluate(VERTS);
    assert.equal(v[e].role,'front');assert.equal(v[e].sb,3,'12 m street → 3 m (rule unchanged)');assert.ok(p.out[0].ok);assert.equal(p.out[0].how,'centre');assert.equal(p.out[0].kind,'centre');
    assert.ok(Math.abs(p.out[0].dist-6)<0.05,'distance 6 m');assert.match(p.text,/محور شارع \(من البيانات\)/);assert.match(p.text,/مقبول \(محور\)/);
    assert.ok(p.lines>=1&&p.labels.some(t=>/^6(\.0)? م$/.test(t)),'dashed line labelled 6 م on the map: '+p.labels.join(','));
    log(`D-OK: linked, 6.0 m, «محور شارع (من البيانات)», front 3 m; map line «${p.labels[0]}»`);
    ({e,p}=await diag('D-FAR'));v=await page.evaluate(VERTS);assert.notEqual(v[e].role,'front','a far street is not linked');
    assert.deepEqual(p.out[0].why,['far']);assert.match(p.text,/بعيد \(60(\.0)? م > 34 م\)/);log('D-FAR: «بعيد (60 م > 34 م)», not linked');
    ({e,p}=await diag('D-ANGLE'));v=await page.evaluate(VERTS);assert.notEqual(v[e].role,'front');assert.ok(p.out[0].why.includes('angle'),'direction: '+p.out[0].why);assert.match(p.text,/اختلاف اتجاه 50°/);
    log('D-ANGLE: «اختلاف اتجاه 50°», not linked');
    ({e,p}=await diag('D-OVERLAP'));v=await page.evaluate(VERTS);assert.notEqual(v[e].role,'front');assert.deepEqual(p.out[0].why,['overlap']);assert.match(p.text,/تداخل غير كافٍ/);
    log('D-OVERLAP: «تداخل غير كافٍ», not linked');
    ({e,p}=await diag('D-BLOCK'));v=await page.evaluate(VERTS);assert.notEqual(v[e].role,'front');assert.ok(p.out[0].why.includes('blocked'));assert.equal(p.out[0].blockedBy,'D-BLOCKER');
    assert.match(p.text,/قطعة حاجزة: D-BLOCKER/);log('D-BLOCK: «قطعة حاجزة: D-BLOCKER», not linked');

    console.log('Manual choice');
    answer=false;dialogs.length=0;await page.click(`#edgeDiag [data-dpick="${p.out[0].ri}"]`);await page.waitForTimeout(300);
    assert.ok(dialogs.some(d=>/تحذير: القطعة D-BLOCKER تقع بين الضلع/.test(d)),'warning before linking across a parcel');v=await page.evaluate(VERTS);assert.notEqual(v[e].role,'front','refused → unchanged');
    answer=true;await page.click(`#edgeDiag [data-dpick="${p.out[0].ri}"]`);await page.waitForTimeout(300);v=await page.evaluate(VERTS);
    assert.equal(v[e].role,'front');assert.equal(v[e].sb,3,'manual street: same rule, 3 m');assert.equal(v[e].pick,p.out[0].ri);
    const opp=v.findIndex((x,i)=>i!==e&&x.role==='rear');assert.ok(opp>=0,'the opposite edge becomes the rear');
    p=await page.evaluate(PANEL);assert.match(p.text,/اختيار يدوي/);
    log('a blocking parcel asks first (refusal leaves it as is); accepted → front 3 m, opposite edge rear, «اختيار يدوي»');
    await open('D-OK');await open('D-BLOCK');v=await page.evaluate(VERTS);assert.equal(v[e].pick,p.out[0].ri,'kept with the parcel');assert.equal(v[e].role,'front');
    await page.click(`#sbody tr[data-edge="${e}"] .en`);await page.click('#edgeDiag [data-dpick="auto"]');await page.waitForTimeout(300);v=await page.evaluate(VERTS);
    assert.equal(v[e].pick,null);assert.notEqual(v[e].role,'front','back to automatic: not linked');
    ({e,p}=await diag('D-OK'));await page.click('#edgeDiag [data-dpick="-1"]');await page.waitForTimeout(300);v=await page.evaluate(VERTS);
    assert.notEqual(v[e].role,'front','«هذا الضلع بدون شارع»');assert.equal(v[e].pick,-1);await page.click('#edgeDiag [data-dpick="auto"]');await page.waitForTimeout(300);
    assert.equal((await page.evaluate(VERTS))[e].role,'front');
    log('the choice is kept with the parcel; «إلغاء الاختيار اليدوي» and «هذا الضلع بدون شارع» work');

    console.log('Uncertain link, boundary line');
    ({e,p}=await diag('D-AMBIG'));v=await page.evaluate(VERTS);assert.notEqual(v[e].role,'front','two equally likely streets → not linked');
    assert.match(p.text,/شارعان متقاربان بنفس الدرجة — لم يُربط تلقائيًا/);assert.match(await page.evaluate(()=>document.getElementById('roadSbInfo').innerText+''),/./);
    log('D-AMBIG: two streets 0.4 m apart → not linked automatically, «شارعان متقاربان» shown');
    ({e,p}=await diag('D-EDGE'));v=await page.evaluate(VERTS);assert.equal(v[e].role,'front');assert.equal(v[e].sb,3.2,'16 m → 3.2 m');assert.equal(p.out[0].kind,'edge');assert.match(p.text,/حد شارع \(من البيانات\)/);
    assert.match(p.text,/مقبول \(خط على حد القطعة\)/);log('D-EDGE: «حد شارع (من البيانات)», linked as a boundary line, front 3.2 m');

    // ---------- road test.zip ----------
    const zip=process.env.ROAD_TEST_ZIP||path.join(os.homedir(),'Downloads','road test.zip');
    if(fs.existsSync(zip)){console.log('road test.zip');
      await page.evaluate(()=>new Promise(r=>{localStorage.clear();const q=indexedDB.deleteDatabase('gis-parcel-planner-final');q.onsuccess=q.onerror=q.onblocked=()=>r()}));
      await page.goto(base+'index.html');await page.waitForFunction(()=>typeof compute==='function'&&window.polygonClipping);
      await page.setInputFiles('#parcelFile',zip);await page.waitForFunction(()=>CUR_PC&&ROADS.length>0&&PARCELS.some(p=>p.no==='101/5'),null,{timeout:30000});
      const which=no=>page.evaluate(n=>{const pc=PARCELS.find(p=>p.no===n),r=pcWgs(pc);let best=null;r.forEach((_,i)=>{const d=diagnoseEdge(r,i,pc),x=d&&d.rows[0];if(x&&(!best||x.dMin<best.dMin))best={i,dMin:x.dMin,dist:x.dist,why:x.why.map(w=>w.k),ok:x.ok}});return best},no);
      const a=await which('101/5'),b=await which('100'),c=await which('21');
      assert.ok(a.dMin<1&&a.why.includes('overlap')&&!a.ok,'101/5: line on its boundary beside only part of the edge → overlap');
      assert.ok(b.why.includes('blocked'),'100: a parcel in between');assert.ok(c.dMin>80&&c.why.includes('far'),'21: no street near it');
      log(`101/5: nearest line ${a.dMin.toFixed(1)} m but «تداخل غير كافٍ»; 100: «قطعة حاجزة»; 21: nearest ${c.dMin.toFixed(0)} m «بعيد»`);
      await open('101/5');const ed=await page.evaluate(()=>{const r=curRingLL();let b=0,bd=1e9;r.forEach((_,i)=>{const d=diagnoseEdge(r,i,CUR_PC),x=d&&d.rows[0];if(x&&x.dMin<bd){bd=x.dMin;b=i}});return b});
      await page.click(`#sbody tr[data-edge="${ed}"] .en`);const pz=await page.evaluate(PANEL);assert.ok(!pz.out[0].ok);dialogs.length=0;
      await page.click(`#edgeDiag [data-dpick="${pz.out[0].ri}"]`);await page.waitForTimeout(300);const vz=await page.evaluate(VERTS);
      assert.equal(vz[ed].role,'front');assert.equal(vz[ed].sb,3,'12 m street → 3 m');assert.equal(dialogs.length,0,'no blocking parcel → no warning');
      log(`101/5 edge ${ed+1}: linked by hand → front 3 m, other edges ${vz.filter((_,i)=>i!==ed).map(x=>x.role+' '+x.sb).join(' · ')}`);
      // a «مزيد» record that found no street on an edge (it reads centre lines only) does not cancel the street layer's link there;
      // a decision taken in «مزيد» (a strong match left unapproved) still does
      await open('122');
      const form=(base,at,row)=>page.evaluate(async([base,at,row])=>{const id=CUR_PC.stableId,TE=txEdgeList(M);
        await ParcelStore.putRecord('street-result:id:'+id,{parcelId:id,at:Date.now(),rows:TE.map((e,i)=>({key:e.pkey,...base,...(i===at?row:{})}))});
        await txLoadStreetRecord(CUR_PC,M);const T=txData(compute());return{sb:T.edges.map(e=>e.sb),street:T.edges.map(e=>!!e.street)}},[base,at,row]);
      const pv=await page.evaluate(()=>S.verts.map(v=>({role:v.role,sb:v.sb,src:v.nameSrc}))),fi=pv.findIndex(v=>v.role==='front');
      assert.ok(fi>=0&&pv[fi].src==='auto','122: front edge linked from the street layer');
      const unmatched={status:'غير مرتبط',accepted:false,name:'',sbSource:'custom',sb:2,face:'side'};
      const f1=await form(unmatched,-1,{});
      assert.equal(f1.sb[fi],pv[fi].sb,'unmatched in «مزيد» → street layer setback kept');assert.ok(f1.street[fi],'street still drawn');
      const f2=await form(unmatched,fi,{status:'مطابقة قوية',name:'شارع س',accepted:false,sbSource:'custom',sb:3,face:'front'});
      assert.ok(!f2.street[fi],'strong match left unapproved in «مزيد» → that decision wins');
      log(`122: «مزيد» found no street on edge ${fi+1} → form keeps the street layer's front ${pv[fi].sb} m; an unapproved strong match in «مزيد» still overrides it`);
      // reference form: street names / setbacks per edge = the planner; the rear card says «لا يوجد» only when named street edges
      // with a setback face opposite sides (118: streets all round); a parcel with a rear edge (91) shows its value
      const card=async no=>{await open(no);return page.evaluate(async()=>{S.tx.style='ref';const T0=[],f=CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText=function(t,...r){T0.push(String(t));return f.call(this,t,...r)};
        try{await txOpen(false);await new Promise(r=>setTimeout(r,600))}finally{CanvasRenderingContext2D.prototype.fillText=f}
        const T=txData(compute());document.getElementById('bldModal').hidden=true;
        return{texts:T0,plan:S.verts.map(v=>[v.role,v.name||'',v.sb]),form:T.edges.filter(e=>e.main).map(e=>[e.face,e.name||'',e.sb])}})};
      const c118=await card('118');assert.deepEqual(c118.form,c118.plan,'118: names / setbacks on the form = planner');
      assert.ok(c118.texts.includes('(شارع من الأمام والخلف)'),'118: no rear edge, streets on opposite sides');
      assert.ok(c118.texts.includes('الإجمالية (م٢)')&&c118.texts.includes('--'),'118: gross floor area card shows «--»');
      const c91=await card('91');assert.deepEqual(c91.form,c91.plan,'91: names / setbacks on the form = planner');
      assert.ok(!c91.texts.includes('(شارع من الأمام والخلف)'),'91: has a rear edge → its setback, not «لا يوجد»');
      log('reference form: 118 (streets all round) → rear «لا يوجد (شارع من الأمام والخلف)»; 91 keeps its rear value; names / setbacks = planner');
      // street width after a road name on the form («شارع 12 م» already says it, so it is not repeated)
      assert.ok(c118.texts.includes('شارع 12 م')&&!c118.texts.some(t=>t.includes('(عرض')),'a name with its width is not repeated');
      await page.evaluate(()=>{ROAD_FIELDS.name=ROAD_FIELDS.name||'name';ROADS.forEach(rd=>{if(roadWidthOf(rd)===12)rd.properties[ROAD_FIELDS.name]='طريق تجريبي'})});
      await open('118');await page.evaluate(()=>{autoStreetSetbacks(false);S.verts.forEach(v=>{delete v.stW})});
      const cw=await page.evaluate(async()=>{const T0=[],f=CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText=function(t,...r){T0.push(String(t));return f.call(this,t,...r)};
        try{await txOpen(false);await new Promise(r=>setTimeout(r,600))}finally{CanvasRenderingContext2D.prototype.fillText=f}
        document.getElementById('bldModal').hidden=true;return T0});
      assert.ok(cw.includes('طريق تجريبي (عرض 12 م)'),'street width written after the road name');
      // a name written differently from the road layer (shortened / typed): the width of the road matched on that edge
      const cw2=await page.evaluate(async()=>{S.verts.forEach(v=>{if(v.name==='طريق تجريبي')v.name='طريق مختصر'});const T0=[],f=CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText=function(t,...r){T0.push(String(t));return f.call(this,t,...r)};
        try{await txOpen(false);await new Promise(r=>setTimeout(r,600))}finally{CanvasRenderingContext2D.prototype.fillText=f}
        document.getElementById('bldModal').hidden=true;return T0});
      assert.ok(cw2.includes('طريق مختصر (عرض 12 م)'),'width of the matched road even when the name differs');
      await page.evaluate(()=>{ROADS.forEach(rd=>{if(rd.properties[ROAD_FIELDS.name]==='طريق تجريبي')rd.properties[ROAD_FIELDS.name]=''})});
      log('form: road name followed by its width «طريق تجريبي (عرض 12 م)»; «شارع 12 م» not repeated')}
    else console.log('  · road test.zip not found: real-data checks skipped');
    assert.deepEqual(errors,[],errors.join(' | '));console.log('e2e_street_diag: all checks passed')}
  finally{await browser.close();srv.close();fs.rmSync(tmp,{recursive:true,force:true})}})().catch(e=>{console.error(e);process.exit(1)});
