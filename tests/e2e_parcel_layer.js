'use strict';
/* Browser test of the full parcel/street layer workflow (Street Tools ⇄ main planner), on a local HTTP server.
   Needs playwright-core and a Chromium/Chrome build; internet is used for Leaflet/JSZip/fonts like the real pages.
     npm i playwright-core   (anywhere on NODE_PATH)
     node tests/generate_fixtures.js && node tests/e2e_parcel_layer.js
   CHROME_PATH selects the browser (default: Playwright's Chromium in %LOCALAPPDATA%\ms-playwright, then Chrome/Edge). */
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const ROOT=path.resolve(__dirname,'..'),FX=path.join(__dirname,'fixtures'),G=require('../street-geometry.js');
const expected=JSON.parse(fs.readFileSync(path.join(FX,'grid-expected.json'),'utf8'));
function browserPath(){if(process.env.CHROME_PATH)return process.env.CHROME_PATH;const local=process.env.LOCALAPPDATA||'',cands=[];
  try{for(const d of fs.readdirSync(path.join(local,'ms-playwright')).filter(d=>/^chromium-\d+$/.test(d)).sort().reverse())cands.push(path.join(local,'ms-playwright',d,'chrome-win64','chrome.exe'))}catch(e){}
  cands.push('C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe');return cands.find(p=>fs.existsSync(p))}
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.geojson':'application/geo+json','.png':'image/png','.svg':'image/svg+xml'};
function serve(){return new Promise(res=>{const srv=http.createServer((req,out)=>{const file=path.join(ROOT,decodeURIComponent(new URL(req.url,'http://x').pathname));
    if(!file.startsWith(ROOT)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){out.writeHead(404);out.end();return}
    out.writeHead(200,{'Content-Type':TYPES[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(file).pipe(out)});
  srv.listen(0,'127.0.0.1',()=>res(srv))})}
const log=(...a)=>console.log('  ✓',...a),num=t=>Number(String(t).replace(/[^\d.\-]/g,''));
const rows=page=>page.$$eval('#resultRows tr[data-edge]',trs=>trs.map(tr=>({length:tr.cells[1].textContent,name:tr.cells[2].querySelector('input').value,width:tr.cells[4].querySelector('input').value,
  widthSource:tr.cells[4].querySelector('.src')?.textContent||'',sb:tr.cells[5].querySelector('input').value,sbSource:tr.cells[5].querySelector('.src')?.textContent||'',suggested:tr.cells[5].querySelector('.sb-suggested')?.textContent||'',
  face:tr.cells[6].querySelector('select').value,approved:tr.cells[7].querySelector('input').checked,status:tr.cells[8].textContent})));
const area=page=>page.$$eval('#areaSummary .area-item b',bs=>bs.map(b=>b.textContent));
async function pick(page,no){await page.fill('#parcelSearch',no);await page.press('#parcelSearch','Enter');await page.waitForFunction(n=>document.getElementById('mapTitle').textContent.startsWith(n+' '),no);
  await page.waitForFunction(()=>document.querySelectorAll('#resultRows tr[data-edge]').length>0)}
async function setCell(page,edge,col,value){const input=page.locator(`#resultRows tr[data-edge="${edge}"]`).locator('td').nth(col).locator('input').first();await input.fill(String(value));await input.press('Tab')}
function checkParcel(no,list){const want=expected[no];assert.equal(list.length,4,`${no}: 4 edges`);
  list.forEach((r,i)=>{const w=want.edges[i],len=num(r.length);assert.ok(Math.abs(len-(i%2?{4:12}[want.row]??35:30))<.011,`${no} edge ${i+1}: length ${r.length}`);
    if(w){assert.equal(r.name,w.street,`${no} edge ${i+1}`);assert.equal(r.width===''?null:Number(r.width),w.width,`${no} edge ${i+1} width`);assert.equal(r.face,'front');
      assert.equal(r.widthSource,w.width===null?'بدون عرض':'من بيانات GIS')}
    else{assert.equal(r.name,'',`${no} edge ${i+1} must be unmatched`);assert.equal(r.status,'غير مرتبط');assert.equal(r.face,'side')}})}

(async()=>{
  const exe=browserPath();assert.ok(exe,'no Chromium/Chrome/Edge found; set CHROME_PATH');
  const srv=await serve(),base=`http://127.0.0.1:${srv.address().port}/`,browser=await chromium.launch({executablePath:exe,headless:true}),errors=[];
  const timings={};const t=async(label,fn)=>{const t0=Date.now();const v=await fn();timings[label]=Date.now()-t0;return v};
  const newPage=async ctx=>{const page=await ctx.newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>d.accept());return page};
  try{
    console.log('Street Tools with a 120-parcel layer');
    const ctx=await browser.newContext({viewport:{width:1440,height:1000},locale:'ar'});let page=await newPage(ctx);
    await page.goto(base+'street-tools.html');
    await t('upload 120 parcels',async()=>{await page.setInputFiles('#parcelFile',path.join(FX,'grid-120-parcels.geojson'));await page.waitForFunction(()=>/120 قطعة/.test(document.getElementById('parcelStatus').textContent))});
    await page.setInputFiles('#roadFile',path.join(FX,'grid-roads.geojson'));await page.waitForFunction(()=>/7 خط شارع/.test(document.getElementById('roadStatus').textContent));
    assert.equal(await page.locator('#parcelSelect option').count(),120);assert.ok(await page.isVisible('#parcelSearch'));
    assert.equal(await page.inputValue('#streetField'),'STREET_NAME');assert.equal(await page.inputValue('#widthField'),'WIDTH_M');log('layer loaded, 120 parcels listed, street/width fields detected');

    const cases={'P-R0C01':'one street','P-R0C03':'two streets (corner)','P-R4C04':'two streets, 12 m deep','P-R3C01':'no street — street behind a neighbouring parcel','P-R8C05':'no street — beyond search radius','P-R7C08':'two streets, Arabic-digit width'};
    for(const [no,label] of Object.entries(cases)){await t('select '+no,()=>pick(page,no));const list=await rows(page);checkParcel(no,list);
      const a=await area(page);assert.ok(Math.abs(num(a[0])-expected[no].area)<.5,`${no} area ${a[0]}`);
      const attrs=await page.textContent('#parcelAttributes');assert.ok(attrs.includes(no)&&attrs.includes('3120/أ')&&attrs.includes('بلدية شمال الرياض')&&attrs.includes('DEED_AREA'),`${no} attributes`);
      log(`${no}: ${label} → ${list.map(r=>r.name||'—').join(' | ')}`)}
    await page.fill('#parcelSearch','');assert.equal(await page.$$eval('#parcelSelect option',o=>o.length),120);
    await page.fill('#parcelSearch','R9C1');const found=await page.$$eval('#parcelSelect option',o=>o.map(x=>x.textContent.split(' ')[0]));
    assert.deepEqual(found.sort(),['P-R7C08','P-R9C10','P-R9C11'],'matches plus the selected parcel');
    await page.fill('#parcelSearch','الملقا');assert.equal(await page.$$eval('#parcelSelect option',o=>o.length),24+1,'attribute search (district)');log('search by parcel number and by attribute value');

    // manual decisions stay with their parcel
    await pick(page,'P-R0C01');
    await setCell(page,3,4,9);await setCell(page,0,5,4);
    assert.equal((await rows(page))[0].approved,false,'editing a setback withdraws the approval');await page.locator('#resultRows tr[data-edge="0"] td').nth(7).locator('input').check();
    await setCell(page,2,2,'ممر خلفي');await page.locator('#resultRows tr[data-edge="2"] td').nth(6).locator('select').selectOption('rear');
    await page.locator('#resultRows tr[data-edge="2"] td').nth(7).locator('input').check();
    let a1=await rows(page);assert.equal(a1[3].widthSource,'مدخل يدويًا');assert.equal(a1[0].sbSource,'مدخل يدويًا');assert.equal(a1[2].face,'rear');
    await pick(page,'P-R0C02');const b=await rows(page);checkParcel('P-R0C02',b);assert.equal(b[3].width,'');assert.equal(b[0].sb,'');assert.equal(b[2].name,'');
    await pick(page,'P-R0C01');a1=await rows(page);assert.equal(a1[3].width,'9');assert.equal(a1[0].sb,'4');assert.equal(a1[2].name,'ممر خلفي');assert.equal(a1[2].face,'rear');assert.ok(a1[2].approved);
    log('manual width / setback / face / name kept on P-R0C01 and absent on P-R0C02');
    await page.click('#analyze');await page.waitForTimeout(150);a1=await rows(page);
    assert.equal(a1[3].width,'9');assert.equal(a1[3].widthSource,'مدخل يدويًا');assert.equal(a1[0].sb,'4');assert.equal(a1[2].name,'ممر خلفي');assert.equal(a1[2].face,'rear');
    assert.ok(a1[0].approved&&a1[2].approved,'approvals kept');log('re-analysis keeps manual widths, setbacks, names, faces and approvals');

    // user-defined rule: suggested vs approved setback, and buildable area from the approved values
    await page.selectOption('#rule','custom');await page.fill('#ratio','20');await page.fill('#minimum','3');await page.waitForTimeout(100);a1=await rows(page);
    assert.equal(a1[0].suggested,'المقترح: 4.00 م');assert.equal(a1[0].sb,'4');assert.equal(a1[0].sbSource,'مدخل يدويًا');assert.equal(a1[3].suggested,'المقترح: 3.00 م');assert.equal(a1[3].sb,'3');
    assert.equal(a1[1].suggested,'المقترح: — (بدون عرض)');assert.equal(a1[1].sb,'');
    let a=await area(page);assert.equal(num(a[0]),1050);assert.equal(num(a[1]),837);assert.ok(a[2].startsWith('213'),a[2]);
    assert.ok((await page.textContent('#areaSummary')).includes('2 من 4 أضلاع بدون ارتداد معتمد'));log(`area: original ${a[0]}, buildable ${a[1]}, difference ${a[2]}`);

    // click on the map selects the neighbouring parcel (30 m east of the selected one, which is centred)
    const box=await page.locator('#vector-map').boundingBox(),ppm=Math.min(box.width,box.height)/(35+95);
    await t('map click selection',async()=>{await page.mouse.click(box.x+box.width/2+30*ppm,box.y+box.height/2);await page.waitForFunction(()=>document.getElementById('mapTitle').textContent.startsWith('P-R0C02 '))});
    checkParcel('P-R0C02',await rows(page));log('map click selected P-R0C02');

    // reload: layers, active parcel and every parcel's decisions come back from IndexedDB
    await page.reload();await page.waitForFunction(()=>/تم استرجاع 120 قطعة/.test(document.getElementById('parcelStatus').textContent));
    await page.waitForFunction(()=>/تم استرجاع 7 محور/.test(document.getElementById('roadStatus').textContent));
    assert.ok((await page.textContent('#mapTitle')).startsWith('P-R0C02 '),'active parcel restored');
    await pick(page,'P-R0C01');a1=await rows(page);assert.equal(a1[3].width,'9');assert.equal(a1[0].sb,'4');assert.equal(a1[2].face,'rear');
    log('after reload: 120 parcels, 7 streets, active parcel and P-R0C01 decisions restored');
    for(const no of Object.keys(expected).filter((_,i)=>i%5===0))await pick(page,no);
    await pick(page,'P-R0C01');a1=await rows(page);assert.equal(a1[3].width,'9');log('24 more parcels visited: P-R0C01 decisions not evicted');

    // apply to the main planner: the parcel chosen inside Street Tools opens there with its approved edges
    await page.click('#sendBack');await page.waitForURL(/index\.html\?streetResult=/);
    await page.waitForFunction(()=>typeof S!=='undefined'&&S.verts?.[0]?.name==='شارع الأمير سلطان',null,{timeout:15000});
    let main=await page.evaluate(()=>({id:CUR_PC?.stableId,no:S.gis?.no,n:PARCELS.length,sel:document.getElementById('parcelSel').value,verts:S.verts.map(v=>({name:v.name,sb:v.sb,role:v.role,w:v.streetW,src:v.streetWSrc})),tx:{street:S.tx.street,w:S.tx.streetW}}));
    assert.equal(main.no,'P-R0C01');assert.equal(main.n,120);assert.equal(main.sel,main.id);
    assert.deepEqual(main.verts[0],{name:'شارع الأمير سلطان',sb:4,role:'front',w:20,src:'gis'});assert.equal(main.verts[2].name,'ممر خلفي');assert.equal(main.verts[2].role,'rear');
    assert.equal(main.verts[1].name,'');assert.equal(main.verts[3].name,'');assert.equal(main.tx.street,'شارع الأمير سلطان');assert.equal(main.tx.w,'20');
    log('main planner: P-R0C01 opened from the layer (120 parcels), edges 1 and 3 applied with width, setback and face');
    const geom=await page.evaluate(()=>{const m=compute();return{area:m.plotArea,lens:m.edges.map(e=>e.len)}});
    assert.ok(Math.abs(geom.area-1050)<.05,`main planner area ${geom.area}`);geom.lens.forEach((l,i)=>assert.ok(Math.abs(l-[30,35,30,35][i])<.011,`main edge ${i+1}: ${l}`));
    log(`main planner geometry agrees with Street Tools: area ${geom.area.toFixed(2)} m², edges ${geom.lens.map(l=>l.toFixed(2)).join(' / ')} m`);

    // main planner → another parcel → «مزيد»: the same parcel, the full layer and the streets open in Street Tools
    const target=await page.evaluate(()=>PARCELS.find(p=>p.no==='P-R7C03').stableId);await page.selectOption('#parcelSel',target);
    await page.waitForFunction(id=>CUR_PC?.stableId===id,target);
    // choosing a parcel opens the transaction form (existing behaviour); it must show the new parcel, then close it
    await page.waitForFunction(()=>!document.getElementById('bldModal').hidden);assert.equal(await page.evaluate(()=>S.gis.no),'P-R7C03');
    await page.keyboard.press('Escape');await page.waitForFunction(()=>document.getElementById('bldModal').hidden);await page.click('#moreStreetTools');await page.waitForURL(/street-tools\.html\?parcel=/);
    await page.waitForFunction(()=>/تم استرجاع 120 قطعة/.test(document.getElementById('parcelStatus').textContent));
    await page.waitForFunction(()=>document.getElementById('mapTitle').textContent.startsWith('P-R7C03 ')&&document.querySelectorAll('#resultRows tr[data-edge]').length===4);
    await page.waitForFunction(()=>document.querySelector('#resultRows tr[data-edge="0"] .name-input')?.value==='شارع النخيل');
    checkParcel('P-R7C03',await rows(page));assert.equal(await page.locator('#parcelSelect option').count(),120);log('«مزيد» from P-R7C03: same parcel, full layer and street matches');
    await page.goto(base+'index.html');await page.waitForFunction(()=>CUR_PC?.no==='P-R7C03');
    await page.selectOption('#parcelSel',main.id);await page.waitForFunction(()=>CUR_PC?.no==='P-R0C01'&&S.verts[0].name==='شارع الأمير سلطان');
    main=await page.evaluate(()=>S.verts.map(v=>v.name));assert.equal(main[2],'ممر خلفي');log('main planner keeps P-R0C01 street data when switching parcels');
    await ctx.close();

    console.log('Multipart parcel');
    const ctx2=await browser.newContext({viewport:{width:1280,height:900}});page=await newPage(ctx2);await page.goto(base+'street-tools.html');
    await page.setInputFiles('#parcelFile',path.join(FX,'multipart-parcel.geojson'));await page.waitForFunction(()=>document.querySelectorAll('#resultRows tr[data-edge]').length===12);
    assert.equal(await page.textContent('#totalEdges'),'12');const attrs=await page.textContent('#parcelAttributes');assert.ok(attrs.includes('PRESERVE-ME')&&attrs.includes('2 أجزاء'));
    const mp=JSON.parse(fs.readFileSync(path.join(FX,'multipart-parcel.geojson'),'utf8')).features[0].geometry.coordinates;
    const want=G.buildableArea(mp.map(poly=>({outer:poly[0].slice(0,-1),holes:poly.slice(1).map(h=>h.slice(0,-1))})),(k,n)=>new Array(n).fill(0));a=await area(page);
    assert.ok(Math.abs(num(a[0])-want.original)<1,`multipart area ${a[0]} vs ${want.original}`);assert.ok((await page.textContent('#areaSummary')).includes('خُصمت الفراغات'));assert.equal((await rows(page)).filter(r=>r.status==='حدود داخلية').length,4,'hole edges listed');
    log(`2 parts + hole: 8 outer + 4 hole edges, area ${a[0]}, hole subtracted, extra attribute kept`);await ctx2.close();

    console.log('Performance with 3,000 parcels');
    const big={type:'FeatureCollection',features:[]},f=G.frame(39.9,21.5),bigRoads={type:'FeatureCollection',features:[]};
    for(let r=0;r<50;r++)for(let c=0;c<60;c++){const x0=c*32,y0=r*42+(r>>1)*20,ring=[[x0,y0],[x0+30,y0],[x0+30,y0+40],[x0,y0+40],[x0,y0]].map(([x,y])=>f.toLL({x,y}));
      big.features.push({type:'Feature',properties:{PARCEL_NO:`L-${r}-${c}`,ROW:r},geometry:{type:'Polygon',coordinates:[ring]}})}
    for(let r=0;r<50;r+=2){const y=r*42+(r>>1)*20-10;bigRoads.features.push({type:'Feature',properties:{STREET_NAME:`شارع ${r/2+1}`,WIDTH_M:16},geometry:{type:'LineString',coordinates:[f.toLL({x:-20,y}),f.toLL({x:60*32+20,y})]}})}
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'gis-parcels-'));fs.writeFileSync(path.join(tmp,'big.geojson'),JSON.stringify(big));fs.writeFileSync(path.join(tmp,'big-roads.geojson'),JSON.stringify(bigRoads));
    const ctx3=await browser.newContext({viewport:{width:1440,height:1000}});page=await newPage(ctx3);await page.goto(base+'street-tools.html');
    await t('upload 3000 parcels (parse + index + IndexedDB)',async()=>{await page.setInputFiles('#parcelFile',path.join(tmp,'big.geojson'));await page.waitForFunction(()=>/3,000 قطعة/.test(document.getElementById('parcelStatus').textContent),null,{timeout:60000})});
    await page.setInputFiles('#roadFile',path.join(tmp,'big-roads.geojson'));await page.waitForFunction(()=>/25 خط شارع/.test(document.getElementById('roadStatus').textContent));
    await t('select parcel in 3000 (search + analysis)',()=>pick(page,'L-30-44'));{const r=await rows(page);assert.equal(r[0].name,'شارع 16');assert.equal(r[2].name,'','row 31 stands between row 30 and street 17')}
    await t('fit whole layer (vector)',async()=>{await page.click('#fitLayer')});
    await t('satellite view first draw (3000 parcels)',async()=>{await page.click('#satelliteView');await page.waitForFunction(()=>window.L&&document.querySelector('#leaflet-map canvas'),null,{timeout:30000})});
    await t('5 edge selections on satellite view',async()=>{for(let i=0;i<5;i++)await page.locator(`#resultRows tr[data-edge="${i%4}"] td`).first().click()});
    await ctx3.close();fs.rmSync(tmp,{recursive:true,force:true});
    assert.deepEqual(errors,[],'no page errors');
    console.log('Timings (ms):');for(const [k,v] of Object.entries(timings))console.log(`  ${k}: ${v}`);
    console.log('E2E parcel layer workflow passed');
  }finally{await browser.close();srv.close()}
})().catch(e=>{console.error(e);process.exit(1)});
