'use strict';
/* Browser test: MultiPolygon parts and holes across Street Tools and the main planner.
   Needs playwright-core + polygon-clipping (npm i playwright-core polygon-clipping@0.15.7) and Chromium/Chrome (CHROME_PATH).
   Run: node tests/generate_fixtures.js && node tests/e2e_multipart.js */
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core'),clip=require('polygon-clipping');
const ROOT=path.resolve(__dirname,'..'),FX=path.join(__dirname,'fixtures'),G=require('../street-geometry.js');
function browserPath(){if(process.env.CHROME_PATH)return process.env.CHROME_PATH;const local=process.env.LOCALAPPDATA||'',c=[];
  try{for(const d of fs.readdirSync(path.join(local,'ms-playwright')).filter(d=>/^chromium-\d+$/.test(d)).sort().reverse())c.push(path.join(local,'ms-playwright',d,'chrome-win64','chrome.exe'))}catch(e){}
  c.push('C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe');return c.find(p=>fs.existsSync(p))}
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.geojson':'application/geo+json'};
const serve=()=>new Promise(res=>{const srv=http.createServer((q,out)=>{const file=path.join(ROOT,decodeURIComponent(new URL(q.url,'http://x').pathname));
  if(!file.startsWith(ROOT)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){out.writeHead(404);out.end();return}
  out.writeHead(200,{'Content-Type':TYPES[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(file).pipe(out)});srv.listen(0,'127.0.0.1',()=>res(srv))});
const log=(...a)=>console.log('  ✓',...a),num=t=>Number(String(t).replace(/[^\d.\-]/g,'')),near=(a,b,tol,msg)=>assert.ok(Math.abs(a-b)<=tol,`${msg}: ${a} vs ${b}`);
const rows=page=>page.$$eval('#resultRows tr[data-edge]',trs=>trs.map(tr=>({name:tr.cells[2].querySelector('input').value,sb:tr.cells[5].querySelector('input').value,status:tr.cells[8].textContent,approved:tr.cells[7].querySelector('input').checked})));
const area=page=>page.$$eval('#areaSummary .area-item b',bs=>bs.map(b=>b.textContent));
async function pick(page,no){await page.fill('#parcelSearch',no);await page.press('#parcelSearch','Enter');await page.waitForFunction(n=>document.getElementById('mapTitle').textContent.startsWith(n+' '),no);
  await page.waitForFunction(()=>document.querySelectorAll('#resultRows tr[data-edge]').length>0)}
// expected values from the fixture, computed by the shared library exactly as the page does (frame at the mean outer vertex)
const cases=Object.fromEntries(JSON.parse(fs.readFileSync(path.join(FX,'geometry-cases.geojson'),'utf8')).features.map(f=>{const polys=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates;
  const parts=polys.map(p=>({outer:p[0].slice(0,-1),holes:p.slice(1).map(h=>h.slice(0,-1))})),pts=parts.flatMap(p=>p.outer),c=pts.reduce((a,p)=>[a[0]+p[0]/pts.length,a[1]+p[1]/pts.length],[0,0]),fr=G.frame(c[0],c[1]);
  const xy=parts.map(p=>({outer:p.outer.map(q=>fr.toXY(q)),holes:p.holes.map(h=>h.map(q=>fr.toXY(q)))})),r=G.buildableClip(xy,(k,ring,n)=>new Array(n).fill(2),clip);
  return[f.properties.PARCEL_NO,{edges:parts.reduce((n,p)=>n+p.outer.length+p.holes.reduce((t,h)=>t+h.length,0),0),holeEdges:parts.reduce((n,p)=>n+p.holes.reduce((t,h)=>t+h.length,0),0),...r,partCount:parts.length}]}));

(async()=>{const exe=browserPath();assert.ok(exe,'no Chromium/Chrome/Edge found; set CHROME_PATH');
  const srv=await serve(),base=`http://127.0.0.1:${srv.address().port}/`,browser=await chromium.launch({executablePath:exe,headless:true}),errors=[],dialogs=[];
  try{const ctx=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true}),page=await ctx.newPage();
    page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>{dialogs.push(d.message());d.accept()});
    console.log('Street Tools — simple, concave, multipart, hole, invalid');
    await page.goto(base+'street-tools.html');await page.waitForFunction(()=>window.polygonClipping&&window.StreetGeometry);
    await page.selectOption('#rule','fixed');await page.fill('#fixed','2');
    await page.setInputFiles('#parcelFile',path.join(FX,'geometry-cases.geojson'));await page.waitForFunction(()=>/5 قطعة/.test(parcelStatus.textContent));
    await page.setInputFiles('#roadFile',path.join(FX,'geometry-roads.geojson'));await page.waitForFunction(()=>/1 خط شارع/.test(roadStatus.textContent));
    for(const no of ['G-RECT','G-L','G-MULTI','G-HOLE']){await pick(page,no);const want=cases[no],list=await rows(page),a=await area(page);
      assert.equal(list.length,want.edges,`${no}: one row per edge of every ring`);assert.equal(list.filter(r=>r.status==='حدود داخلية').length,want.holeEdges,`${no}: hole edges`);
      assert.ok(list.every(r=>r.sb==='2'),`${no}: fixed 2 m on every edge`);
      near(num(a[0]),want.original,.02,`${no} original area`);near(num(a[1]),want.buildable,.02,`${no} buildable area`);
      const dl=page.waitForEvent('download');await page.click('#downloadJSON');const json=JSON.parse(fs.readFileSync(await (await dl).path(),'utf8'));
      if(G.isMultiParts(json.geometry.parts)){const ids=json.entries.map(e=>G.parseEdgeId(e.key));assert.ok(ids.every(Boolean),`${no}: every edge has a parcel#part/ring/edge id`);
        assert.equal(new Set(json.entries.map(e=>e.key)).size,want.edges);assert.ok(ids.every(id=>id.parcelId===json.parcelId));assert.equal(json.geometry.parts.length,want.partCount)}
      else assert.ok(json.entries.every(e=>/^[\d.]+,[\d.]+>[\d.]+,[\d.]+$/.test(e.key)),`${no}: simple polygon keeps its original edge keys`);
      log(`${no}: ${want.edges} edges (${want.holeEdges} hole edges) · area ${a[0]} · buildable ${a[1]} (expected ${want.original.toFixed(2)} / ${want.buildable.toFixed(2)})`)}
    await pick(page,'G-BAD');let summary=await page.textContent('#areaSummary');assert.ok(summary.includes('تعذّر الحساب')&&summary.includes('يخرج عن حد الجزء'),summary);
    dialogs.length=0;await page.click('#sendBack');await page.waitForTimeout(300);assert.ok(dialogs.some(m=>m.includes('غير مدعومة بالكامل')),dialogs.join('|'));assert.match(page.url(),/street-tools\.html/);
    log('G-BAD (hole outside its boundary): no area number, apply refused with the reason');

    console.log('Apply the multipart parcel to the main planner');
    await pick(page,'G-MULTI');const n=(await rows(page)).length;
    for(let i=0;i<n;i++){const tr=page.locator(`#resultRows tr[data-edge="${i}"]`),name=tr.locator('td').nth(2).locator('input');if(!(await name.inputValue()))await name.fill(`حد ${i+1}`);await name.press('Tab');await tr.locator('td').nth(7).locator('input').check()}
    const st=await area(page);dialogs.length=0;await page.click('#sendBack');await page.waitForURL(/index\.html\?streetResult=/);
    await page.waitForFunction(()=>typeof S!=='undefined'&&S.geom&&S.geom.rings.every(r=>r.edges.every(e=>e.name)),null,{timeout:15000});
    let main=await page.evaluate(()=>{const m=compute(),bg=buildableGeom(m);return{no:CUR_PC.no,plot:m.plotArea,bArea:m.bArea,bg:bg.area,multi:m.multi,
      verts:S.verts.map(v=>[v.name,v.sb]),rings:S.geom.rings.map(r=>({part:r.part,ring:r.ring,names:r.edges.map(e=>e.name),sbs:r.edges.map(e=>e.sb)}))}});
    assert.equal(main.no,'G-MULTI');assert.deepEqual([main.multi.parts,main.multi.holes],[2,1]);
    assert.ok(main.verts.every(([name,sb])=>name&&sb===2),'main ring: names and 2 m setbacks');assert.ok(main.rings.every(r=>r.names.every(Boolean)&&r.sbs.every(v=>v===2)),'other part + hole: names and setbacks');
    near(main.plot,num(st[0]),.05,'plot area main vs Street Tools');near(main.bg,num(st[1]),.05,'buildable main vs Street Tools');near(main.bArea,main.bg,1e-6,'summary = report');
    near(main.plot,cases['G-MULTI'].original,.05,'plot area vs expected');near(main.bg,cases['G-MULTI'].buildable,.05,'buildable vs expected');
    log(`main planner: 2 parts + 1 hole kept; area ${main.plot.toFixed(2)} m², buildable ${main.bg.toFixed(2)} m² — same as Street Tools (${st[0]}, ${st[1]})`);

    // exports and report keep every part and hole
    const ex=await page.evaluate(()=>{const m=compute(),fs=features(m),g=m.geo,{shp,shx}=buildSHP(fs.map(f=>[f.poly,...(f.holes||[])].map(R=>R.map(p=>toUTM(g,p))))),dv=new DataView(shp);
      const dxf=buildDXF(m),kml=buildKML(m,fs);return{plots:fs.filter(f=>f.k==='plot').map(f=>(f.holes||[]).length),setbacks:fs.filter(f=>f.k==='setback').length,records:(shx.byteLength-100)/8,count:fs.length,
        firstParts:dv.getInt32(100+8+36,true),dxfPlot:(dxf.match(/POLYLINE\r?\n\s*8\r?\nPLOT\r?\n/g)||[]).length,inner:(kml.match(/innerBoundaryIs/g)||[]).length}});
    assert.deepEqual(ex.plots,[1,0],'plot features: part 1 with its hole, part 2');assert.equal(ex.records,ex.count);assert.equal(ex.firstParts,2,'shapefile record: outer + hole');
    assert.equal(ex.dxfPlot,3,'DXF: three PLOT rings');assert.ok(ex.inner>=1&&ex.setbacks>=2);
    await page.evaluate(()=>bldOpen(false));await page.waitForFunction(()=>!document.getElementById('bldModal').hidden&&document.getElementById('bldInfo').textContent.length>0);
    await page.evaluate(()=>{closeBld();txOpen(false)});await page.waitForTimeout(400);await page.evaluate(()=>closeBld());await page.evaluate(()=>{render();showCurrentPlot&&showCurrentPlot(false)});
    log(`exports: SHP ${ex.records} records (first with 2 rings), DXF 3 plot rings, KML inner boundary; report, transaction form and sheet drawn`);

    console.log('Isolation and IndexedDB');
    const id=n2=>page.evaluate(no=>PARCELS.find(p=>p.no===no).stableId,n2),closeTx=async()=>{await page.waitForFunction(()=>!document.getElementById('bldModal').hidden);await page.keyboard.press('Escape')};
    await page.selectOption('#parcelSel',await id('G-RECT'));await page.waitForFunction(()=>CUR_PC?.no==='G-RECT');await closeTx();
    let r=await page.evaluate(()=>({geom:S.geom,plot:compute().plotArea,multi:!!compute().multi}));assert.equal(r.geom,null);assert.equal(r.multi,false);near(r.plot,1200,.05,'G-RECT area');
    await page.selectOption('#parcelSel',await id('G-MULTI'));await page.waitForFunction(()=>CUR_PC?.no==='G-MULTI'&&S.geom?.rings?.[0]?.edges?.[0]?.name);await closeTx();
    r=await page.evaluate(()=>({plot:compute().plotArea,b:buildableGeom(compute()).area,names:S.geom.rings.flatMap(x=>x.edges.map(e=>e.name))}));
    near(r.plot,main.plot,1e-6,'restored area');near(r.b,main.bg,1e-6,'restored buildable');assert.ok(r.names.every(Boolean));
    await page.reload();await page.waitForFunction(()=>CUR_PC?.no==='G-MULTI'&&S.geom?.rings?.every(x=>x.edges.every(e=>e.name)));
    log('G-RECT ↔ G-MULTI: no geometry or values mixed; G-MULTI parts, hole and setbacks restored after reload');
    await page.click('#moreStreetTools');await page.waitForURL(/street-tools\.html\?parcel=/);
    await page.waitForFunction(k=>document.getElementById('mapTitle').textContent.startsWith('G-MULTI ')&&document.querySelectorAll('#resultRows tr[data-edge]').length===k,n);
    const back=await rows(page),a2=await area(page);assert.ok(back.every(x=>x.name&&x.sb==='2'),'«مزيد» shows the saved names and setbacks of every ring');
    near(num(a2[0]),main.plot,.05,'«مزيد» area');near(num(a2[1]),main.bg,.05,'«مزيد» buildable');log(`«مزيد» from the main planner: ${n} rows incl. hole edges, areas ${a2[0]} / ${a2[1]}`);

    console.log('Refusals on the main planner (nothing applied)');
    await page.goto(base+'index.html');await page.evaluate(()=>window.mainParcelLayerReady);await page.waitForFunction(()=>CUR_PC?.no==='G-MULTI'&&S.geom);
    const before=await page.evaluate(()=>JSON.stringify([S.verts,S.geom]));
    const send=async(token,make)=>{dialogs.length=0;await page.evaluate(([t,src])=>{const data=(new Function('return '+src))()();sessionStorage.setItem('gis_planner_street_output_v1',JSON.stringify({token:t,data}))},[token,make.toString()]);
      await page.goto(base+'index.html?streetResult='+token);await page.evaluate(()=>window.mainParcelLayerReady);await page.waitForFunction(()=>CUR_PC&&!new URLSearchParams(location.search).get('streetResult'));await page.waitForTimeout(200)};
    await send('drop-part',()=>{const f=mainFullGeometry(),o=f.parts[f.mainPart].outer;return{parcelId:CUR_PC.stableId,geometry:{multi:true,parts:f.parts.slice(0,1)},entries:[{key:StreetGeometry.edgeId(f.parcelId,f.mainPart,0,0,o[0],o[1]),street:'شارع مزور',setback:9,apply:true}]}});
    assert.ok(dialogs.some(m=>m.includes('لا تطابق')),dialogs.join('|'));assert.equal(await page.evaluate(()=>JSON.stringify([S.verts,S.geom])),before);
    await send('bad-edge',()=>{const f=mainFullGeometry(),o=f.parts[f.mainPart].outer;return{parcelId:CUR_PC.stableId,geometry:{multi:true,parts:f.parts},entries:[{key:StreetGeometry.edgeId(f.parcelId,f.mainPart,0,0,[o[0][0]+.001,o[0][1]],o[1]),street:'شارع مزور',setback:9,apply:true}]}});
    assert.ok(dialogs.some(m=>m.includes('تعذّر ربط')),dialogs.join('|'));assert.equal(await page.evaluate(()=>JSON.stringify([S.verts,S.geom])),before);
    await send('single-result',()=>{const g=buildGeo(),ll=p=>{const q=g.F.toLL(p);return[q.lon,q.lat]};return{parcelId:CUR_PC.stableId,entries:[{key:ll(g.L[0]).join(',')+'>'+ll(g.L[1]).join(','),street:'شارع مزور',setback:9,apply:true}]}});
    assert.ok(dialogs.some(m=>m.includes('لا تحمل هندسة كل الأجزاء')),dialogs.join('|'));assert.equal(await page.evaluate(()=>JSON.stringify([S.verts,S.geom])),before);
    await page.selectOption('#parcelSel',await id('G-RECT'));await page.waitForFunction(()=>CUR_PC?.no==='G-RECT');await closeTx();const rectBefore=await page.evaluate(()=>JSON.stringify(S.verts));
    await send('multi-on-simple',()=>{const g=buildGeo(),ll=p=>{const q=g.F.toLL(p);return[q.lon,q.lat]},o=g.L.map(ll);return{parcelId:CUR_PC.stableId,geometry:{multi:true,parts:[{outer:o,holes:[]},{outer:o,holes:[]}]},entries:[{key:StreetGeometry.edgeId(CUR_PC.stableId,0,0,0,o[0],o[1]),street:'شارع مزور',apply:true}]}});
    assert.ok(dialogs.some(m=>m.includes('حلقة واحدة')),dialogs.join('|'));assert.equal(await page.evaluate(()=>JSON.stringify(S.verts)),rectBefore);
    log('missing part, unresolvable edge, single-ring result for a multipart parcel, multipart result for a simple parcel: all refused with a message, data unchanged');
    console.log('Main planner ≡ Street Tools for a concave parcel (original path) and a parcel with a hole');
    for(const no of ['G-L','G-HOLE']){await page.goto(base+'street-tools.html');await page.waitForFunction(()=>/تم استرجاع 5 قطعة/.test(parcelStatus.textContent));await pick(page,no);
      const k=(await rows(page)).length;for(let i=0;i<k;i++){const tr=page.locator(`#resultRows tr[data-edge="${i}"]`),name=tr.locator('td').nth(2).locator('input');if(!(await name.inputValue()))await name.fill(`حد ${i+1}`);await name.press('Tab');await tr.locator('td').nth(7).locator('input').check()}
      const sa=await area(page);await page.click('#sendBack');await page.waitForURL(/index\.html\?streetResult=/);
      await page.waitForFunction(n2=>CUR_PC?.no===n2&&S.verts.every(v=>v.name)&&(!S.geom||S.geom.rings.every(r=>r.edges.every(e=>e.name))),no,{timeout:15000});
      const mm=await page.evaluate(()=>{const m=compute();return{plot:m.plotArea,b:buildableGeom(m).area,multi:!!m.multi,method:buildableGeom(m).method}});
      near(mm.plot,num(sa[0]),.05,`${no} area`);near(mm.b,num(sa[1]),.05,`${no} buildable`);near(mm.b,cases[no].buildable,.05,`${no} buildable expected`);
      assert.equal(mm.multi,no==='G-HOLE');log(`${no}: main ${mm.plot.toFixed(2)} / ${mm.b.toFixed(2)} m² (${mm.multi?'multipart path':'original single-ring path, '+mm.method}) = Street Tools ${sa[0]} / ${sa[1]}`)}
    assert.deepEqual(errors,[],'no page errors');console.log('E2E multipart workflow passed');
  }finally{await browser.close();srv.close()}
})().catch(e=>{console.error(e);process.exit(1)});
