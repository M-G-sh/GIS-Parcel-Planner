'use strict';
/* Browser test of «إعدادات الحقول وجداول الربط» (field-mapping.js + field-mapping-ui.js) on the main planner and «مزيد».
   A GeoJSON layer whose parcels carry codes only (DIS_ID, MUN_ID, CEN_ID, GOV_ID, Subdivision_ID), a name given directly, a code
   missing from the table, the garbled plan 262, Null values; the user's lookup workbook (data/GIS_Parcel_Planner_Domain_Lookups.xlsx)
   uploaded from the dialog, or the same rows as CSV files when the workbook is not there.
   Checks: the dialog (columns with 3 sample values, search, automatic suggestion, manual choice), tables suggested and turned on,
   match statistics (missing codes, repeated codes), the preview; after saving: the transaction form values and their sources,
   the sheet (canvas of PNG / PDF), «غير محدد» with the reason, a value typed by hand kept, parcels not mixed, the mapping restored
   after a reload, «مزيد», the plan CSV, and 4000 parcels processed without a long task.
   Needs playwright-core (NODE_PATH) and Chromium/Chrome (CHROME_PATH).  Run: node tests/e2e_field_mapping.js */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const ROOT=path.resolve(__dirname,'..'),XLSX_FILE=path.join(ROOT,'data','GIS_Parcel_Planner_Domain_Lookups.xlsx'),TMP=fs.mkdtempSync(path.join(os.tmpdir(),'fm-e2e-'));
