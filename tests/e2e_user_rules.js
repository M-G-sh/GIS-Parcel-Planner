'use strict';
/* Browser test of the user rules («قواعد المستخدم» — supplied by the user, not official requirements) on the main planner:
     front = street width ÷ 5 within 3…6 m (from the roads' width field) · side / rear from SIDEDEFECT / REARDEFECT
     (empty or missing → 0 undocumented, explicit 0 → 0) · ground floor 65 %, each upper floor 75 % of the land, inside the
     buildable zone · total = ground + upper × (floors − 1) · BUILD_RATI is not used in their place.
   Synthetic data built here (WGS84 GeoJSON, parcels and roads in one file, imported like a user's file):
     streets 10 / 15 / 20 / 25 / 30 / 40 m beside parcels of 500 / 1000 / 2000 m², empty / zero / missing side-rear fields,
     a street without width, and a MultiPolygon (two parts, a hole in the main part).
   Checks for every parcel, by clicking it on the map: the setback of every edge, area, area inside the setbacks, ground / upper /
   total floor area against values computed by hand; the same figures in the panel, on the main sheet, in the transaction form
   and on its canvas (the PNG / PDF image); warnings for undocumented values and missing width; manual edits kept;
   the whole-plan analysis equal to the planner for every parcel; results kept after a reload.
   Needs playwright-core (NODE_PATH) and Chromium/Chrome (CHROME_PATH).  Run: node tests/e2e_user_rules.js */
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');const G=require('../street-geometry.js');
const ROOT=path.resolve(__dirname,'..');
function browserPath(){if(process.env.CHROME_PATH)return process.env.CHROME_PATH;const local=process.env.LOCALAPPDATA||'',c=[];
  try{for(const d of fs.readdirSync(path.join(local,'ms-playwright')).filter(d=>/^chromium-\d+$/.test(d)).sort().reverse())c.push(path.join(local,'ms-playwright',d,'chrome-win64','chrome.exe'))}catch(e){}
  c.push('C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe');return c.find(p=>fs.existsSync(p))}
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.geojson':'application/geo+json'};
const serve=dir=>new Promise(res=>{const srv=http.createServer((q,out)=>{const file=path.join(dir,decodeURIComponent(new URL(q.url,'http://x').pathname));
  if(!file.startsWith(dir)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){out.writeHead(404);out.end();return}
  out.writeHead(200,{'Content-Type':TYPES[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(file).pipe(out)});srv.listen(0,'127.0.0.1',()=>res(srv))});
const log=(...a)=>console.log('  ✓',...a),near=(a,b,eps,msg)=>assert.ok(a!==null&&b!==null&&Math.abs(a-b)<=eps,`${msg}: ${a} vs ${b}`);

/* ---------- fixture: each parcel in its own local frame (metres), 120 m apart; its street to the south ----------
   X = frontage (east–west), Y = depth; the street centre line runs at y = −width/2 along the frontage. */
const LON0=46.70,LAT0=24.70;
const CASES=[
  {no:'W10-500',X:20,Y:25,w:10,side:'2',rear:'2'},{no:'W15-1000',X:25,Y:40,w:15,side:'2',rear:'2'},{no:'W20-2000',X:40,Y:50,w:20,side:'2',rear:'2'},
  {no:'W25-1000',X:25,Y:40,w:25,side:'2',rear:'2'},{no:'W30-500',X:20,Y:25,w:30,side:'2',rear:'2'},{no:'W40-2000',X:40,Y:50,w:40,side:'2',rear:'2'},
  {no:'W20-500-EMPTY',X:20,Y:25,w:20,side:'',rear:''},{no:'W20-1000-ZERO',X:25,Y:40,w:20,side:'0',rear:'0'},{no:'W15-2000-NOFIELD',X:40,Y:50,w:15,side:null,rear:null},
  {no:'NOWIDTH-1000',X:25,Y:40,w:null,side:'2',rear:'2'},{no:'MULTI',multi:true,w:20,side:'2',rear:'2'}];
const front=w=>w===null?null:Math.min(6,Math.max(3,w/5));
function fixture(){const feats=[];
  CASES.forEach((c,i)=>{const lon=LON0+i*0.0012,F=G.frame(lon,LAT0),ll=p=>F.toLL(p),ring=pts=>pts.map(ll).concat([ll(pts[0])]);
    const props={PARCEL_NUM:c.no,BUILD_RATI:'60',FLOORSNO:'2',LANDUSE_DE:'سكنى'};if(c.side!==null){props.SIDEDEFECT=c.side;props.REARDEFECT=c.rear}c.lon=lon;
    if(c.multi){// part 1: 30 × 40 with a 6 × 6 hole in the middle; part 2: 10 × 10, 5 m east of it — both on the same street
      const p1=[{x:-20,y:0},{x:10,y:0},{x:10,y:40},{x:-20,y:40}],h=[{x:-8,y:17},{x:-8,y:23},{x:-2,y:23},{x:-2,y:17}],p2=[{x:15,y:0},{x:25,y:0},{x:25,y:10},{x:15,y:10}];
      feats.push({type:'Feature',properties:props,geometry:{type:'MultiPolygon',coordinates:[[ring(p1),ring(h)],[ring(p2)]]}});
      feats.push({type:'Feature',properties:{RoadWidth:'20'},geometry:{type:'LineString',coordinates:[ll({x:-24,y:-10}),ll({x:29,y:-10})]}});return}
    const pts=[{x:-c.X/2,y:0},{x:c.X/2,y:0},{x:c.X/2,y:c.Y},{x:-c.X/2,y:c.Y}];feats.push({type:'Feature',properties:props,geometry:{type:'Polygon',coordinates:[ring(pts)]}});
    const hw=(c.w||12)/2;feats.push({type:'Feature',properties:c.w===null?{RoadWidth:''}:{RoadWidth:String(c.w)},geometry:{type:'LineString',coordinates:[ll({x:-c.X/2-4,y:-hw}),ll({x:c.X/2+4,y:-hw})]}})});
  return{type:'FeatureCollection',features:feats}}
// expected figures, by hand: rectangle → buildable (X − 2·side) × (Y − front − rear)
function expect(c){const sd=c.side===null||c.side===''?0:+c.side,rr=c.rear===null||c.rear===''?0:+c.rear,f=front(c.w);
  let A,Gz;if(c.multi){A=30*40-36+10*10;Gz=(30-4)*(40-4-2)-(6+4)*(6+4)+(10-4)*(10-4-2)}else{A=c.X*c.Y;Gz=(c.X-2*sd)*(c.Y-(f??0)-rr)}
  const ground=Math.min(Gz,A*0.65),upper=Math.min(Gz,A*0.75);return{A,G:Gz,ground,upper,gross:ground+upper,front:f,side:sd,rear:rr}}

const STATE=`(()=>{const st=zrFor(M),Z=st.Z;return{no:CUR_PC&&CUR_PC.no,verts:S.verts.map(v=>({x:v.x,y:v.y,role:v.role,sb:v.sb,sbSrc:v.sbSrc,sbDoc:v.sbDoc,need:v.sbNeed||'',name:v.name})),
  rings:(S.geom?.rings||[]).map(r=>({ring:r.ring,sbs:r.edges.map(e=>e.sb),roles:r.edges.map(e=>e.role)})),
  A:Z.A,G:Z.G,gState:Z.gState,ground:Z.footprint,upper:Z.upper,gross:Z.gross,upLimit:Z.upLimit,covLimit:Z.covLimit,ratio:S.tx.ratio,upRatio:S.tx.upRatio,src:S.tx.zSrc,gis:S.tx.zGis,
  plot:M.plotArea,panel:document.getElementById('zrOut').innerText,warn:st.warn,sbInfo:document.getElementById('roadSbInfo').innerText}})()`;
const FORM=`(()=>{const o=BLD_OUT,T=o.tx,Z=o.zoning&&o.zoning.Z;return{parcel:o.parcel,plot:T.m.plotArea,area:T.geo.area,sb:T.edges.map(e=>e.sb),A:Z.A,G:Z.G,ground:Z.footprint,upper:Z.upper,gross:Z.gross,
  texts:(window.__texts.get(o.cv)||[]),info:document.getElementById('bldInfo').innerText}})()`;

(async()=>{const exe=browserPath();assert.ok(exe,'no Chromium/Chrome/Edge found; set CHROME_PATH');
  const srv=await serve(ROOT),base=`http://127.0.0.1:${srv.address().port}/`,browser=await chromium.launch({executablePath:exe,headless:true});
  const errors=[],tmp=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'gis-user-rules-')),file=path.join(tmp,'plan.geojson');fs.writeFileSync(file,JSON.stringify(fixture()));
  try{const ctx=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
    await ctx.addInitScript(()=>{const W=new WeakMap();window.__texts=W;const f=CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText=function(t,...a){let l=W.get(this.canvas);if(!l)W.set(this.canvas,l=[]);l.push(String(t));return f.call(this,t,...a)}});
    const page=await ctx.newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>d.accept());
    await page.goto(base+'index.html');await page.waitForFunction(()=>typeof compute==='function'&&window.polygonClipping);
    await page.evaluate(()=>new Promise(r=>{localStorage.clear();sessionStorage.clear();const q=indexedDB.deleteDatabase('gis-parcel-planner-final');q.onsuccess=q.onerror=q.onblocked=()=>r()}));
    await page.goto(base+'index.html');await page.waitForFunction(()=>typeof compute==='function'&&window.polygonClipping&&window.mainParcelLayerReady);

    console.log('Opening: empty, user rules on by default');
    const boot=await page.evaluate(()=>({verts:S.verts.length,project:S.tb.project,ur:S.urules,on:document.getElementById('urOn').checked,info:document.getElementById('urInfo').textContent}));
    assert.equal(boot.verts,0,'no demo parcel');assert.equal(boot.project,'');assert.ok(boot.on);assert.deepEqual(boot.ur,{on:true,div:5,min:3,max:6,ground:65,upper:75});assert.match(boot.info,/ليست اشتراطًا رسميًا/);
    log('no demo parcel; rules ÷5 · 3…6 m · 65 % · 75 % shown as «قاعدة المستخدم — ليست اشتراطًا رسميًا»');

    await page.setInputFiles('#parcelFile',file);await page.waitForFunction(n=>PARCELS.length===n&&ROADS.length===n&&CUR_PC,CASES.length,{timeout:20000});
    assert.equal(await page.evaluate(()=>ROAD_FIELDS.width),'RoadWidth');assert.equal(await page.evaluate(()=>document.getElementById('roadWidthSel').value),'RoadWidth');
    log(`${CASES.length} parcels and ${CASES.length} streets from one GeoJSON; width field «RoadWidth» chosen in the selector`);

    // choose a parcel by clicking it on the satellite map
    const click=async no=>{const pt=await page.evaluate(n=>{const pc=PARCELS.find(p=>p.no===n),r=pcWgs(pc);let x=0,y=0;r.forEach(p=>{x+=p[0];y+=p[1]});
        const ll=[y/r.length,x/r.length];map.setView(ll,19,{animate:false});const c=map.latLngToContainerPoint(ll),b=map.getContainer().getBoundingClientRect();return{x:b.left+c.x,y:b.top+c.y+(n==='MULTI'?-40:0)}},no);
      await page.waitForTimeout(150);await page.mouse.click(pt.x,pt.y);await page.waitForFunction(n=>CUR_PC&&CUR_PC.no===n&&ZR_NOW!==undefined,no,{timeout:10000});await page.waitForTimeout(250);return page.evaluate(STATE)};
    await page.evaluate(()=>setView('map'));

    console.log('Every parcel: setbacks and areas against hand-computed values');
    const results={};
    for(const c of CASES){const s=await click(c.no),e=expect(c);results[c.no]=s;
      near(s.A,e.A,0.05,`${c.no} land area`);near(s.plot,s.A,1e-6,`${c.no} plot = zoning area`);
      if(!c.multi){const fr=s.verts.filter(v=>v.role==='front');assert.equal(fr.length,1,`${c.no}: one street edge`);
        if(e.front===null){assert.equal(fr[0].need,'width',`${c.no}: front needs width`);assert.notEqual(fr[0].sbSrc,'auto')}else{near(fr[0].sb,e.front,1e-9,`${c.no} front`);assert.equal(fr[0].sbSrc,'auto')}
        const sides=s.verts.filter(v=>v.role==='side'),rear=s.verts.filter(v=>v.role==='rear');assert.equal(sides.length,2);assert.equal(rear.length,1,`${c.no}: rear opposite the street`);
        sides.forEach(v=>near(v.sb,e.side,1e-9,`${c.no} side`));near(rear[0].sb,e.rear,1e-9,`${c.no} rear`);
        const doc=c.side!==null&&c.side!=='';[...sides,...rear].forEach(v=>assert.equal(v.sbDoc,doc,`${c.no}: documented flag`))}
      if(e.front!==null){near(s.G,e.G,0.05,`${c.no} inside setbacks`);near(s.ground,e.ground,0.05,`${c.no} ground`);near(s.upper,e.upper,0.05,`${c.no} upper`);near(s.gross,e.gross,0.1,`${c.no} total`);
        near(s.covLimit,e.A*0.65,0.05,'theoretical ground');near(s.upLimit,e.A*0.75,0.05,'theoretical upper')}
      assert.equal(s.ratio,'65');assert.equal(s.upRatio,'75');assert.equal(s.src.ratio,'user');assert.equal(s.src.upRatio,'user');assert.equal(s.gis.ratio,'60','BUILD_RATI kept only as a note');
      assert.ok(s.warn.some(w=>/قواعد المستخدم، وليست اشتراطًا رسميًا موثقًا\. قيمة GIS \(60٪\) لم تُستخدم/.test(w)),`${c.no}: rule source and unused GIS value stated`);
      assert.match(s.panel,/الحد الأعلى للدور العلوي/);
      console.log(`    ${c.no}: A ${s.A.toFixed(2)} · G ${s.G===null?'—':s.G.toFixed(2)} · أرضي ${s.ground===null?'—':s.ground.toFixed(2)} · علوي ${s.upper===null?'—':s.upper.toFixed(2)} · إجمالي ${s.gross===null?'—':s.gross.toFixed(2)} · ارتدادات ${s.verts.map(v=>v.sb).join('/')}`)}
    log('streets 10/15/20/25/30/40 m → front 3/3/4/5/6/6 m; 500/1000/2000 m²: G, ground = min(G, 65 %), upper = min(G, 75 %), total = ground + upper');

    // binding: a 500 m² parcel on a 30 m street — the zone (16 × 17 = 272 m²) limits both floors
    const w30=results['W30-500'];near(w30.ground,272,0.05,'W30 ground limited by the zone');near(w30.upper,272,0.05,'W30 upper limited by the zone (no projection)');
    assert.match(w30.panel,/محدود بمنطقة البناء/);log('a tight zone limits the upper floor too (no projection outside the buildable zone)');

    console.log('Empty, zero and missing fields; a street without width');
    const em=results['W20-500-EMPTY'],ze=results['W20-1000-ZERO'],nf=results['W15-2000-NOFIELD'],nw=results['NOWIDTH-1000'];
    assert.ok(em.warn.some(w=>/= 0 م لأن حقله فارغ في بيانات القطعة \(قاعدة المستخدم\) — قيمة غير موثقة/.test(w)),'empty field warned');assert.match(em.sbInfo,/0 م غير موثق/);
    assert.ok(nf.warn.some(w=>/قيمة غير موثقة/.test(w)),'missing field warned');
    assert.ok(!ze.warn.some(w=>/قيمة غير موثقة/.test(w)),'an explicit 0 is documented: no warning');
    assert.ok(nw.warn.some(w=>/الارتداد الأمامي يحتاج عرض الشارع/.test(w)),'missing width warned');assert.match(nw.sbInfo,/يحتاج عرض الشارع/);
    assert.ok(nw.gState==='partial'||nw.G===null,'no width → figures not final');
    log('empty / missing side-rear → 0 m flagged «غير موثقة»; explicit 0 → 0 m without a flag; no width → «يحتاج عرض الشارع», no guessed width');

    console.log('MultiPolygon: every part and the hole');
    const mu=results['MULTI'];assert.equal(mu.rings.length,2,'other part + hole');
    const part2=mu.rings.find(r=>r.ring===0),hole=mu.rings.find(r=>r.ring>0);assert.deepEqual([...part2.sbs].sort(),[2,2,2,4].sort(),'part 2: its own street (4 m), rear and sides 2 m');
    assert.deepEqual(hole.sbs,[2,2,2,2],'hole edges: side setback');near(mu.G,expect(CASES.at(-1)).G,0.05,'multipart buildable');
    log(`two parts + hole: A ${mu.A.toFixed(2)} m², inside setbacks ${mu.G.toFixed(2)} m² (= ${expect(CASES.at(-1)).G} by hand)`);

    console.log('Transaction form, sheet, PNG/PDF image');
    await page.evaluate(()=>{S.tx.style='full';persist()});   // detailed look: the calculation strip on the form
    for(const no of ['W20-2000','W30-500','MULTI','W20-500-EMPTY']){const id=await page.evaluate(n=>PARCELS.find(p=>p.no===n).stableId,no);
      await page.selectOption('#parcelSel',id);await page.waitForFunction(i=>CUR_PC&&CUR_PC.stableId===i&&!document.getElementById('bldModal').hidden&&BLD_OUT&&BLD_OUT.parcel===i,id,{timeout:20000});await page.waitForTimeout(300);
      const f=await page.evaluate(FORM),s=await page.evaluate(STATE);
      for(const k of ['A','G','ground','upper','gross'])near(f[k],s[k],1e-6,`${no}: form ${k} = planner`);near(f.plot,s.plot,1e-6,`${no}: form plot area`);near(f.area,s.G,1e-6,`${no}: form buildable area`);
      const fmt=v=>new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(Math.round(v*100)/100);
      assert.ok(f.texts.includes('5 · الحد الأعلى للدور العلوي'),`${no}: upper cell on the form canvas`);assert.ok(f.texts.some(t=>t.startsWith(fmt(s.upper)+' م')),`${no}: upper value ${fmt(s.upper)} drawn`);
      assert.ok(f.texts.some(t=>t.startsWith(fmt(s.ground)+' م')),`${no}: ground value drawn`);assert.ok(f.texts.some(t=>t.startsWith(fmt(s.A)+' م')),`${no}: land area drawn`);
      if(no==='W20-500-EMPTY')assert.match(f.info,/غير موثقة/,'form warns about the undocumented 0');
      await page.keyboard.press('Escape');await page.waitForFunction(()=>document.getElementById('bldModal').hidden)}
    log('transaction form = planner (area, inside setbacks, ground, upper, total); upper-floor cell and values drawn on its canvas (the PNG / PDF image)');
    // reference look (the default): same layout as the reference form, no calculation strip, Arabic-Indic digits on the right panel
    await page.evaluate(()=>{S.tx.style='ref';persist()});
    {const id=await page.evaluate(n=>PARCELS.find(p=>p.no===n).stableId,'W20-2000');
      await page.selectOption('#parcelSel',id);await page.waitForFunction(i=>CUR_PC&&CUR_PC.stableId===i&&!document.getElementById('bldModal').hidden&&BLD_OUT&&BLD_OUT.parcel===i,id,{timeout:20000});await page.waitForTimeout(300);
      // text typed into the parking % field becomes the parking requirement (shown on the form), not an ignored percentage
      await page.evaluate(()=>{setView('sheet');document.querySelector('#secTx, details:has(#txPark)')?.setAttribute('open','')});
      await page.fill('#txPark','1.5 لكل وحدة سكنية');await page.dispatchEvent('#txPark','change');
      await page.fill('#txArch','مصدر العمارة التقليدية (عمارة مكة التقليدية)');
      const pk=await page.evaluate(()=>({pct:S.tx.parkPct,txt:S.tx.parkTxt,box:document.getElementById('txPark').value}));
      assert.deepEqual(pk,{pct:'',txt:'1.5 لكل وحدة سكنية',box:''},'parking text moved to «متطلبات المواقف»');
      await page.evaluate(()=>txOpen(true));await page.waitForTimeout(800);
      // municipality parcel layer fields read into the form (the parcel's own data is kept, nothing else is changed)
      const gf=await page.evaluate(()=>{const keep=JSON.stringify(S.tx);txFromParcel({PARCEL_NUM:'59/14',FLOORSNO:2,LANDUSE_DE:'سكني تجاري',LAYER_DESC:'سكني تجاري',HAS_BUILDI:'نعم',IS_BUILT:1,
        CASE_DESCR:'وجود مباني أو أسوار منه',PRPPOSED_S:'الاحالة للادارة المختصة',BUILD_RATI:60});const o={no:S.tx.parcelNo,use:S.tx.parcelUse,fl:S.tx.floors,st:S.tx.status,notes:S.tx.notes};
        txFromParcel({PARCEL_NUM:'59/15',HAS_BUILDI:'لا',CASE_DESCR:'<Null>'});const o2={st:S.tx.status,notes:S.tx.notes};S.tx=JSON.parse(keep);return[o,o2]});
      assert.deepEqual(gf,[{no:'59/14',use:'سكني تجاري',fl:'2',st:'مبنية',notes:'وجود مباني أو أسوار منه — الاحالة للادارة المختصة'},{st:'غير مبنية',notes:''}],'parcel layer fields → form');
      // the same layer joined to the plans and districts, as GeoJSON and as a shapefile (names cut to 10 characters):
      // plan number / name, district and municipality found by name; codes and the registration date REG_DATE are not read
      const jf=await page.evaluate(()=>{const keep=JSON.stringify(S.tx),keepG=JSON.stringify(S.gis),base={PARCEL_NUM:'59/14',PARCEL_KEY:'K-1',SUBDIVISIO:'77',LANDUSE_DE:'سكني',
          LANDUSE_CO:'1101',FLOORSNO:'2',DIST_CODE:'014',REG_DATE:'2019-05-12',DIS_ID:44,MUN_ID:7},pick=()=>({planNo:S.tx.planNo,planName:S.tx.planName,
          district:S.tx.district,municipality:S.tx.municipality,use:S.tx.parcelUse,floors:S.tx.floors,refDate:S.tx.zRefDate,gis:gisFields(CUR_ROW)});let CUR_ROW;
        const run=r=>{CUR_ROW=r;txFromParcel(r);return pick()};
        const a=run({...base,Subdivision_ID:9921,SubdivisionAName:'مخطط الروضة',SubdivisionNumber:'3120/أ',DIS_ArabicName:'حي الروضة',MUN_ArabicName:'بلدية العليا'});
        const b=run({...base,DIS_Arabic:'حي الروضة',MUN_Arabic:'بلدية العليا'});S.tx=JSON.parse(keep);S.gis=JSON.parse(keepG);return[a,b]});
      const G0={no:'59/14',noKey:'PARCEL_NUM',street:'',planName:'مخطط الروضة',planNo:'3120/أ',district:'حي الروضة',muni:'بلدية العليا',use:'سكني'};
      assert.deepEqual(jf,[{planNo:'3120/أ',planName:'مخطط الروضة',district:'حي الروضة',municipality:'بلدية العليا',use:'سكني',floors:'2',refDate:'',gis:G0},
        {planNo:'',planName:'',district:'حي الروضة',municipality:'بلدية العليا',use:'سكني',floors:'2',refDate:'',gis:{...G0,planName:'',planNo:''}}],'joined layer fields found by name');
      const at=await page.evaluate(()=>[txPhotoAt('2026-09-21_07-02-37_21.41345_39.85804.jpg'),txPhotoAt('IMG_1234.jpg'),txAtText('2026-09-21 19:05:00')]);
      assert.deepEqual(at,['2026-09-21 07:02:37','','2026/09/21'],'date and time read from the photo name');
      await page.evaluate(()=>{S.tx.photoAt='2026-09-21 07:02:37'});await page.evaluate(()=>txOpen(true));await page.waitForTimeout(800);
      const r=await page.evaluate(()=>({H:BLD_OUT.H,texts:__texts.get(BLD_OUT.cv)||[],sb:BLD_OUT.diag.setbacks.map(x=>x.map+':'+x.sb),A:BLD_OUT.zoning.Z.A}));
      assert.equal(r.H,1000,'reference look: no strip below the card');assert.ok(!r.texts.includes('الحساب الهندسي والنظامي للمسطحات'),'no calculation strip');
      for(const t of ['رقم القطعة: W٢٠-٢٠٠٠','١/٥ عرض الشارع','بحد أدنى ٣ م','٦٥%','الحد الأقصى','للارتفاع(م)','استخدام القطعة','وجود تعارض','اشتراطات مواقف السيارات','الملاحظات'])
        assert.ok(r.texts.includes(t),'reference text '+t+' | '+r.texts.slice(0,40).join(' | '));
      assert.ok(r.texts.includes('١٫٥ لكل وحدة سكنية'),'parking requirement on the form (Arabic decimal mark)');
      // gross floor area card left «--» in the reference look (the figure stays in the calculation panel / detailed look); FAR without an approved
      // value = gross ÷ land area, marked as calculated
      assert.ok(r.texts.includes('الإجمالية (م٢)')&&r.texts.includes('--'),'gross floor area card kept with «--» (filled by hand)');
      const farTxt=await page.evaluate(()=>{const Z=BLD_OUT.zoning.Z;return(Math.round(Z.gross/Z.A*100)/100).toString().replace(/\d/g,d=>'٠١٢٣٤٥٦٧٨٩'[d]).replace('.','٫')});
      assert.ok(r.texts.includes(farTxt),'calculated FAR '+farTxt+' drawn');
      for(const d of ['دور أرضي + ثلاث أدوار متكررة + ملحق علوي','لا يوجد','اشتراطات عمارة مكة','داخل النطاق العمراني','مبنية'])assert.ok(r.texts.includes(d),'form default '+d);
      assert.ok(!r.texts.some(t=>t.includes('وأقصى')),'no maximum on the front card');
      {const i=r.texts.indexOf('تاريخ التصوير'),j=r.texts.indexOf('الملاحظات');assert.ok(i>0&&i<j,'photo date row just above the notes');
       assert.ok(r.texts.includes('٢٠٢٦/٠٩/٢١')&&!r.texts.some(t=>t.includes('٠٧:٠٢')),'photo date drawn, no time')}
      assert.ok(r.texts.includes('مصدر العمارة التقليدية')&&r.texts.includes('(عمارة مكة التقليدية)'),'link part drawn separately');
      assert.ok(!r.texts.includes('الشوارع المحيطة')&&!r.texts.includes('الارتدادات حسب الأضلاع'),'rows not in the reference left out');
      assert.ok(r.texts.some(t=>t.startsWith('٢٠٠٠')),'land area in Arabic-Indic digits, no thousands mark (it looked like the decimal one)');
      assert.ok(r.sb.length&&r.sb.every(s=>s.startsWith('plan:')),'setback dimensions only on the after-setbacks plan: '+r.sb.join(' '));
      await page.keyboard.press('Escape');await page.waitForFunction(()=>document.getElementById('bldModal').hidden)}
    log('reference look: card ends the form, front setback as the rule «١/٥ عرض الشارع بحد أدنى ٣ م», Arabic-Indic digits, setbacks drawn on the plan only');
    await page.evaluate(()=>{setView('sheet');render()});await page.waitForTimeout(400);
    const sheet=await page.evaluate(()=>__texts.get(document.querySelector('#desk canvas'))||[]);
    assert.ok(sheet.some(t=>/^أقصى مسطح علوي/.test(t)),'upper floor row on the sheet');assert.ok(sheet.some(t=>/^ارتداد [\d٠-٩]/.test(t)),'setback values on the sheet edges: '+sheet.filter(t=>/ارتداد/.test(t)).join(' | '));
    log('main sheet: «أقصى مسطح علوي» row and «ارتداد … م» on the edges');
    await page.evaluate(()=>setView('map'));const mapLabels=await page.$$eval('.mapsb',els=>els.map(e=>e.textContent));assert.ok(mapLabels.length>=4&&mapLabels.every(t=>/م$/.test(t)),'setback labels on the map');
    log(`map: setback of every edge in metres (${mapLabels.join(' · ')})`);

    console.log('Manual edits and editable rules');
    await click('W25-1000');const edge=await page.evaluate(()=>S.verts.findIndex(v=>v.role==='side'));
    await page.fill(`#sbody input[data-vi="${edge}"][data-vf="sb"]`,'7');await page.press(`#sbody input[data-vi="${edge}"][data-vf="sb"]`,'Tab');
    await click('W10-500');const back=await click('W25-1000');assert.equal(back.verts[edge].sb,7,'a typed setback survives reselection');
    await page.fill('#txRatio','50');await page.press('#txRatio','Tab');let s=await page.evaluate(STATE);assert.equal(s.src.ratio,'manual');
    await page.fill('#urGround','70');await page.press('#urGround','Tab');s=await page.evaluate(STATE);assert.equal(s.ratio,'50','a typed ratio is not replaced by the rule');
    await click('W15-1000');s=await page.evaluate(STATE);assert.equal(s.ratio,'70','the edited rule applies to the next parcel');near(s.ground,Math.min(s.G,1000*0.70),0.05,'ground with 70 %');
    await page.fill('#urGround','65');await page.press('#urGround','Tab');
    log('a typed setback and a typed ratio are kept; an edited rule (70 %) applies to the next parcel');

    console.log('Whole plan');
    await page.click('#planRun');await page.waitForFunction(n=>PLAN_RES.size===n&&!document.getElementById('planRun').disabled,CASES.length,{timeout:30000});
    const plan=await page.evaluate(()=>[...PLAN_RES.values()]);
    for(const c of CASES){if(c.no==='W25-1000')continue;const r=plan.find(x=>x.no===c.no),e=expect(c);assert.ok(r&&!r.error,`${c.no} analysed`);
      near(r.A,e.A,0.05,`plan ${c.no} area`);if(e.front!==null){near(r.G,e.G,0.05,`plan ${c.no} G`);near(r.ground,e.ground,0.05,`plan ${c.no} ground`);near(r.upper,e.upper,0.05,`plan ${c.no} upper`);near(r.gross,e.gross,0.1,`plan ${c.no} total`)}
      if(results[c.no].G!==null&&c.no!=='W15-1000')near(r.G,results[c.no].G,0.05,`plan = planner for ${c.no}`)}
    const man=plan.find(x=>x.no==='W25-1000');assert.equal(man.src,'المخطط (معدّل يدويًا)','manually edited parcel keeps the planner figures');
    assert.equal(plan.find(x=>x.no==='W20-500-EMPTY').undoc,3,'two sides and the rear');assert.equal(plan.find(x=>x.no==='NOWIDTH-1000').needW,1);
    const dl=page.waitForEvent('download');await page.click('#planCsv');const csv=fs.readFileSync(await (await dl).path(),'utf8');
    assert.ok(csv.startsWith('\ufeff"رقم القطعة"'));assert.equal(csv.trim().split('\r\n').length,CASES.length+1);
    log(`${plan.length} parcels analysed in one pass = the planner's figures; manual parcel kept; CSV with ${CASES.length} rows`);

    await page.reload();await page.waitForFunction(()=>typeof compute==='function'&&window.mainParcelLayerReady);await page.evaluate(()=>window.mainParcelLayerReady);await page.waitForTimeout(800);
    const after=await page.evaluate(()=>({n:PLAN_RES.size,parcels:PARCELS.length,roads:ROADS.length,info:document.getElementById('planInfo').textContent}));
    assert.equal(after.parcels,CASES.length);assert.equal(after.roads,CASES.length);assert.equal(after.n,CASES.length,'results restored');assert.match(after.info,new RegExp(`${CASES.length} قطعة`));
    log('after a reload: both layers and every parcel result restored');

    assert.deepEqual(errors,[],'page errors: '+errors.join(' | '));
    console.log('e2e_user_rules: all checks passed')}
  finally{await browser.close();srv.close();fs.rmSync(tmp,{recursive:true,force:true})}})().catch(e=>{console.error(e);process.exit(1)});
