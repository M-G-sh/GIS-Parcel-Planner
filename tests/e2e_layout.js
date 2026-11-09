'use strict';
/* Browser test: placement of the mosque, housing and parking inside the buildable zones (all parts, minus holes, after
   setbacks) — rectangle, L-shape and MultiPolygon with a hole — zone choice, warnings instead of invalid drawings,
   identical layout on the sheet / PNG / PDF / map / DXF / SHP, numbering and coordinates of every part and hole,
   save/restore, and the local (offline) polygon-clipping.
   Needs playwright-core + polygon-clipping (npm i playwright-core polygon-clipping@0.15.7) and Chromium/Chrome (CHROME_PATH).
   Optional: LAYOUT_BASELINE=<folder of the previous version> to compare the rectangle with it (default: the newest
   sibling GIS_Parcel_Planner_Final_backup_layout_* folder, if present).
   Run: node tests/generate_fixtures.js && node tests/e2e_layout.js */
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core'),clip=require('polygon-clipping');
const ROOT=path.resolve(__dirname,'..'),FX=path.join(__dirname,'fixtures');
function browserPath(){if(process.env.CHROME_PATH)return process.env.CHROME_PATH;const local=process.env.LOCALAPPDATA||'',c=[];
  try{for(const d of fs.readdirSync(path.join(local,'ms-playwright')).filter(d=>/^chromium-\d+$/.test(d)).sort().reverse())c.push(path.join(local,'ms-playwright',d,'chrome-win64','chrome.exe'))}catch(e){}
  c.push('C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe');return c.find(p=>fs.existsSync(p))}
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.geojson':'application/geo+json'};
const serve=dir=>new Promise(res=>{const srv=http.createServer((q,out)=>{const file=path.join(dir,decodeURIComponent(new URL(q.url,'http://x').pathname));
  if(!file.startsWith(dir)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){out.writeHead(404);out.end();return}
  out.writeHead(200,{'Content-Type':TYPES[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(file).pipe(out)});srv.listen(0,'127.0.0.1',()=>res(srv))});
const baselineDir=()=>{if(process.env.LAYOUT_BASELINE)return process.env.LAYOUT_BASELINE;const up=path.resolve(ROOT,'..');try{const d=fs.readdirSync(up).filter(x=>/^GIS_Parcel_Planner_Final_backup_layout_/.test(x)).sort().pop();return d?path.join(up,d):null}catch(e){return null}};
const log=(...a)=>console.log('  ✓',...a);
// independent geometry checks with polygon-clipping (the same library, used outside the page)
const R=P=>{const r=P.map(p=>[p.x,p.y]);r.push(r[0].slice());return r};
const areaMP=mp=>mp.reduce((s,pg)=>s+pg.reduce((t,r,k)=>{let a=0;for(let i=0;i<r.length-1;i++)a+=r[i][0]*r[i+1][1]-r[i+1][0]*r[i][1];a=Math.abs(a)/2;return t+(k?-a:a)},0),0);
const outside=(poly,zones)=>areaMP(clip.difference([R(poly)],...zones.map(z=>z.map(R))));
const overlapArea=(a,b)=>areaMP(clip.intersection([R(a)],[R(b)]));
// everything the page shows/exports, read back for comparison
const STATE=`(()=>{const m=compute(),lay=layoutShown(m);return{no:CUR_PC&&CUR_PC.no,mosque:S.mosque,house:S.house,layout:S.layout,parkZone:S.parkZone,ok:m.layoutOk,houseOk:m.houseOk,mosqueZone:m.mosqueZone,
  prov:m.prov,req:m.req,zones:m.zones.map(z=>z.rings),zoneAreas:m.zones.map(z=>z.area),blocks:lay.parts.map(p=>({k:p.k,poly:p.poly})),stalls:lay.stalls,warn:m.warn,
  holes:(m.partRings||[]).flatMap(pg=>pg.slice(1)),plotHoles:m.multi?m.multi.holes:0}})()`;
const settle=page=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));

(async()=>{const exe=browserPath();assert.ok(exe,'no Chromium/Chrome/Edge found; set CHROME_PATH');
  const srv=await serve(ROOT),base=`http://127.0.0.1:${srv.address().port}/`,browser=await chromium.launch({executablePath:exe,headless:true});
  const errors=[],dialogs=[],toasts=[];const open=async(ctx,url)=>{const p=await ctx.newPage();p.on('pageerror',e=>errors.push(String(e)));p.on('dialog',d=>{dialogs.push(d.message());d.accept()});await p.goto(url);return p};
  try{
    // ---------- 1 · offline: polygon-clipping from the local copy, nothing from the internet ----------
    console.log('Offline (only the local server is reachable)');
    const off=await browser.newContext({viewport:{width:1440,height:1000}});const blocked=[];
    await off.route('**/*',route=>{const u=route.request().url();if(u.startsWith(base))route.continue();else{blocked.push(u);route.abort()}});
    let page=await open(off,base+'index.html');await page.waitForFunction(()=>typeof compute==='function'&&window.polygonClipping);
    const res=await page.evaluate(()=>({L:typeof window.L,pc:performance.getEntriesByType('resource').map(e=>e.name).filter(n=>/polygon-clipping/.test(n)),v:typeof polygonClipping.difference}));
    assert.equal(res.L,'undefined','CDN libraries are really blocked');assert.equal(res.pc.length,1);assert.match(res.pc[0],/\/vendor\/polygon-clipping\/polygon-clipping\.umd\.min\.js$/);
    // the page opens as «أرض فقط»: choose «مسجد» in «نوع اللوحة» as a user does, which also shows the mosque sections (07 …)
    await page.selectOption('#projType','mosque');await page.evaluate(()=>{S.cap=300;S.housingArea=60;persist()});
    await page.setInputFiles('#parcelFile',path.join(FX,'layout-cases.geojson'));await page.waitForFunction(()=>PARCELS.length===3&&PARCELS.every(x=>x.no));
    await selectParcel(page,'Y-L');let st=await page.evaluate(STATE);const zl=await page.evaluate(()=>({exact:M.zonesExact,area:M.zones.reduce((s,z)=>s+z.area,0)}));
    assert.ok(zl.exact,'concave zone computed by clipping offline');assert.ok(st.ok&&st.blocks.length>0,'layout placed offline');
    // expected L zone: (80×60 − 40×30) minus 3 m setbacks on every edge = 74×24 + 34×30
    assert.ok(Math.abs(zl.area-(74*24+34*30))<0.5,'L zone area '+zl.area);
    const sp=await open(off,base+'street-tools.html');await sp.waitForFunction(()=>window.polygonClipping&&window.StreetGeometry);
    await sp.selectOption('#rule','fixed');await sp.fill('#fixed','2');await sp.setInputFiles('#parcelFile',path.join(FX,'geometry-cases.geojson'));await sp.waitForFunction(()=>/5 قطعة/.test(parcelStatus.textContent));
    await sp.fill('#parcelSearch','G-HOLE');await sp.press('#parcelSearch','Enter');await sp.waitForFunction(()=>/^G-HOLE /.test(mapTitle.textContent)&&document.querySelectorAll('#areaSummary .area-item b').length===3);
    const hb=await sp.$$eval('#areaSummary .area-item b',b=>b.map(x=>x.textContent));assert.equal(hb[1].replace(/[^\d.]/g,''),'1100','Street Tools buildable area with a hole, offline');
    assert.ok(blocked.some(u=>/leaflet|jsdelivr|fonts\.g/.test(u)),'external requests were attempted and blocked');
    log(`local vendor/polygon-clipping used with ${blocked.length} external requests blocked: L zone ${zl.area.toFixed(0)} m² (expected ${74*24+34*30}), Street Tools hole parcel 1,100 m²`);
    await off.close();

    // ---------- 2 · layout inside the buildable zones ----------
    console.log('Layout inside the buildable zones (300 worshippers, housing 60 m², setbacks 3 m)');
    const ctx=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});page=await open(ctx,base+'index.html');
    page.on('console',msg=>{if(/toast:/.test(msg.text()))toasts.push(msg.text())});
    await page.waitForFunction(()=>typeof compute==='function'&&window.polygonClipping);
    await page.selectOption('#projType','mosque');assert.ok(await page.isVisible('#autoBtn'),'«توزيع تلقائي» shown for a mosque project');
    await page.evaluate(()=>{const t=window.toast;window.toast=m=>{console.log('toast: '+m);return t(m)};S.cap=300;S.housingArea=60;S.img.show=false;S.exp.coords='local';persist()});
    await page.setInputFiles('#parcelFile',path.join(FX,'layout-cases.geojson'));await page.waitForFunction(()=>PARCELS.length===3&&PARCELS.every(x=>x.no));
    const saved={};
    for(const no of ['Y-RECT','Y-L','Y-MULTI']){await selectParcel(page,no);await page.click('#autoBtn');await settle(page);st=await page.evaluate(STATE);
      assert.ok(st.ok,`${no}: mosque placed`);
      for(const b of st.blocks)assert.ok(outside(b.poly,st.zones)<1e-4,`${no}: ${b.k} inside the buildable zones (outside area ${outside(b.poly,st.zones)})`);
      for(const q of st.stalls)assert.ok(outside(q,st.zones)<1e-4,`${no}: stall inside the zones`);
      for(const h of st.holes)for(const b of [...st.blocks.map(x=>x.poly),...st.stalls])assert.ok(overlapArea(b,h)<1e-6,`${no}: nothing over a hole`);
      for(const q of st.stalls)for(const b of st.blocks)assert.ok(overlapArea(q,b.poly)<1e-6,`${no}: stall clear of buildings`);
      saved[no]=st;log(`${no}: ${st.blocks.length} blocks${st.houseOk?' incl. housing':''}, ${st.prov}/${st.req} stalls — all inside ${st.zones.length} zone(s)${st.holes.length?', clear of the hole':''}${st.prov<st.req?' · shortfall warned':''}`)}
    assert.ok(saved['Y-L'].warn.some(w=>/المواقف المتوفرة 12 أقل من المطلوب 25/.test(w)),'parking shortfall is a clear warning');
    assert.ok(!saved['Y-L'].warn.some(w=>/تقريبي|أكبر من الأرض/.test(w)),'no false approximation / setback warnings on a valid L-shape');

    // ---------- 3 · rectangle identical to the previous version ----------
    const bdir=baselineDir();
    if(bdir&&fs.existsSync(path.join(bdir,'index.html'))){const bsrv=await serve(bdir),bctx=await browser.newContext({viewport:{width:1440,height:1000}}),bp=await open(bctx,`http://127.0.0.1:${bsrv.address().port}/index.html`);
      await bp.waitForFunction(()=>typeof compute==='function'&&window.polygonClipping);await bp.selectOption('#projType','mosque');await bp.evaluate(()=>{S.cap=300;S.housingArea=60;S.img.show=false;persist()});
      await bp.setInputFiles('#parcelFile',path.join(FX,'layout-cases.geojson'));await bp.waitForFunction(()=>PARCELS.length===3&&PARCELS.every(x=>x.no));await selectParcel(bp,'Y-RECT');await bp.click('#autoBtn');await settle(bp);
      const old=await bp.evaluate(()=>{const m=compute();return{mosque:S.mosque,house:S.house,prov:m.prov,stalls:m.stalls}});const nw=saved['Y-RECT'];
      assert.deepEqual(nw.mosque,old.mosque);assert.deepEqual(nw.house,old.house);assert.equal(nw.prov,old.prov);assert.deepEqual(JSON.parse(JSON.stringify(nw.stalls)),JSON.parse(JSON.stringify(old.stalls)));
      log(`rectangle identical to the previous version (${path.basename(bdir)}): mosque (${old.mosque.x}, ${old.mosque.y}), housing, ${old.prov} stalls with the same coordinates`);await bctx.close();bsrv.close()}
    else console.log('  · previous version not found: rectangle baseline comparison skipped');

    // ---------- 4 · several zones: choice, no automatic move, warnings ----------
    console.log('Separate buildable zones (Y-MULTI)');
    await selectParcel(page,'Y-MULTI');await page.click('#autoBtn');await settle(page);
    let ui=await page.evaluate(()=>({row:!document.getElementById('zoneRow').hidden,park:!document.getElementById('parkZoneRow').hidden,opts:[...document.querySelectorAll('#bldZone option')].map(o=>o.textContent),value:document.getElementById('bldZone').value}));
    assert.ok(ui.row&&ui.park,'zone choices shown');assert.equal(ui.opts.length,3);assert.equal(ui.value,'0','mosque in the largest zone');
    const before=(await page.evaluate(STATE)).mosque;
    await page.selectOption('#bldZone','1');await settle(page);st=await page.evaluate(STATE);
    assert.equal(st.ok,false,'300 worshippers do not fit in zone 2');assert.equal(st.blocks.length+st.stalls.length,0,'nothing drawn');
    const w=st.warn.find(x=>/منطقة البناء المختارة/.test(x));assert.ok(w&&/لم يُنقل المسجد تلقائيًا/.test(w)&&/تتسع في: المنطقة ١/.test(w),w);
    assert.ok(!st.zones[0]||outside(mosqueRect(st.mosque),[st.zones[0]])>1,'the mosque was not moved into zone 1 automatically');
    await page.evaluate(()=>{S.cap=60;persist();schedule()});await settle(page);st=await page.evaluate(STATE);
    assert.equal(st.ok,false,'a smaller program is not re-placed without review');
    await page.click('#autoBtn');await settle(page);st=await page.evaluate(STATE);
    assert.ok(st.ok&&st.mosqueZone===1,'after review (auto layout in the chosen zone) the mosque is in zone 2');
    for(const b of st.blocks)assert.ok(outside(b.poly,[st.zones[1]])<1e-4,b.k+' inside zone 2');
    const inZone2=st.stalls.length;assert.ok(st.stalls.every(q=>outside(q,[st.zones[1]])<1e-4),'parking in the mosque zone only');
    await page.evaluate(()=>{document.getElementById('secPark').open=true});await page.selectOption('#parkZone','all');await settle(page);st=await page.evaluate(STATE);
    assert.ok(st.stalls.length>inZone2&&st.stalls.every(q=>outside(q,st.zones)<1e-4),'parking in every zone when chosen');
    log(`zone 2 chosen → warning "${w.slice(0,48)}…", nothing drawn, not moved; after «توزيع تلقائي» placed in zone 2; parking ${inZone2} (zone of the mosque) → ${st.stalls.length} (all zones)`);
    await page.evaluate(()=>{S.cap=300;S.parkZone='mosque';persist();schedule()});await settle(page);await page.selectOption('#bldZone','0');await settle(page);
    st=await page.evaluate(STATE);assert.ok(st.ok&&st.mosqueZone===0);assert.deepEqual(st.mosque,before,'choosing zone 1 again gives the same placement');

    // ---------- 5 · dragging never leaves the allowed area or covers the hole ----------
    await page.click('#tabSheet');await settle(page);
    const hole=st.holes[0],hc=hole.reduce((a,p)=>({x:a.x+p.x/hole.length,y:a.y+p.y/hole.length}),{x:0,y:0});
    const a0=await toScreen(page,st.mosque),a1=await toScreen(page,hc);toasts.length=0;
    await page.mouse.move(a0.x,a0.y);await page.mouse.down();await page.mouse.move(a1.x,a1.y,{steps:25});await page.mouse.up();await settle(page);
    st=await page.evaluate(STATE);assert.ok(st.ok,'mosque still valid after dragging toward the hole');
    for(const b of st.blocks)assert.ok(overlapArea(b.poly,hole)<1e-6&&outside(b.poly,st.zones)<1e-4,'dragged blocks inside the zones, off the hole');
    assert.ok(toasts.some(t=>/لا يمكن وضع المبنى/.test(t)),'the user is told why the move stopped');
    log(`drag onto the hole stopped at the last valid position (${st.mosque.x}, ${st.mosque.y}) with a message`);

    // ---------- 6 · the same layout on the sheet, PNG, PDF, map, DXF and SHP ----------
    const out=await page.evaluate(async()=>{S.img.show=false;M=compute();const m=M,lay=layoutShown(m),sahn=lay.parts.find(p=>p.k==='sahn'),women=lay.parts.find(p=>p.k==='women');
      const dxf=buildDXF(m).split(/\r?\n/),polys=[];for(let i=0;i<dxf.length-1;i+=2){const c2=dxf[i].trim(),v=dxf[i+1];if(c2==='0'&&v==='POLYLINE')polys.push({layer:dxf[i+3],pts:[]});else if(c2==='0'&&v==='VERTEX'){const p=polys[polys.length-1];p.pts.push({x:+dxf[i+5],y:+dxf[i+7]})}}
      const fs2=features(m),shp=buildSHP(fs2.map(f=>[f.poly,...(f.holes||[])].map(R=>R.map(p=>toUTM(m.geo,p))))),dv=new DataView(shp.shp);
      const {cvx,W}=await renderExportCanvas(),ppm=cvx.width/W,cx=cvx.getContext('2d'),px=pt=>{const q=w2p(pt);return[...cx.getImageData(Math.round(q.x*ppm),Math.round(q.y*ppm),1,1).data].slice(0,3)};
      const inner=(poly,f)=>{const c0=centroid(poly),v=poly[0];return{x:v.x+(c0.x-v.x)*f,y:v.y+(c0.y-v.y)*f}};
      const holeC=centroid((m.partRings||[]).flatMap(pg=>pg.slice(1))[0]);
      let mapPolys=[];if(map){showCurrentPlot(false);curPoly.eachLayer(l=>{const k=(l.options.className||'').replace('lay-','');if(l.options.className)mapPolys.push({k,pts:l.getLatLngs()[0].map(ll=>m.geo.F.fromLL({lat:ll.lat,lon:ll.lng}))})})}
      return{blocks:lay.parts.map(p=>({k:p.k,poly:p.poly})),stalls:lay.stalls.length,dxf:polys.filter(p=>['HALL','WOMEN','SAHN','ABLUTION','MINARET','HOUSING','PARKING'].includes(p.layer)).map(p=>({layer:p.layer,pts:p.pts})),
        shpBlocks:fs2.filter(f=>['hall','mihrab','women','sahn','ablM','ablW','minaret','house'].includes(f.k)).map(f=>({k:f.k,poly:f.poly})),shpStalls:fs2.filter(f=>f.k==='park').length,shpRecords:(shp.shx.byteLength-100)/8,
        pngSahn:px(inner(sahn.poly,0.2)),pngWomen:px(inner(women.poly,0.2)),pngHole:px(holeC),colSahn:COL.sahn.f,colWomen:COL.women.f,mapPolys}});
    const hex=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)),near=(a,b)=>a.every((v,i)=>Math.abs(v-b[i])<=3);
    assert.deepEqual(out.shpBlocks.map(b=>b.k),out.blocks.map(b=>b.k),'SHP has exactly the drawn blocks');out.shpBlocks.forEach((b,i)=>assert.deepEqual(b.poly,out.blocks[i].poly));assert.equal(out.shpStalls,out.stalls);
    const dxfBlocks=out.dxf.filter(p=>p.layer!=='PARKING');assert.equal(dxfBlocks.length,out.blocks.length,'DXF has exactly the drawn blocks');
    dxfBlocks.forEach((p,i)=>p.pts.forEach((q,j)=>assert.ok(Math.abs(q.x-out.blocks[i].poly[j].x)<1e-3&&Math.abs(q.y-out.blocks[i].poly[j].y)<1e-3,'DXF vertex = sheet vertex')));
    assert.equal(out.dxf.filter(p=>p.layer==='PARKING').length,out.stalls,'DXF stalls = sheet stalls');
    assert.ok(near(out.pngSahn,hex(out.colSahn))&&near(out.pngWomen,hex(out.colWomen)),'PNG shows the blocks where the sheet has them: '+JSON.stringify([out.pngSahn,out.colSahn,out.pngWomen,out.colWomen]));
    assert.ok(!near(out.pngHole,hex(out.colSahn))&&!near(out.pngHole,hex(out.colWomen)),'PNG: nothing built on the hole');
    if(out.mapPolys.length){const mb=out.mapPolys.filter(p=>p.k!=='park');assert.equal(mb.length,out.blocks.length);mb.forEach((p,i)=>p.pts.forEach((q,j)=>assert.ok(Math.hypot(q.x-out.blocks[i].poly[j].x,q.y-out.blocks[i].poly[j].y)<0.01,'map vertex = sheet vertex')))}
    else console.log('  · map not opened (Leaflet unavailable): map comparison skipped');
    let pdf=await page.evaluate(async()=>{window.__saved=null;saveFile=async(n,d)=>{window.__saved={name:n,size:d.size}};if(!window.jspdf)return null;document.getElementById('xPdf').click();
      for(let i=0;i<200&&!window.__saved;i++)await new Promise(r=>setTimeout(r,100));return window.__saved});
    assert.ok(!pdf||(/\.pdf$/.test(pdf.name)&&pdf.size>10000),'PDF written from the same export canvas');
    log(`sheet = PNG (pixel check) = map = DXF = SHP: ${out.blocks.length} blocks and ${out.stalls} stalls with identical coordinates; ${pdf?'PDF '+Math.round(pdf.size/1024)+' KB from the same canvas':'PDF skipped (jsPDF offline)'}`);

    // ---------- 7 · no room: a warning, never an invalid drawing ----------
    await selectParcel(page,'Y-RECT');await page.evaluate(()=>{S.cap=3000;persist();schedule()});await settle(page);st=await page.evaluate(STATE);
    const empty=await page.evaluate(()=>{const m=compute(),dx=buildDXF(m);return{dxfHall:/\nHALL\r?\n/.test(dx)&&/POLYLINE\r?\n\s*8\r?\nHALL/.test(dx),shp:features(m).filter(f=>f.k!=='plot'&&f.k!=='setback').length,qibla:/(^|\n)0\r?\nLINE\r?\n8\r?\nQIBLA/.test(dx)}});
    assert.equal(st.ok,false);assert.equal(st.blocks.length+st.stalls.length,0);assert.ok(st.warn.some(x=>/كتلة المسجد لا تتسع/.test(x)&&/لم تُرسم الكتل والمواقف/.test(x)));
    assert.equal(empty.dxfHall,false);assert.equal(empty.shp,0);assert.equal(empty.qibla,false);
    log('3,000 worshippers on 80×60: warning shown; no block, stall or qibla line on the sheet, DXF, SHP or map');
    await page.evaluate(()=>{S.cap=300;persist();schedule()});await settle(page);

    // ---------- 8 · numbering and coordinates of every part and hole ----------
    await selectParcel(page,'Y-MULTI');await settle(page);
    const num=await page.evaluate(()=>{const m=compute();return{groups:coordGroups(m).map(g=>({title:g.title,nos:g.rows.map(r=>r.no),lens:g.rows.map(r=>+r.len.toFixed(2))})),dxf:buildDXF(m)}});
    assert.deepEqual(num.groups.map(g=>g.title),['الجزء ١ (الرئيسي)','الجزء ٢','فراغ ١ — داخل الجزء ١']);
    assert.deepEqual(num.groups.map(g=>g.nos),[[1,2,3,4],[5,6,7,8],[9,10,11,12]]);
    assert.deepEqual(num.groups[2].lens.slice().sort(),[15,15,20,20],'hole edge lengths');
    assert.ok(['5','8','9','12'].every(n=>new RegExp('\\n1\\r?\\n'+n+'\\r?\\n').test(num.dxf)),'DXF carries the numbers of the other part and the hole');
    const coordsDrawn=await page.evaluate(()=>{S.sheet.coords=true;const calls=[];const t0=txt;txt=(s,...a)=>{calls.push(String(s));return t0(s,...a)};try{drawSheet(document.createElement('canvas').getContext('2d'),1,compute())}finally{txt=t0}return calls});
    assert.ok(['الجزء ١ (الرئيسي)','الجزء ٢','فراغ ١ — داخل الجزء ١','١٢'].every(t=>coordsDrawn.includes(t)),'sheet shows the part titles and the continued numbers');
    await page.click('#moreStreetTools');await page.waitForURL(/street-tools\.html\?parcel=/);
    await page.waitForFunction(()=>/^Y-MULTI /.test(document.getElementById('mapTitle').textContent)&&document.querySelectorAll('#resultRows tr[data-edge]').length===12);
    const st2=await page.$$eval('#resultRows tr[data-edge]',trs=>trs.map(tr=>[tr.querySelector('.edge-num').textContent,tr.querySelector('.edge-part')?.textContent||'']));
    assert.deepEqual(st2.map(r=>r[0]),['1','2','3','4','5','6','7','8','9','10','11','12']);
    assert.deepEqual([...new Set(st2.map(r=>r[1]))],['الجزء 1 (الرئيسي)','الجزء 2','فراغ 1 · الجزء 1']);
    log('coordinates table and drawing: part 1 (main) 1–4, part 2 5–8, hole 1 9–12; the same numbers and parts in «مزيد» and the DXF');

    // ---------- 9 · save and restore every case ----------
    await page.goto(base+'index.html');await page.evaluate(()=>window.mainParcelLayerReady);
    const snap={};
    for(const no of ['Y-RECT','Y-L','Y-MULTI']){await selectParcel(page,no);if(no==='Y-L'){await page.evaluate(()=>{S.mosque={x:S.mosque.x+1,y:S.mosque.y};persist();schedule()});await settle(page)}
      if(no==='Y-MULTI'){await page.evaluate(()=>{document.getElementById('secPark').open=true});await page.selectOption('#parkZone','all');await settle(page)}
      snap[no]=await page.evaluate(STATE);assert.ok(snap[no].ok)}
    for(const no of ['Y-RECT','Y-L','Y-MULTI']){await selectParcel(page,no);const r2=await page.evaluate(STATE);
      for(const k of ['mosque','house','layout','parkZone','prov'])assert.deepEqual(r2[k],snap[no][k],`${no}: ${k} restored after switching parcels`)}
    await page.reload();await page.evaluate(()=>window.mainParcelLayerReady);await settle(page);const r3=await page.evaluate(STATE);
    assert.equal(r3.no,'Y-MULTI');for(const k of ['mosque','house','layout','parkZone','prov'])assert.deepEqual(r3[k],snap['Y-MULTI'][k],`after reload: ${k}`);
    assert.ok(r3.zones.length===2&&r3.plotHoles===1,'parts and hole restored');
    log('Y-RECT, Y-L (moved by hand) and Y-MULTI (zone + parking in all zones): positions, zone, parking choice and stalls restored after switching parcels and after reload');

    // ---------- 10 · main part listed second: numbering still starts on the main part, on both pages ----------
    await page.setInputFiles('#parcelFile',path.join(FX,'layout-reversed.geojson'));await page.waitForFunction(()=>PARCELS.length===1&&CUR_PC&&CUR_PC.no==='Y-REV'&&S.geom);await settle(page);
    const rev=await page.evaluate(()=>{const m=compute();return{mainPart:S.geom.mainPart,groups:coordGroups(m).map(g=>[g.title,g.rows[0].no,g.rows.length]),ok:m.layoutOk}});
    assert.equal(rev.mainPart,1);assert.deepEqual(rev.groups,[['الجزء ٢ (الرئيسي)',1,4],['الجزء ١',5,4],['فراغ ١ — داخل الجزء ٢',9,4]]);
    await page.click('#moreStreetTools');await page.waitForURL(/street-tools\.html\?parcel=/);
    await page.waitForFunction(()=>/^Y-REV /.test(document.getElementById('mapTitle').textContent)&&document.querySelectorAll('#resultRows tr[data-edge]').length===12);
    const revRows=await page.$$eval('#resultRows tr[data-edge]',trs=>trs.map(tr=>[tr.querySelector('.edge-num').textContent,tr.querySelector('.edge-part')?.textContent||'',tr.dataset.edge]));
    assert.deepEqual(revRows.map(r=>r[0]),['1','2','3','4','5','6','7','8','9','10','11','12']);
    assert.deepEqual([...new Set(revRows.map(r=>r[1]))],['الجزء 2 (الرئيسي)','الجزء 1','فراغ 1 · الجزء 2']);assert.equal(revRows[0][2],'4','row order follows the numbers, stored order unchanged');
    log('Y-REV (main part listed second): main planner and «مزيد» both number the main part 1–4, part 1 5–8, the hole 9–12');
    assert.deepEqual(errors,[],'no page errors');console.log('E2E layout passed');
  }finally{await browser.close();srv.close()}
})().catch(e=>{console.error(e);process.exit(1)});

async function selectParcel(page,no){const id=await page.evaluate(n=>PARCELS.find(x=>x.no===n).stableId,no);
  if(await page.evaluate(i=>CUR_PC&&CUR_PC.stableId===i,id))return;
  await page.selectOption('#parcelSel',id);await page.waitForFunction(n=>CUR_PC&&CUR_PC.no===n,no);
  await page.waitForFunction(()=>!document.getElementById('bldModal').hidden);await page.keyboard.press('Escape');await page.waitForFunction(()=>document.getElementById('bldModal').hidden)}
async function toScreen(page,pt){return page.evaluate(p=>{const r=document.getElementById('cv').getBoundingClientRect(),{W,H}=paperDims(),q=w2p(p);return{x:r.left+q.x/W*r.width,y:r.top+q.y/H*r.height}},pt)}
function mosqueRect(p){return[{x:p.x-1,y:p.y-1},{x:p.x+1,y:p.y-1},{x:p.x+1,y:p.y+1},{x:p.x-1,y:p.y+1}]}