function browserPath(){if(process.env.CHROME_PATH)return process.env.CHROME_PATH;const local=process.env.LOCALAPPDATA||'',c=[];
  try{for(const d of fs.readdirSync(path.join(local,'ms-playwright')).filter(d=>/^chromium-\d+$/.test(d)).sort().reverse())c.push(path.join(local,'ms-playwright',d,'chrome-win64','chrome.exe'))}catch(e){}
  c.push('C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium','/usr/bin/google-chrome');return c.find(p=>fs.existsSync(p))}
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.geojson':'application/geo+json'};
const serve=()=>new Promise(res=>{const srv=http.createServer((q,out)=>{const file=path.join(ROOT,decodeURIComponent(new URL(q.url,'http://x').pathname));
  if(!file.startsWith(ROOT)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){out.writeHead(404);out.end();return}
  out.writeHead(200,{'Content-Type':TYPES[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(file).pipe(out)});srv.listen(0,'127.0.0.1',()=>res(srv))});
const log=(...a)=>console.log('  ✓',...a);

// ---------- data ----------
const LON0=39.85,LAT0=21.48,mx=1/(111320*Math.cos(LAT0*Math.PI/180)),my=1/110574;
const rect=(x,y,w,h)=>[[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]].map(([a,b])=>[+(LON0+a*mx).toFixed(9),+(LAT0+b*my).toFixed(9)])];
const KEYS=['PARCEL_NUM','Subdivision_ID','SubdivisionNumber','SubdivisionAName','DIS_ID','MUN_ID','CEN_ID','GOV_ID','DIS_ArabicName','MUN_ArabicName','CEN_ArabicName','GOV_ArabicName','LANDUSE_DE','LAYER_DESC','FLOORSNO'];
const props=o=>Object.fromEntries(KEYS.map(k=>[k,k in o?o[k]:'']));
const CASES=[
  {PARCEL_NUM:'F-1',Subdivision_ID:836,SubdivisionNumber:'<Null>',DIS_ID:35,MUN_ID:6,CEN_ID:12,GOV_ID:1,DIS_ArabicName:null,LANDUSE_DE:'سكني',LAYER_DESC:'سكني تجاري',FLOORSNO:'2'},
  {PARCEL_NUM:'F-2',Subdivision_ID:563,DIS_ID:999,MUN_ID:13,CEN_ID:12,GOV_ID:1,LANDUSE_DE:'تجاري',LAYER_DESC:'تجاري مكتبي',FLOORSNO:'3'},
  {PARCEL_NUM:'F-3',Subdivision_ID:1504,DIS_ID:72,DIS_ArabicName:'حي ام الجود',MUN_ID:9,CEN_ID:12,GOV_ID:1,LANDUSE_DE:'صناعي'},
  {PARCEL_NUM:'F-4',Subdivision_ID:262,DIS_ID:0,MUN_ID:9,CEN_ID:12,GOV_ID:2,LANDUSE_DE:'سكني'},
  {PARCEL_NUM:'F-5',Subdivision_ID:'<Null>',DIS_ID:'',MUN_ID:null,LANDUSE_DE:'سكني'}];
const layer={type:'FeatureCollection',features:[...CASES.map((c,i)=>({type:'Feature',properties:props(c),geometry:{type:'Polygon',coordinates:rect(i*36,0,30,40)}})),
  {type:'Feature',properties:{name:'شارع الاختبار',Width:20},geometry:{type:'LineString',coordinates:[[-10,-12],[200,-12]].map(([a,b])=>[LON0+a*mx,LAT0+b*my])}}]};
fs.writeFileSync(path.join(TMP,'fm-parcels.geojson'),JSON.stringify(layer));
const big={type:'FeatureCollection',features:Array.from({length:4000},(_,i)=>({type:'Feature',properties:props({PARCEL_NUM:`B-${i}`,Subdivision_ID:[836,563,1504,262][i%4],DIS_ID:[35,72,0,999][i%4],MUN_ID:[6,13,9][i%3],CEN_ID:12,GOV_ID:1,LANDUSE_DE:i%5?'سكني':'<Null>'}),
  geometry:{type:'Polygon',coordinates:rect((i%80)*12,1000+Math.floor(i/80)*12,10,10)}}))};
fs.writeFileSync(path.join(TMP,'fm-big.geojson'),JSON.stringify(big));
// the workbook rows used here, as CSV, when the workbook itself is not in data/
const CSV={Districts:'District ID,District Arabic Name\n0,خارج نطاق الاحياء\n35,حي الصفوة\n72,حي ام الجود\n',Municipalities:'Municipality ID,Municipality Arabic Name\n6,العزيزية\n9,الشرائع\n13,الحديبية\n',
  Centers:'Center ID,Center Arabic Name\n12,مكة المكرمة\n',Governorates:'Governorate ID,Governorate Arabic Name\n1,محافظة مكة\n2,محافظة الجموم\n',
  Plans:'Subdivision ID,Subdivision Number,Subdivision Arabic Name,Plan Type\n836,ك ك 1/20/91,جوهرة العسيلة رقم 2,مخطط سكنى\n563,1/28/13/أ,مخطط البوابة رقم (1) ( حي التخصصي تعديل مخطط ),مخطط سكنى\n'+
    '1504,12/1435هـ المعدل,المخطط التنظيمي لتوسعة المنطقة الصناعية بجنوب مكة,صناعي\n'.repeat(3)+'262,,"حلقة الفⴁ䔆 䠀✆䐆",0\n'};
// FM_LOOKUP=csv forces the CSV files (5 uploads) even when the workbook is there
const lookupFiles=fs.existsSync(XLSX_FILE)&&process.env.FM_LOOKUP!=='csv'?[XLSX_FILE]:Object.entries(CSV).map(([n,t])=>{const f=path.join(TMP,n+'.csv');fs.writeFileSync(f,'\ufeff'+t);return f});
const EXP={F1:{district:'حي الصفوة',municipality:'العزيزية',center:'مكة المكرمة',governorate:'محافظة مكة',planNo:'ك ك 1/20/91',planName:'جوهرة العسيلة رقم 2',planUse:'مخطط سكنى',parcelUse:'سكني',floors:'2'}};

async function selectParcel(page,no){const id=await page.evaluate(n=>PARCELS.find(x=>x.no===n).stableId,no);
  if(await page.evaluate(i=>CUR_PC&&CUR_PC.stableId===i,id))return;
  await page.selectOption('#parcelSel',id);await page.waitForFunction(n=>CUR_PC&&CUR_PC.no===n,no);
  await page.waitForFunction(()=>!document.getElementById('bldModal').hidden&&typeof BLD_OUT!=='undefined'&&BLD_OUT&&BLD_OUT.parcel===CUR_PC.stableId,null,{timeout:20000})}
const closeTx=async page=>{await page.keyboard.press('Escape');await page.waitForFunction(()=>document.getElementById('bldModal').hidden)};
const TX=page=>page.evaluate(()=>({no:CUR_PC.no,district:S.tx.district,municipality:S.tx.municipality,center:S.tx.center,governorate:S.tx.governorate,planNo:S.tx.planNo,planName:S.tx.planName,
  planUse:S.tx.planUse,parcelUse:S.tx.parcelUse,floors:S.tx.floors,fSrc:{...(S.tx.fSrc||{})},fWarn:{...(S.tx.fWarn||{})},texts:window.__texts.get(BLD_OUT?.cv)||[],
  badge:k=>null,badges:Object.fromEntries([...document.querySelectorAll('[data-zsrc],[data-fsrc]')].map(e=>[e.dataset.zsrc||e.dataset.fsrc,e.textContent])),warnBox:document.getElementById('fmTxWarn').hidden?'':document.getElementById('fmTxWarn').textContent}));
const pick=(o,ks)=>Object.fromEntries(ks.map(k=>[k,o[k]]));
// the reference sheet shows digits as Arabic-Indic (١/٢٠/٩١): the stored value keeps its own text
const onSheet=(texts,s)=>texts.includes(s)||texts.includes(String(s).replace(/\d/g,d=>'٠١٢٣٤٥٦٧٨٩'[d]));

(async()=>{const exe=browserPath();assert.ok(exe,'no Chromium/Chrome/Edge found; set CHROME_PATH');
  const srv=await serve(),base=`http://127.0.0.1:${srv.address().port}/`,browser=await chromium.launch({executablePath:exe,headless:true}),errors=[];
  try{const ctx=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
    await ctx.addInitScript(()=>{const W=new WeakMap();window.__texts=W;const f=CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText=function(t,...a){let l=W.get(this.canvas);if(!l)W.set(this.canvas,l=[]);l.push(String(t));return f.call(this,t,...a)};
      window.__long=[];try{new PerformanceObserver(l=>{for(const e of l.getEntries())window.__long.push({start:e.startTime,d:e.duration})}).observe({type:'longtask',buffered:true})}catch(e){}});
    const page=await ctx.newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>d.accept());
    await page.goto(base+'index.html');await page.waitForFunction(()=>typeof compute==='function'&&window.FieldMapping&&window.FMS);
    await page.evaluate(()=>new Promise(r=>{localStorage.clear();sessionStorage.clear();const q=indexedDB.deleteDatabase('gis-parcel-planner-final');q.onsuccess=q.onerror=q.onblocked=()=>r()}));
    await page.reload();await page.waitForFunction(()=>typeof compute==='function'&&window.FMS);

    console.log('Dialog: columns, samples, search, suggestions');
    await page.setInputFiles('#parcelFile',path.join(TMP,'fm-parcels.geojson'));await page.waitForFunction(()=>PARCELS.length===5&&FMS.P&&CUR_PC);
    await page.click('#fmBtn');await page.waitForFunction(()=>!document.getElementById('fmModal').hidden&&document.querySelector('#fmSel_districtCode'));
    const d1=await page.evaluate(()=>{const s=id=>document.getElementById('fmSel_'+id),opt=(id,v)=>[...s(id).options].find(o=>o.value===v)?.textContent||'';
      return{rows:document.querySelectorAll('#fmBody .fm-row').length,auto:['districtCode','municipalityCode','planCode','planNo','planName','districtName','landUse'].map(id=>[id,s(id).value,s(id).options[0].textContent]),
        dis:opt('districtCode','DIS_ID'),cols:s('landUse').options.length,val:document.querySelector('#fmBody [data-val="districtName"]').textContent}});
    assert.equal(d1.rows,21,'one row per item');assert.ok(d1.auto.every(([,v])=>v==='__auto'));
    assert.match(d1.auto[0][2],/تلقائي — DIS_ID/);assert.match(d1.auto[2][2],/تلقائي — Subdivision_ID/);assert.match(d1.auto[3][2],/تلقائي — SubdivisionNumber/);assert.match(d1.auto[6][2],/تلقائي — LANDUSE_DE — سكني · تجاري · صناعي/);
    assert.match(d1.dis,/^DIS_ID — 35 · 999 · 72$/,'column with its first 3 distinct values');assert.equal(d1.cols,2+KEYS.length);
    await page.fill('.fm-row[data-row="landUse"] .fm-q','layer');
    const vis=await page.evaluate(()=>[...document.getElementById('fmSel_landUse').options].filter(o=>!o.hidden&&!o.value.startsWith('__')).map(o=>o.value));assert.deepEqual(vis,['LAYER_DESC'],'search keeps the matching column');
    await page.fill('.fm-row[data-row="landUse"] .fm-q','');
    log(`21 items, ${KEYS.length} columns each with 3 sample values (DIS_ID — 35 · 999 · 72), search «layer» → LAYER_DESC; suggested DIS_ID / Subdivision_ID / SubdivisionNumber / LANDUSE_DE`);

    console.log('Lookup tables: upload, suggestion, statistics, enabling');
    await page.click('[data-fmtab="domains"]');await page.setInputFiles('#fmFile',lookupFiles);   // one workbook, or 5 CSV files at once
    await page.waitForFunction(n=>FMS.tables.length>=n&&document.querySelector('[data-domcard="plan"]'),5);
    const tbl=await page.evaluate(()=>Object.fromEntries(['district','municipality','center','governorate','plan'].map(d=>[d,document.querySelector(`[data-dom="${d}"][data-f="table"]`).value.split('#')[1]])));
    assert.deepEqual(tbl,{district:'Districts',municipality:'Municipalities',center:'Centers',governorate:'Governorates',plan:'Plans'});
    assert.ok(await page.evaluate(()=>[...document.querySelectorAll('[data-f="on"]')].every(c=>!c.checked)),'suggested tables are off');
    await page.waitForFunction(()=>/مطابقة/.test(document.querySelector('[data-st="district"]').textContent));
    const st=await page.evaluate(()=>Object.fromEntries(['district','plan'].map(d=>[d,document.querySelector(`[data-st="${d}"]`).textContent])));
    assert.match(st.district,/لها كود 4 · مطابقة 3 · غير موجود في الجدول 1 كود \(999\)/);assert.match(st.plan,/مكرر بالقيم نفسها \(ليس تعارضًا\): 1504/);assert.match(st.plan,/مطابقة 4/);
    for(const d of ['district','municipality','center','governorate','plan']){await page.check(`input[data-dom="${d}"][data-f="on"]`);await page.waitForFunction(x=>document.querySelector(`input[data-dom="${x}"][data-f="on"]`)?.checked,d)}
    log(`${lookupFiles.length===1?'workbook':'CSV files'} → Districts / Municipalities / Centers / Governorates / Plans suggested (off); district 3 of 4 matched, 999 missing; plan 1504 repeated with the same values; all 5 turned on`);
    await page.click('[data-fmtab="preview"]');await page.waitForFunction(()=>document.querySelector('.fm-table'));
    const pv=await page.evaluate(()=>[...document.querySelectorAll('.fm-table tbody tr')].map(tr=>[...tr.cells].map(c=>c.textContent.trim())).filter(r=>['اسم الحي','رقم المخطط','كود المخطط (Subdivision ID)'].includes(r[0])));
    assert.deepEqual(pv.map(r=>r.slice(0,3)),[['رقم المخطط','ك ك 1/20/91','جدول الربط'],['كود المخطط (Subdivision ID)','836','GIS'],['اسم الحي','حي الصفوة','جدول الربط']]);
    await page.click('#fmSave');await page.waitForFunction(()=>document.getElementById('fmModal').hidden&&S.tx.district==='حي الصفوة');
    log('preview: plan number «ك ك 1/20/91» (table) ≠ plan code 836 (GIS), district حي الصفوة (table); saved');

    console.log('Transaction form, sheet, sources, «غير محدد», manual values, parcels apart');
    await selectParcel(page,'F-2');await selectParcel(page,'F-1');
    let t=await TX(page);
    assert.deepEqual(pick(t,Object.keys(EXP.F1)),EXP.F1);
    assert.deepEqual(pick(t.fSrc,['district','municipality','center','governorate','planNo','planName','planUse','parcelUse']),{district:'domain',municipality:'domain',center:'domain',governorate:'domain',planNo:'domain',planName:'domain',planUse:'domain',parcelUse:'gis'});
    assert.deepEqual(pick(t.badges,['district','municipality','planNo','planName','center','parcelUse']),{district:'جدول الربط',municipality:'جدول الربط',planNo:'جدول الربط',planName:'جدول الربط',center:'جدول الربط',parcelUse:'GIS'});
    for(const s of ['حي الصفوة','العزيزية','ك ك 1/20/91','جوهرة العسيلة رقم 2','مخطط سكنى'])assert.ok(onSheet(t.texts,s),`sheet text «${s}»`);
    assert.ok(!onSheet(t.texts,'35')&&!onSheet(t.texts,'836'),'no code drawn as a name');
    log('F-1 (codes only): حي الصفوة · العزيزية · مكة المكرمة · محافظة مكة · «ك ك 1/20/91» · جوهرة العسيلة رقم 2 — badges «جدول الربط», use «GIS», all on the sheet (PNG / PDF canvas), no code drawn');
    await closeTx(page);await selectParcel(page,'F-2');t=await TX(page);
    assert.equal(t.district,'');assert.match(t.fWarn.district,/الكود 999 غير موجود في جدول Districts/);assert.equal(t.badges.district,'غير محدد');assert.match(t.warnBox,/اسم الحي: غير محدد — الكود 999/);
    assert.deepEqual([t.municipality,t.planNo,t.planName],['الحديبية','1/28/13/أ','مخطط البوابة رقم (1) ( حي التخصصي تعديل مخطط )']);
    assert.ok(t.texts.includes('غير محدد')&&onSheet(t.texts,'1/28/13/أ'),'«غير محدد» and the plan number on the sheet');
    log('F-2: district code 999 not in the table → «غير محدد» on the form (badge + warning) and the sheet; municipality / plan from the tables');
    await closeTx(page);await selectParcel(page,'F-3');t=await TX(page);assert.deepEqual([t.district,t.fSrc.district,t.planNo,t.municipality],['حي ام الجود','gis','12/1435هـ المعدل','الشرائع']);
    await closeTx(page);await selectParcel(page,'F-4');t=await TX(page);
    assert.deepEqual([t.district,t.planNo,t.planName,t.governorate],['خارج نطاق الاحياء','','','محافظة الجموم']);assert.match(t.fWarn.planName,/تالف الترميز/);assert.match(t.fWarn.planNo,/فارغ في جدول/);
    await closeTx(page);await selectParcel(page,'F-5');t=await TX(page);assert.equal(t.district,'');assert.match(t.fWarn.district,/لا يوجد كود الحي/);assert.match(t.fWarn.planNo,/لا يوجد كود المخطط/);
    log('F-3 name in the layer kept (GIS); F-4 district 0 = خارج نطاق الاحياء, garbled plan 262 refused; F-5 without codes → «غير محدد» with «لا يوجد كود»');
    // a value typed by hand stays with its parcel; the other parcels keep theirs
    await closeTx(page);await selectParcel(page,'F-2');await closeTx(page);
    await page.evaluate(()=>{const el=document.getElementById('txDistrict');el.value='حي مكتوب يدويًا';el.dispatchEvent(new Event('input',{bubbles:true}))});
    t=await TX(page);assert.deepEqual([t.district,t.fSrc.district,t.badges.district],['حي مكتوب يدويًا','manual','يدوي']);await page.waitForTimeout(400);
    await selectParcel(page,'F-1');t=await TX(page);assert.equal(t.district,'حي الصفوة','F-1 not mixed with F-2');
    await closeTx(page);await selectParcel(page,'F-2');t=await TX(page);assert.deepEqual([t.district,t.fSrc.district],['حي مكتوب يدويًا','manual']);assert.ok(t.texts.includes('حي مكتوب يدويًا'));
    log('F-2 district typed by hand («يدوي») kept after F-1 and back, and drawn on the sheet; F-1 keeps حي الصفوة');

    console.log('Manual column, reload, «مزيد», CSV');
    await closeTx(page);await page.click('#fmBtn');await page.waitForFunction(()=>!document.getElementById('fmModal').hidden);
    await page.selectOption('#fmSel_landUse','LAYER_DESC');assert.equal(await page.textContent('.fm-row[data-row="landUse"] .fm-tag'),'يدوي');
    await page.click('#fmSave');await page.waitForFunction(()=>document.getElementById('fmModal').hidden&&S.tx.parcelUse==='تجاري مكتبي');
    assert.equal(await page.evaluate(()=>S.tx.district),'حي مكتوب يدويًا','the mapping change keeps the value typed by hand');
    await page.reload();await page.evaluate(()=>window.mainParcelLayerReady);await page.waitForFunction(()=>CUR_PC&&FMS.P&&S.tx.parcelUse);
    const rl=await page.evaluate(()=>({no:CUR_PC.no,use:S.tx.parcelUse,dis:S.tx.district,map:FMS.cfg.mapping.landUse,on:FMS.cfg.bindings.filter(b=>b.on).length,from:FMS.from,tables:FMS.tables.length}));
    assert.deepEqual(pick(rl,['no','use','dis','map','on','from']),{no:'F-2',use:'تجاري مكتبي',dis:'حي مكتوب يدويًا',map:'LAYER_DESC',on:5,from:'layer'});
    log(`landUse chosen by hand (LAYER_DESC → «تجاري مكتبي»), typed district kept; after reload: mapping, 5 lookups and ${rl.tables} tables restored from IndexedDB`);
    await page.click('#moreStreetTools');await page.waitForURL(/street-tools\.html\?parcel=/);
    await page.waitForFunction(()=>document.querySelector('#parcelAttributes [data-fm="municipalityName"]'),null,{timeout:20000});
    const more=await page.evaluate(()=>Object.fromEntries([...document.querySelectorAll('#parcelAttributes [data-fm]')].map(d=>[d.dataset.fm,d.querySelector('dd').textContent])));
    assert.match(more.municipalityName,/^الحديبية جدول الربط$/);assert.match(more.planNo,/^1\/28\/13\/أ جدول الربط$/);assert.match(more.districtName,/^غير محدد.*الكود 999/);assert.match(more.landUse,/^تجاري مكتبي GIS$/);
    log('«مزيد»: الحديبية / 1/28/13/أ (جدول الربط), use تجاري مكتبي (GIS, chosen column), district «غير محدد» with the reason');
    await page.goto(base+'index.html');await page.evaluate(()=>window.mainParcelLayerReady);await page.waitForFunction(()=>CUR_PC&&FMS.P&&ROADS.length);
    await page.evaluate(()=>runPlanAnalysis());await page.waitForFunction(()=>PLAN_RES.size===5);
    const dl=page.waitForEvent('download');await page.evaluate(()=>planCsv());const csv=fs.readFileSync(await (await dl).path(),'utf8').replace(/^\ufeff/,'').split('\r\n').map(l=>l.split('","').map(s=>s.replace(/^"|"$/g,'')));
    const H=csv[0],rowOf=no=>csv.find(r=>r[0]===no),c=(r,h)=>r[H.indexOf(h)];
    assert.deepEqual(['رقم المخطط','اسم المخطط','اسم الحي','اسم البلدية','مصدر البيانات'].map(h=>H.includes(h)),[true,true,true,true,true]);
    assert.deepEqual([c(rowOf('F-1'),'اسم الحي'),c(rowOf('F-1'),'رقم المخطط'),c(rowOf('F-2'),'اسم الحي'),c(rowOf('F-3'),'اسم الحي')],['حي الصفوة','ك ك 1/20/91','غير محدد','حي ام الجود']);
    assert.match(c(rowOf('F-1'),'مصدر البيانات'),/اسم الحي: جدول الربط/);assert.match(c(rowOf('F-2'),'تحذيرات الربط'),/999/);
    log('plan CSV: columns رقم المخطط / اسم المخطط / اسم الحي / اسم البلدية + sources and warnings (F-1 حي الصفوة · F-2 غير محدد)');

    console.log('Shapefile layer (DBF names cut to 10 characters)');
    // built in the page with its own shapefile writer: SHP + SHX + DBF + PRJ (WGS84) in a ZIP, imported like a user's file
    await page.evaluate(async([L0,A0,mx,my])=>{const R=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]].map(([a,b])=>({x:L0+a*mx,y:A0+b*my}));
      const {shp,shx}=buildSHP([R(0,600,30,40),R(40,600,30,40)]);
      const dbf=buildDBF([{name:'PARCEL_NUM',type:'C',len:20},{name:'DIS_ID',type:'N',len:10,dec:0},{name:'MUN_ID',type:'N',len:10,dec:0},{name:'DIS_Arabic',type:'C',len:60},{name:'Subdivis_3',type:'N',len:10,dec:0},{name:'LANDUSE_DE',type:'C',len:40}],
        [{PARCEL_NUM:'S-1',DIS_ID:35,MUN_ID:6,DIS_Arabic:'',Subdivis_3:836,LANDUSE_DE:'سكني'},{PARCEL_NUM:'S-2',DIS_ID:72,MUN_ID:13,DIS_Arabic:'حي ام الجود',Subdivis_3:563,LANDUSE_DE:'تجاري'}]);
      const z=new JSZip();z.file('fm_shp.shp',shp);z.file('fm_shp.shx',shx);z.file('fm_shp.dbf',dbf);z.file('fm_shp.cpg','UTF-8');
      z.file('fm_shp.prj','GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]');
      await importFile(new File([await z.generateAsync({type:'blob'})],'fm_shp.zip'))},[LON0,LAT0,mx,my]);
    await page.waitForFunction(()=>PARCELS.length===2&&CUR_PC&&FMS.P&&FMS.keys.includes('DIS_Arabic'));
    const sh=await page.evaluate(()=>({from:FMS.from,on:Object.fromEntries(FMS.cfg.bindings.map(b=>[b.domain,b.on])),cols:['districtCode','districtName','planCode'].map(id=>FMS.P.cols[id].list[0]||''),
      no:CUR_PC.no,district:S.tx.district,src:S.tx.fSrc?.district,muni:S.tx.municipality,planNo:S.tx.planNo,info:document.getElementById('fmInfo').textContent}));
    assert.deepEqual(pick(sh,['from','on','cols','no','district','src','muni','planNo']),{from:'last',on:{district:true,municipality:true,center:false,governorate:false,plan:false},cols:['DIS_ID','DIS_Arabic',''],
      no:'S-1',district:'حي الصفوة',src:'domain',muni:'العزيزية',planNo:''});
    assert.match(sh.info,/من آخر إعدادات محفوظة؛ .*المخططات تحتاج تأكيد حقل الكود/);
    await page.click('#fmBtn');await page.waitForFunction(()=>!document.getElementById('fmModal').hidden&&document.querySelector('#fmSel_planCode'));
    await page.selectOption('#fmSel_planCode','Subdivis_3');await page.click('[data-fmtab="domains"]');await page.check('input[data-dom="plan"][data-f="on"]');
    await page.waitForFunction(()=>/مطابقة 2/.test(document.querySelector('[data-st="plan"]').textContent));
    await page.click('#fmSave');await page.waitForFunction(()=>document.getElementById('fmModal').hidden&&S.tx.planNo==='ك ك 1/20/91');
    await selectParcel(page,'S-2');t=await TX(page);assert.deepEqual([t.district,t.fSrc.district,t.planNo,t.municipality],['حي ام الجود','gis','1/28/13/أ','الحديبية']);await closeTx(page);
    log('shapefile ZIP (DIS_ID, MUN_ID, DIS_Arabic, Subdivis_3): district / municipality lookups carried from the last settings (same code columns), plan lookup offered off and Subdivis_3 not guessed; after choosing it: 836 → ك ك 1/20/91, 563 → 1/28/13/أ');

    console.log('Thousands of parcels');
    const t0=Date.now();await page.setInputFiles('#parcelFile',path.join(TMP,'fm-big.geojson'));await page.waitForFunction(()=>PARCELS.length===4000&&FMS.P&&FMS.stats&&FMS.stats.n===4000,null,{timeout:120000});
    const imp=Date.now()-t0,from=await page.evaluate(()=>FMS.from);assert.equal(from,'schema','a new layer with the same columns uses the saved mapping');
    const perf=await page.evaluate(async()=>{let last=performance.now(),gap=0;const tick=setInterval(()=>{const n=performance.now();gap=Math.max(gap,n-last);last=n},5);
      const t=performance.now();await fmApplyAll();const ms=performance.now()-t;clearInterval(tick);
      return{ms,gap,long:window.__long.filter(e=>e.start>=t).map(e=>e.d),n:FMS.stats.n,matched:FMS.stats.bindings.district.matched,missing:[...FMS.stats.bindings.district.missing]}});
    assert.equal(perf.n,4000);assert.equal(perf.matched,3000);assert.deepEqual(perf.missing,[['999',1000]]);
    const maxLong=perf.long.length?Math.max(...perf.long):0;assert.ok(maxLong<120&&perf.gap<150,`page kept responsive: longest task ${maxLong.toFixed(0)} ms, longest timer gap ${perf.gap.toFixed(0)} ms`);
    await selectParcel(page,'B-1');t=await TX(page);assert.deepEqual([t.district,t.planNo,t.parcelUse],['حي ام الجود','1/28/13/أ','']);assert.equal(t.fSrc.parcelUse,'');
    log(`4000 parcels: import + mapping ${imp} ms; mapping pass ${perf.ms.toFixed(0)} ms in slices (longest task ${maxLong.toFixed(0)} ms, timer gap ${perf.gap.toFixed(0)} ms); 3000 districts matched, 999 ×1000 missing`);
    assert.deepEqual(errors,[],'no page errors');console.log('e2e_field_mapping: all checks passed');
  }finally{await browser.close();srv.close();fs.rmSync(TMP,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
