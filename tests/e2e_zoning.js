'use strict';
/* Browser test of «الاشتراطات التنظيمية»: geometric and regulatory buildable area.
   Cases (tests/fixtures/zoning-cases.geojson, synthetic; requirements as GIS attributes), project type «أرض فقط»:
     Z-SB setbacks bind · Z-COV coverage binds · Z-L concave L · Z-MULTI two parts + a hole · Z-NONE no requirement at all
     Z-RULE / Z-OTHER saved rules by land use and area (same district / another district)
   Checks on the real pages:
   · values read from GIS with their source; land area, area inside the setbacks (hand-computed), coverage limit,
     footprint limit = min of both, total floor area, non-buildable areas with reasons — panel, sheet, transaction form, «مزيد»
   · the coverage distribution is a verified polygon: area = limit, inside the parcel, clear of every setback and hole
   · missing requirement → «الاشتراط غير محدد», nothing shown as an approved regulatory area; «غير معتمد» with its reason
   · documented exceptions only with a reference; invalid values flagged; rules refused without a source or on another site
   · switching parcels never mixes requirements; PNG = form canvas pixel for pixel, PDF = the same image; sheet PNG / PDF
   · the mosque model: identical program, layout and table to the previous version, and its requirements are not assumed
   Needs playwright-core (NODE_PATH) and Chromium/Chrome (CHROME_PATH); internet for jsPDF/fonts like the real page.
   Optional: ZONING_BASELINE=<previous version folder> (default: the newest sibling GIS_Parcel_Planner_Final_backup_zoning_*),
   ZR_DUMP=<folder> saves the forms as PNG.  Run: node tests/generate_fixtures.js && node tests/e2e_zoning.js */
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const ROOT=path.resolve(__dirname,'..'),FX=path.join(__dirname,'fixtures');
function browserPath(){if(process.env.CHROME_PATH)return process.env.CHROME_PATH;const local=process.env.LOCALAPPDATA||'',c=[];
  try{for(const d of fs.readdirSync(path.join(local,'ms-playwright')).filter(d=>/^chromium-\d+$/.test(d)).sort().reverse())c.push(path.join(local,'ms-playwright',d,'chrome-win64','chrome.exe'))}catch(e){}
  c.push('C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe');return c.find(p=>fs.existsSync(p))}
const baselineDir=()=>{if(process.env.ZONING_BASELINE)return process.env.ZONING_BASELINE;const up=path.resolve(ROOT,'..');try{const d=fs.readdirSync(up).filter(x=>/^GIS_Parcel_Planner_Final_backup_zoning_/.test(x)).sort().pop();return d?path.join(up,d):null}catch(e){return null}};
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.geojson':'application/geo+json'};
const serve=dir=>new Promise(res=>{const srv=http.createServer((q,out)=>{const file=path.join(dir,decodeURIComponent(new URL(q.url,'http://x').pathname));
  if(!file.startsWith(dir)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){out.writeHead(404);out.end();return}
  out.writeHead(200,{'Content-Type':TYPES[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(file).pipe(out)});srv.listen(0,'127.0.0.1',()=>res(srv))});
const log=(...a)=>console.log('  ✓',...a);
const near=(a,b,eps,msg)=>assert.ok(Math.abs(a-b)<=eps,`${msg}: ${a} vs ${b}`);

// zoning state of the current parcel (after a render), with an independent check of the distribution polygon:
// its own shoelace area, every vertex inside the parcel and at least each edge's setback away from it (holes included)
const ZSTATE=()=>{render();const s=zrFor(M),Z=s.Z,T=s.T;const area=pg=>Math.abs(polyArea(pg[0]))-pg.slice(1).reduce((t,h)=>t+Math.abs(polyArea(h)),0);
  let check=null;if(Z.dist&&Z.dist.ok){const pts=Z.dist.parts.flat(2),rings=[s.m.P,...(s.m.extra||[]).map(r=>r.P)],inside=p=>{let c=0;rings.forEach(R=>{if(inPoly(p,R))c++});return c%2===1};
    check={area:Z.dist.parts.reduce((t,pg)=>t+area(pg),0),parts:Z.dist.parts.length,allInside:pts.every(inside),
      clear:Math.min(...pts.map(p=>Math.min(...T.edges.map(e=>distSeg(p,e.a,e.b)-(e.sb||0)))))}}
  return{A:Z.A,G:Z.G,gState:Z.gState,covPct:Z.covPct,covTotal:Z.covTotal,covEx:Z.covEx,F:Z.footprint,bind:Z.binding,footState:Z.footState,gross:Z.gross,grossState:Z.grossState,
    byFloors:Z.byFloors,byFar:Z.byFar,grossEx:Z.grossEx,nb:Z.nb.map(n=>({k:n.k,area:n.area,outside:!!n.outside})),nbTotal:Z.nbTotal,approved:Z.approved,reasons:Z.reasons,mosque:Z.mosque,
    dist:Z.dist&&{ok:Z.dist.ok,full:!!Z.dist.full,area:Z.dist.area,reason:Z.dist.reason||'',check:Z.dist.check},indep:check,same:s.same,warn:s.warn,
    tx:{...S.tx,zSrc:{...S.tx.zSrc}},panel:document.getElementById('zrOut').textContent,sum:document.getElementById('sumZr').textContent,
    badges:Object.fromEntries([...document.querySelectorAll('[data-zsrc]')].map(b=>[b.dataset.zsrc,b.textContent])),chips:document.getElementById('chips').textContent}};
// choose a parcel from the layer (the transaction form opens on its own) and close the form
async function pick(page,no){const id=await page.evaluate(n=>PARCELS.find(x=>x.no===n).stableId,no);
  if(await page.evaluate(i=>CUR_PC&&CUR_PC.stableId===i,id))return id;await page.selectOption('#parcelSel',id);
  await page.waitForFunction(i=>CUR_PC&&CUR_PC.stableId===i&&!document.getElementById('bldModal').hidden&&BLD_OUT&&BLD_OUT.parcel===i,id,{timeout:20000});
  await page.keyboard.press('Escape');await page.waitForFunction(()=>document.getElementById('bldModal').hidden);return id}
// setbacks typed in the planner table, like a user (every edge of the main ring)
async function typeSb(page,v){const n=await page.evaluate(()=>S.verts.length);for(let i=0;i<n;i++)await page.fill(`#sbody input[data-vi="${i}"][data-vf="sb"]`,String(v))}
async function openForm(page){await page.click('#qTx');await page.waitForFunction(()=>!document.getElementById('bldModal').hidden&&BLD_OUT&&BLD_OUT.zoning!==undefined&&BLD_OUT.name.endsWith('_transaction.png'),null,{timeout:20000});
  return page.evaluate(()=>({texts:window.__texts.get(BLD_OUT.cv)||[],dist:BLD_OUT.diag.dist,W:BLD_OUT.W,H:BLD_OUT.H,info:document.getElementById('bldInfo').textContent,
    infoWarn:[...document.querySelectorAll('#bldInfo .warn')].map(x=>x.textContent),approved:BLD_OUT.zoning&&BLD_OUT.zoning.Z.approved,F:BLD_OUT.zoning&&BLD_OUT.zoning.Z.footprint}))}
async function closeForm(page){await page.keyboard.press('Escape');await page.waitForFunction(()=>document.getElementById('bldModal').hidden)}
async function dump(page,name){const dir=process.env.ZR_DUMP;if(!dir)return;fs.mkdirSync(dir,{recursive:true});
  const b64=await page.evaluate(async()=>{const b=new Uint8Array(await BLD_OUT.blob.arrayBuffer());let s='';for(let i=0;i<b.length;i+=32768)s+=String.fromCharCode(...b.subarray(i,i+32768));return btoa(s)});
  fs.writeFileSync(path.join(dir,name+'.png'),Buffer.from(b64,'base64'))}
// strings drawn on the exported sheet (the canvas the PNG and PDF of the sheet are made from)
const SHEET=async()=>{const r=await renderExportCanvas();return{texts:window.__texts.get(r.cvx)||[],w:r.cvx.width,h:r.cvx.height,dropped:LAY.dropped}};
// the mosque program, its layout and the sheet's areas table — compared with the previous version
const DEMO=()=>{const sb=[20,12,20.5,10],roles=['front','side','rear','side'];S.projType='mosque';S.coordMode='local';S.zone=38;S.refLat=24.7135;S.refLon=46.8520;S.geom=null;S.mosque=null;S.house=null;S.layout=null;S.verts=rectVerts(350,200,35).map((p,i)=>({x:p.x,y:p.y,sb:sb[i],role:roles[i],name:i===0?'الطريق الدائري':''}));if(typeof applyProjType==='function')applyProjType();S.img.show=false;persist()};
const MOSQUE=()=>{const m=compute(),r=v=>+(+v).toFixed(6);return{tot:m.tot,men:m.men,women:m.women,W:r(m.W),D:r(m.D),Dm:r(m.Dm),Dw:r(m.Dw),Ds:r(m.Ds),req:m.req,prov:m.prov,roofed:r(m.roofed),cover:r(m.cover),
  plot:r(m.plotArea),bArea:r(m.bArea),q:r(m.q),mosque:S.mosque,house:S.house,layoutOk:m.layoutOk,houseOk:m.houseOk,parts:m.g.parts.map(p=>[p.k,r(p.area||0),p.cap||0]),
  stalls:m.stalls.map(q=>q.map(p=>[+p.x.toFixed(4),+p.y.toFixed(4)])),table:tableRows(m),warn:m.warn}};

(async()=>{const exe=browserPath();assert.ok(exe,'no Chromium/Chrome/Edge found; set CHROME_PATH');
  const srv=await serve(ROOT),base=`http://127.0.0.1:${srv.address().port}/`,browser=await chromium.launch({executablePath:exe,headless:true});
  const errors=[],tmp=fs.mkdtempSync(path.join(os.tmpdir(),'gis-zoning-'));let bsrv=null;
  try{
    const ctx=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
    await ctx.addInitScript(()=>{const W=new WeakMap();window.__texts=W;const f=CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText=function(t,...a){let l=W.get(this.canvas);if(!l)W.set(this.canvas,l=[]);l.push(String(t));return f.call(this,t,...a)}});
    const page=await ctx.newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>d.accept());
    const fresh=async(p,b)=>{await p.goto(b+'index.html');await p.waitForFunction(()=>typeof compute==='function'&&window.polygonClipping);
      await p.evaluate(()=>new Promise(r=>{localStorage.clear();sessionStorage.clear();const q=indexedDB.deleteDatabase('gis-parcel-planner-final');q.onsuccess=q.onerror=q.onblocked=()=>r()}));
      await p.goto(b+'index.html');await p.waitForFunction(()=>typeof compute==='function'&&window.polygonClipping);
      // the user rules (65 % / 75 %, ÷5 front) are off here: this test covers requirements read from the data only (e2e_user_rules.js covers them)
      await p.evaluate(()=>{S.tx.style='full';S.txDef.on=false;if(S.urules){S.urules.on=false;if(typeof urSync==='function')urSync();persist()}})};

    // ---------- 1 · mosque model: unchanged, and its requirements are not assumed ----------
    console.log('Mosque model (default project)');
    await fresh(page,base);await page.evaluate(DEMO);
    const scenario=async p=>{const a=await p.evaluate(MOSQUE);const b=await p.evaluate(()=>{S.cap=3000;S.womenPct=20;S.mosque=null;S.house=null;return null});const b2=await p.evaluate(MOSQUE);
      await p.evaluate(()=>{const d=defaults();S.cap=d.cap;S.womenPct=d.womenPct;S.mosque=null;S.house=null});return[a,b2]};
    const now=await scenario(page);
    const bdir=baselineDir();
    if(bdir&&fs.existsSync(path.join(bdir,'index.html'))){bsrv=await serve(bdir);const bctx=await browser.newContext({viewport:{width:1440,height:1000}}),bp=await bctx.newPage();
      await fresh(bp,`http://127.0.0.1:${bsrv.address().port}/`);await bp.evaluate(DEMO);const old=await scenario(bp);
      assert.deepEqual(now[0],old[0],'default mosque: program, layout, stalls and areas table identical to the previous version');
      assert.deepEqual(now[1],old[1],'mosque with 3000 worshippers / 20 % women: identical to the previous version');
      log(`identical to the previous version (${path.basename(bdir)}): ${now[0].tot} worshippers, ${now[0].req} stalls required / ${now[0].prov} provided, roofed ${now[0].roofed} m², table of ${now[0].table.length} rows; also with 3000 worshippers`);
      await bctx.close()}
    else console.log('  · previous version not found: mosque comparison skipped');
    let z=await page.evaluate(ZSTATE);
    assert.equal(z.tx.zUse,'','project type «مسجد» does not set the land-use class');assert.equal(z.covPct,null);assert.equal(z.F,null);assert.equal(z.footState,'geo-only');assert.ok(!z.approved);
    assert.ok(/الاشتراط غير محدد/.test(z.panel)&&/غير معتمد/.test(z.panel),'panel: «الاشتراط غير محدد», «غير معتمد»');
    assert.ok(/قيم تصميمية في البرنامج وليست اشتراطات معتمدة/.test(await page.textContent('#zrUseHint')),'mosque design parameters are labelled as not approved requirements');
    assert.ok(/أقصى مسطح أرضيغير محدد/.test(z.chips),'status bar: footprint limit «غير محدد»');
    let sh=await page.evaluate(SHEET);assert.ok(sh.texts.includes('الاشتراطات التنظيمية')&&sh.texts.includes('الاشتراط غير محدد'),'sheet block says «الاشتراط غير محدد»');assert.equal(sh.dropped,0,'nothing dropped from the sheet panel');
    log('no requirement assumed for the mosque: coverage / footprint «الاشتراط غير محدد», «غير معتمد»; design parameters labelled; sheet block drawn, nothing dropped');
    // with documented requirements the program is checked against them, and stays exactly the same
    await page.selectOption('#zrUse','mosque');await page.fill('#txRatio','30');await page.fill('#zrRef','اشتراطات المساجد (اختبار)');await page.selectOption('#zrStatus','approved');
    z=await page.evaluate(ZSTATE);const mq=await page.evaluate(MOSQUE);assert.deepEqual({...mq,warn:null},{...now[0],warn:null},'mosque program unchanged by the requirements');
    near(z.F,Math.min(z.G,z.A*0.30),1e-6,'footprint = min(area inside setbacks, 30 % of land)');assert.equal(z.mosque.roofed,mq.roofed);assert.equal(z.mosque.ok,mq.roofed<=z.F+0.005);assert.ok(z.approved);
    assert.equal(z.badges.ratio,'يدوي');sh=await page.evaluate(SHEET);assert.ok(sh.texts.includes('المسقوف (برنامج المسجد)'),'sheet: roofed area of the program against the limit');
    log(`coverage 30 % typed (source «يدوي»): limit ${z.F.toFixed(2)} m² = min(${z.G.toFixed(2)}, ${(z.A*0.3).toFixed(2)}); program roofed ${z.mosque.roofed.toFixed(2)} m² ${z.mosque.ok?'within':'over'} the limit; program and layout unchanged`);
    await page.selectOption('#zrUse','residential');z=await page.evaluate(ZSTATE);assert.ok(z.warn.some(w=>/نوع اللوحة «مسجد» وتصنيف استخدام الأرض «سكني»/.test(w)),'mosque on residential land is pointed out');
    log('a mosque project on land classed «سكني» is pointed out');

    // ---------- 2 · land parcels from GIS ----------
    await page.evaluate(()=>{S.projType='land';S.img.show=false;persist();applyProjType()});
    await page.setInputFiles('#parcelFile',path.join(FX,'zoning-cases.geojson'));await page.waitForFunction(()=>PARCELS.length===7&&PARCELS.every(p=>p.no)&&CUR_PC);

    console.log('Z-SB — setbacks bind');
    await pick(page,'Z-SB');z=await page.evaluate(ZSTATE);
    assert.deepEqual([z.tx.city,z.tx.amana,z.tx.municipality,z.tx.district,z.tx.planNo,z.tx.zUse,z.tx.ratio,z.tx.floors,z.tx.zStatus],['الرياض','أمانة منطقة الرياض','بلدية العليا','حي الروضة','1234','residential','60','3','approved']);
    assert.ok(['city','amana','municipality','district','planNo','zUse','ratio','floors','zRef','zStatus'].every(k=>z.tx.zSrc[k]==='gis'&&z.badges[k]==='GIS'),'every value read from GIS, badge «GIS»');
    assert.equal(z.gState,'none','no setback typed yet');assert.equal(z.F,null);near(z.covTotal,720,1e-6,'coverage limit is known without setbacks');
    log('read from GIS: city, amana, municipality, district, plan, land use, coverage, floors, reference, status (badge «GIS»); setbacks unknown → no footprint');
    await typeSb(page,5);z=await page.evaluate(ZSTATE);
    near(z.A,1200,0.01,'land');near(z.G,600,0.01,'20 × 30 inside 5 m setbacks');near(z.covTotal,720,0.01,'60 %');near(z.F,600,0.01,'footprint');assert.equal(z.bind,'setback');
    assert.ok(z.dist.ok&&z.dist.full,'distribution = the whole buildable zone');near(z.gross,1800,0.01,'600 × 3 floors');assert.equal(z.grossState,'far-missing');near(z.nbTotal,600,0.01,'not buildable');assert.ok(z.approved);
    assert.ok(/القيد الأقوى: الارتدادات/.test(z.panel));
    log('A 1200 · inside setbacks 600 · coverage 720 · footprint 600 (setbacks bind) · gross 1800 (FAR unknown: provisional) · not buildable 600');

    console.log('Z-COV — coverage binds');
    await pick(page,'Z-COV');await typeSb(page,2);z=await page.evaluate(ZSTATE);
    near(z.G,936,0.01,'26 × 36');near(z.F,720,0.01,'footprint');assert.equal(z.bind,'coverage');
    assert.ok(z.dist.ok&&!z.dist.full,'distribution inside the zone');near(z.indep.area,720,0.01,'distribution area (own shoelace)');assert.ok(z.indep.allInside,'inside the parcel');
    assert.ok(z.indep.clear>=-1e-6,`clear of every setback (${z.indep.clear.toFixed(4)} m)`);assert.equal(z.dist.check.outside,0);
    assert.deepEqual(z.nb.map(n=>[n.k,Math.round(n.area*100)/100]),[['setback',264],['coverage',216]]);near(z.nbTotal,480,0.01,'not buildable');
    log(`footprint 720 = min(936, 720), coverage binds; distribution ${z.indep.area.toFixed(4)} m², inside, ≥ ${z.indep.clear.toFixed(3)} m beyond every setback; not buildable 264 (setbacks) + 216 (coverage)`);
    // sheet (land): block, legend and the distribution label
    sh=await page.evaluate(SHEET);const f720=await page.evaluate(()=>fmt(720,2)+' م²');
    assert.ok(sh.texts.includes('الاشتراطات التنظيمية')&&sh.texts.includes(f720)&&sh.texts.includes('نسبة التغطية'),'sheet: zoning block with 720 m² and the binding limit');
    assert.ok(sh.texts.includes('توزيع يحقق نسبة التغطية'),'sheet legend: the distribution');assert.ok(sh.texts.some(t=>t==='توزيع التغطية '+f720),'sheet: distribution labelled on the plan');
    log('sheet: «الاشتراطات التنظيمية» block, legend «توزيع يحقق نسبة التغطية», label on the plan');
    const [dlS]=await Promise.all([page.waitForEvent('download'),page.click('#xPng')]);const sp=path.join(tmp,'sheet.png');await dlS.saveAs(sp);const sb=fs.readFileSync(sp);
    assert.equal(sb.toString('latin1',1,4),'PNG');assert.deepEqual([sb.readUInt32BE(16),sb.readUInt32BE(20)],[sh.w,sh.h],'sheet PNG = export canvas size');
    const [dlP]=await Promise.all([page.waitForEvent('download',{timeout:60000}),page.click('#xPdf')]);const pp=path.join(tmp,'sheet.pdf');await dlP.saveAs(pp);assert.ok(fs.readFileSync(pp).toString('latin1').startsWith('%PDF'),'sheet PDF');
    log(`sheet PNG ${sh.w}×${sh.h} and PDF exported from the same canvas`);
    // buildable-area diagram
    await page.click('#xBld');await page.waitForFunction(()=>!document.getElementById('bldModal').hidden&&BLD_OUT&&BLD_OUT.name.endsWith('_buildable-area.png'));
    assert.ok(/أقصى مسطح أرضي 720\.00 م²/.test(await page.textContent('#bldInfo')),'diagram: footprint limit from the zoning requirements');await closeForm(page);
    log('after-setbacks diagram: «أقصى مسطح أرضي 720.00 م²»');
    // transaction form + PNG / PDF
    let fm=await openForm(page);await dump(page,'Z-COV');
    assert.ok(['1 · إجمالي مساحة الأرض','2 · المساحة داخل الارتدادات','3 · حد نسبة التغطية','4 · الحد الأعلى للمسطح الأرضي','5 · إجمالي مسطحات الأدوار','6 · غير القابل للبناء (أرضي)'].every(t=>fm.texts.includes(t)),'six figures in the form');
    assert.ok(['1,200 م‎²','936 م‎²','720 م‎²','2,160 م‎²','480 م‎²'].every(t=>fm.texts.includes(t)),'their values');assert.ok(fm.texts.includes('حالة الاعتماد: معتمد'));
    assert.ok(fm.dist&&!fm.dist.full,'distribution drawn on the plan');near(fm.dist.area,720,0.01,'drawn distribution area');assert.ok(fm.texts.includes('توزيع يحقق نسبة التغطية'),'colour key');
    assert.equal(fm.H,1210);
    const [dlPng]=await Promise.all([page.waitForEvent('download'),page.click('#bldSave')]);const pngPath=path.join(tmp,'tx.png');await dlPng.saveAs(pngPath);
    const [dlPdf]=await Promise.all([page.waitForEvent('download'),page.click('#bldPdf')]);const pdfPath=path.join(tmp,'tx.pdf');await dlPdf.saveAs(pdfPath);
    const png=fs.readFileSync(pngPath),pdf=fs.readFileSync(pdfPath);
    const cmp=await page.evaluate(async b64=>{const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0)),bmp=await createImageBitmap(new Blob([bytes],{type:'image/png'}),{colorSpaceConversion:'none',premultiplyAlpha:'none'});
      const cv=BLD_OUT.cv,c2=document.createElement('canvas');c2.width=bmp.width;c2.height=bmp.height;const g=c2.getContext('2d');g.drawImage(bmp,0,0);
      const a=g.getImageData(0,0,c2.width,c2.height).data,b=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;let diff=0;if(a.length===b.length)for(let i=0;i<a.length;i++)if(a[i]!==b[i])diff++;
      const jpg=Uint8Array.from(atob(cv.toDataURL('image/jpeg',0.95).split(',')[1]),c=>c.charCodeAt(0));return{w:bmp.width,h:bmp.height,diff,lenOk:a.length===b.length,jpgLen:jpg.length,jpgAll:Array.from(jpg).reduce((h,v)=>(h*31+v)>>>0,7),W:BLD_OUT.W,H:BLD_OUT.H}},png.toString('base64'));
    assert.ok(cmp.lenOk&&cmp.diff===0,`PNG pixels = form canvas (${cmp.diff} differing values)`);
    const s=pdf.toString('latin1'),at=s.indexOf('/DCTDecode');assert.ok(at>0,'PDF has a JPEG image');const streamAt=s.indexOf('stream',at)+6;let st0=streamAt;if(s[st0]==='\r')st0++;if(s[st0]==='\n')st0++;
    let img=pdf.subarray(st0,s.indexOf('endstream',st0));while(img.length&&(img[img.length-1]===10||img[img.length-1]===13))img=img.subarray(0,img.length-1);
    assert.equal(img.length,cmp.jpgLen,'PDF image = canvas JPEG (length)');assert.equal(Array.from(img).reduce((h,v)=>(h*31+v)>>>0,7),cmp.jpgAll,'PDF image = canvas JPEG (bytes)');
    const mb=/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(s);near(+mb[1],cmp.W*0.75,0.01,'PDF width');near(+mb[2],cmp.H*0.75,0.01,'PDF height');
    await closeForm(page);log(`form: six figures, «معتمد», distribution drawn (720 m²); PNG ${cmp.w}×${cmp.h} = canvas, PDF ${mb[1]}×${mb[2]} pt = the same JPEG`);

    console.log('Exceptions and invalid values (Z-COV)');
    await page.click('#zrExcAdd');await page.fill('#zrExcBody input[data-zf="area"]','20');await page.fill('#zrExcBody input[data-zf="desc"]','غرفة حارس');
    z=await page.evaluate(ZSTATE);near(z.covTotal,720,1e-6,'without reference: not counted');assert.ok(z.warn.some(w=>/استثناءات لم تُحتسب: «غرفة حارس» \(بدون مرجع\)/.test(w)));
    await page.fill('#zrExcBody input[data-zf="ref"]','المادة 5 (اختبار)');z=await page.evaluate(ZSTATE);near(z.covTotal,740,1e-6,'720 + 20');near(z.F,740,0.01,'footprint');near(z.indep.area,740,0.01,'distribution');
    await page.click('#zrExcBody [data-zxdel="0"]');z=await page.evaluate(ZSTATE);near(z.F,720,0.01,'exception removed');
    log('exception of 20 m²: ignored without reference (warned), counted with it (limit 740, distribution 740), removed again');
    await page.fill('#txRatio','130');z=await page.evaluate(ZSTATE);assert.equal(z.covPct,null);assert.ok(z.warn.some(w=>/نسبة التغطية المدخلة غير صالحة/.test(w)));assert.equal(z.badges.ratio,'يدوي');
    await page.fill('#txRatio','60');await page.check('#zrFarNA');z=await page.evaluate(ZSTATE);assert.equal(z.grossState,'ok');await page.uncheck('#zrFarNA');
    log('coverage 130 % flagged and treated as «غير محدد»; «FAR غير مطبق» makes the floor area final');

    console.log('Z-L — concave');
    await pick(page,'Z-L');await typeSb(page,2);z=await page.evaluate(ZSTATE);
    near(z.A,1200,0.01,'L-shape');near(z.G,896,0.01,'36×16 + 16×20');near(z.F,600,0.01,'50 %');assert.equal(z.bind,'coverage');near(z.gross,1200,0.01,'min(600 × 2, 1.2 × 1200)');assert.equal(z.grossState,'ok');
    assert.ok(z.dist.ok);near(z.indep.area,600,0.01,'distribution');assert.ok(z.indep.allInside&&z.indep.clear>=-1e-6,'inside, clear of the setbacks');
    assert.ok(!z.approved&&z.reasons.includes('حالة الاعتماد: قيد المراجعة'));assert.ok(/غير معتمد/.test(z.sum),'section summary says «غير معتمد»');
    fm=await openForm(page);await dump(page,'Z-L');assert.ok(fm.texts.includes('حالة الاعتماد: غير معتمد')&&fm.texts.includes('(حالة الاعتماد: قيد المراجعة)'));await closeForm(page);
    log('concave L: inside setbacks 896 (hand-computed), footprint 600, gross 1200 = min(1200, 1440); verified distribution; «غير معتمد (قيد المراجعة)»');

    console.log('Z-MULTI — two parts + a hole');
    await pick(page,'Z-MULTI');await typeSb(page,1);await page.evaluate(()=>{S.geom.rings.forEach(r=>r.edges.forEach(e=>{e.sb=1;e.sbSrc='planner'}));persist()});
    z=await page.evaluate(ZSTATE);near(z.A,1900,0.01,'1600 − 100 + 400');near(z.G,1624,0.01,'(38² − 12²) + 18²');near(z.F,0.4*z.A,1e-6,'40 %');assert.equal(z.bind,'coverage');
    assert.ok(z.dist.ok&&z.indep.parts>=2,'distribution in both parts');near(z.indep.area,z.F,0.01,'distribution area');assert.ok(z.indep.allInside,'clear of the hole');assert.ok(z.indep.clear>=-1e-6,'clear of every setback, hole edges included');
    assert.ok(z.nb.some(n=>n.k==='holes'&&n.outside&&Math.abs(n.area-100)<0.01),'hole listed apart');assert.equal(z.gross,null,'no floors → no total floor area');
    fm=await openForm(page);await dump(page,'Z-MULTI');assert.ok(fm.dist&&fm.texts.includes('الاشتراط غير محدد'));await closeForm(page);
    log(`multipart: A ${z.A.toFixed(2)}, inside setbacks ${z.G.toFixed(2)}, footprint ${z.F.toFixed(2)} in ${z.indep.parts} pieces clear of the hole; hole 100 m² listed outside the land; gross «الاشتراط غير محدد»`);

    console.log('Z-NONE — no requirement');
    await pick(page,'Z-NONE');z=await page.evaluate(ZSTATE);
    assert.deepEqual([z.tx.city,z.tx.district,z.tx.ratio,z.tx.zUse,z.tx.zRef],['','','','',''],'nothing carried over from the previous parcel');
    assert.equal(z.covPct,null);assert.equal(z.F,null);assert.equal(z.gross,null);assert.ok(!z.approved);assert.ok(z.reasons.includes('لا يوجد مرجع رسمي'));
    fm=await openForm(page);await dump(page,'Z-NONE');assert.ok(fm.texts.includes('الاشتراط غير محدد')&&fm.texts.includes('حالة الاعتماد: غير معتمد'));assert.equal(fm.dist,null);
    assert.ok(!fm.texts.some(t=>/^\d[\d,.]* م‎²$/.test(t)&&t!=='900 م‎²'),'no area other than the land area is printed');await closeForm(page);
    await page.fill('#zrRef','');await page.click('#zrSave');assert.match(await page.textContent('#zrRuleInfo'),/لم تُحفظ القاعدة/);
    log('no requirement: «الاشتراط غير محدد» everywhere, no area but the land area printed, «غير معتمد»; a rule cannot be saved without a source');

    console.log('Saved rules by land use and area');
    await pick(page,'Z-COV');z=await page.evaluate(ZSTATE);near(z.F,720,0.01,'Z-COV kept its own requirements and setbacks');
    await page.selectOption('#zrScope','district');await page.fill('#zrName','سكني حي الروضة (اختبار)');await page.click('#zrSave');
    const rules=await page.evaluate(()=>ZR.loadRules());assert.equal(rules.length,1);assert.deepEqual(rules[0].scope,{city:'الرياض',amana:'أمانة منطقة الرياض',municipality:'بلدية العليا',district:'حي الروضة'});
    assert.equal(rules[0].values.ratio,'60');assert.match(rules[0].values.zRef,/المادة 12/);
    await pick(page,'Z-RULE');z=await page.evaluate(ZSTATE);
    assert.equal(z.tx.ratio,'60');assert.equal(z.tx.zRule,rules[0].id);assert.equal(z.badges.ratio,'قاعدة');assert.ok(/طُبّقت تلقائيًا القاعدة «سكني حي الروضة \(اختبار\)»/.test(z.panel));assert.ok(z.approved);
    await typeSb(page,3);z=await page.evaluate(ZSTATE);near(z.G,576,0.01,'24 × 24');near(z.F,540,0.01,'60 % of 900');
    log('rule saved for «سكني» in حي الروضة with its source; applied on its own to Z-RULE (same district, other plan): footprint 540, badge «قاعدة»');
    await pick(page,'Z-OTHER');z=await page.evaluate(ZSTATE);assert.equal(z.tx.ratio,'','another district: no rule applied');
    await page.selectOption('#zrRuleSel',rules[0].id);await page.click('#zrApply');z=await page.evaluate(ZSTATE);assert.equal(z.tx.ratio,'');assert.match(await page.textContent('#zrRuleInfo'),/لا تطابق الحي/);
    log('Z-OTHER (حي النرجس): not applied automatically, and refused when chosen («لا تطابق الحي»)');
    await pick(page,'Z-RULE');z=await page.evaluate(ZSTATE);assert.equal(z.tx.zRule,rules[0].id,'kept per parcel');near(z.F,540,0.01,'kept');
    await page.fill('#txRatio','55');z=await page.evaluate(ZSTATE);assert.equal(z.tx.zRule,'','edited by hand → no longer the rule');assert.equal(z.badges.ratio,'يدوي');near(z.F,495,0.01,'55 % of 900');
    await page.fill('#txDistrict','حي النرجس');await page.fill('#txRatio','60');await page.selectOption('#zrRuleSel',rules[0].id);await page.click('#zrApply');assert.equal(await page.evaluate(()=>S.tx.zRule),'','rule refused for the edited district');
    log('a value edited by hand leaves the rule (badge «يدوي»); a rule is never applied to another district');

    console.log('«مزيد» (Street Tools) linked');
    await pick(page,'Z-COV');await page.click('#moreStreetTools');await page.waitForURL(/street-tools\.html\?parcel=/);
    await page.waitForFunction(()=>document.querySelectorAll('#areaSummary .area-item').length===3&&document.querySelectorAll('#areaSummary .zone-item').length===2,null,{timeout:20000});
    const items=await page.$$eval('#areaSummary .area-item,#areaSummary .zone-item',d=>d.map(x=>[x.querySelector('span').textContent,x.querySelector('b').textContent]));
    const it=k=>(items.find(x=>x[0]===k)||[])[1]||'';assert.match(it('حد نسبة التغطية (نظامي)'),/720(\.00)? م² · 60%/);
    const stB=Number(it('المساحة القابلة للبناء').replace(/[^\d.]/g,''));assert.equal(Number(it('الحد الأعلى للمسطح الأرضي').replace(/[^\d.]/g,'')),Math.min(stB,720),'«مزيد»: footprint = min(its own buildable area, 720)');
    await page.click('.top-link');await page.waitForURL(u=>/index\.html$/.test(u.pathname));await page.waitForFunction(()=>typeof compute==='function'&&window.mainParcelLayerReady);await page.evaluate(()=>window.mainParcelLayerReady);   // layer and the parcel's saved state restored
    assert.equal(await page.evaluate(()=>CUR_PC&&CUR_PC.no),'Z-COV');
    z=await page.evaluate(ZSTATE);near(z.F,720,0.01,'back on the main page');assert.equal(z.tx.ratio,'60');
    log(`«مزيد» shows «حد نسبة التغطية» ${it('حد نسبة التغطية (نظامي)')} and «الحد الأعلى للمسطح الأرضي» ${it('الحد الأعلى للمسطح الأرضي')}; back on the main page with the same figures`);

    assert.deepEqual(errors,[],'no page errors');log('no page errors');
    console.log('e2e_zoning: all checks passed');
  }finally{await browser.close();srv.close();if(bsrv)bsrv.close();try{fs.rmSync(tmp,{recursive:true,force:true})}catch(e){}}
})().catch(e=>{console.error(e);process.exit(1)});
