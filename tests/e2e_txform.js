'use strict';
/* Browser test of the transaction form («نموذج المعاملة»): street name and setback of every edge.
   Cases (tests/fixtures/tx-cases.geojson + tx-roads.geojson, synthetic data):
     T-ONE one street · T-CORNER two streets · T-FOUR a street on each edge · T-MULTI two parts + a hole · T-EMPTY no data
   Checks, on the real pages (main planner ⇄ «مزيد»), project type «أرض فقط»:
   · names approved in «مزيد» are read per edge without «تطبيق»; each is drawn inside its own road band and frontage
     (a corner parcel: two streets, neither name in the other's band); no «اسم الشارع» placeholder anywhere
   · setbacks (approved / saved in «مزيد») in the cards, the requirements table and as dimension arrows on every ring
   · buildable area = hand-computed area = Street Tools' own area; original and buildable outlines drawn
   · missing data → «غير محدد» + warnings on screen and on the sheet; no street or setback invented
   · switching parcels (also quickly) never mixes data; PNG = preview canvas pixel for pixel; PDF = the same image
   Needs playwright-core (NODE_PATH) and Chromium/Chrome (CHROME_PATH); internet for jsPDF/fonts like the real page.
   Run: node tests/generate_fixtures.js && node tests/e2e_txform.js */
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const ROOT=path.resolve(__dirname,'..'),FX=path.join(__dirname,'fixtures');
function browserPath(){if(process.env.CHROME_PATH)return process.env.CHROME_PATH;const local=process.env.LOCALAPPDATA||'',c=[];
  try{for(const d of fs.readdirSync(path.join(local,'ms-playwright')).filter(d=>/^chromium-\d+$/.test(d)).sort().reverse())c.push(path.join(local,'ms-playwright',d,'chrome-win64','chrome.exe'))}catch(e){}
  c.push('C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe');return c.find(p=>fs.existsSync(p))}
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.geojson':'application/geo+json'};
const serve=dir=>new Promise(res=>{const srv=http.createServer((q,out)=>{const file=path.join(dir,decodeURIComponent(new URL(q.url,'http://x').pathname));
  if(!file.startsWith(dir)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){out.writeHead(404);out.end();return}
  out.writeHead(200,{'Content-Type':TYPES[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(file).pipe(out)});srv.listen(0,'127.0.0.1',()=>res(srv))});
const log=(...a)=>console.log('  ✓',...a),num=t=>Number(String(t).replace(/[^\d.\-]/g,''));
const near=(a,b,eps,msg)=>assert.ok(Math.abs(a-b)<=eps,`${msg}: ${a} vs ${b}`);

// what the open transaction form shows: resolved edges, drawing diagnostics, every string drawn on its canvas, warnings
const TXFORM=`(()=>{const o=BLD_OUT,T=o.tx;return{parcel:o.parcel,no:CUR_PC&&CUR_PC.no,modal:!document.getElementById('bldModal').hidden,
  edges:T.edges.map(e=>({no:e.no,main:e.main,hole:e.hole,name:e.name,nameSrc:e.nameSrc,street:e.street,face:e.face,sb:e.sb,sbSrc:e.sbSrc})),
  cards:T.cards,none:T.none,partial:T.partial,sbLine:T.sbLine,streetLine:T.streetLine,warn:T.warn,short:T.short,area:T.geo.area,plot:T.m.plotArea,method:T.geo.method,zoneParts:T.geo.parts.length,
  diag:o.diag,texts:(window.__texts.get(o.cv)||[]),info:document.getElementById('bldInfo').textContent,infoWarn:[...document.querySelectorAll('#bldInfo .warn')].map(x=>x.textContent)}})()`;

// choose a parcel (the form opens on its own); if it is already the current one, open the form with «نموذج المعاملة»
async function plannerSelect(page,no){const id=await page.evaluate(n=>PARCELS.find(x=>x.no===n).stableId,no);
  if(await page.evaluate(i=>CUR_PC&&CUR_PC.stableId===i,id))await page.click('#qTx');else await page.selectOption('#parcelSel',id);
  await page.waitForFunction(i=>CUR_PC&&CUR_PC.stableId===i&&!document.getElementById('bldModal').hidden&&BLD_OUT&&BLD_OUT.parcel===i,id,{timeout:20000});return id}
async function closeForm(page){await page.keyboard.press('Escape');await page.waitForFunction(()=>document.getElementById('bldModal').hidden)}
// Street Tools rows in internal order (data-edge) with the edge number shown to the user
const stRows=page=>page.$$eval('#resultRows tr[data-edge]',trs=>trs.map(tr=>({i:+tr.dataset.edge,no:+tr.cells[0].querySelector('.edge-num').textContent,name:tr.cells[2].querySelector('input').value,
  width:tr.cells[4].querySelector('input').value,sb:tr.cells[5].querySelector('input').value,face:tr.cells[6].querySelector('select').value,approved:tr.cells[7].querySelector('input').checked,status:tr.cells[8].textContent})));
async function stSet(page,i,col,value){const input=page.locator(`#resultRows tr[data-edge="${i}"]`).locator('td').nth(col).locator('input').first();await input.fill(String(value));await input.press('Tab')}
// open «مزيد» for the planner's current parcel, edit it there, and come back with «العودة للمخطط الرئيسي» (no «تطبيق»)
async function inStreetTools(page,edges,{approve=true,manual={},faces={},unapprove=[],loadRoads=false}={}){
  await page.click('#moreStreetTools');await page.waitForURL(/street-tools\.html\?parcel=/);
  await page.waitForFunction(n=>document.querySelectorAll('#resultRows tr[data-edge]').length===n,edges,{timeout:20000});
  if(loadRoads){await page.selectOption('#rule','custom');await page.fill('#ratio','20');await page.fill('#minimum','3');
    await page.setInputFiles('#roadFile',path.join(FX,'tx-roads.geojson'));await page.waitForFunction(()=>/8 خط شارع/.test(document.getElementById('roadStatus').textContent))}
  else await page.waitForFunction(()=>/محور شارع/.test(document.getElementById('roadStatus').textContent),null,{timeout:20000});
  await page.click('#analyze');await page.waitForTimeout(200);
  let rows=await stRows(page);
  for(const r of rows){const tr=page.locator(`#resultRows tr[data-edge="${r.i}"]`);
    if(faces[r.no]){await tr.locator('td').nth(6).locator('select').selectOption(faces[r.no])}
    if(manual[r.no]!==undefined)await stSet(page,r.i,5,manual[r.no]);
    if(approve&&r.name&&!unapprove.includes(r.no))await tr.locator('td').nth(7).locator('input').check();
    if(unapprove.includes(r.no))await tr.locator('td').nth(7).locator('input').uncheck()}
  await page.waitForTimeout(150);rows=await stRows(page);
  const area=await page.$$eval('#areaSummary .area-item b',b=>b.map(x=>x.textContent));
  await page.click('.top-link');await page.waitForURL(u=>/index\.html$/.test(u.pathname));await page.waitForFunction(()=>typeof compute==='function'&&CUR_PC);
  return{rows,area:{original:num(area[0]),buildable:num(area[1])}}}
// street label inside its own road band and within its own frontage
function labelOnFrontage(s,msg){const t={x:s.b.x-s.a.x,y:s.b.y-s.a.y},L=Math.hypot(t.x,t.y),u=((s.p.x-s.a.x)*t.x+(s.p.y-s.a.y)*t.y)/(L*L),v=(s.p.x-s.a.x)*s.d.x+(s.p.y-s.a.y)*s.d.y;
  assert.ok(u>=-1e-6&&u<=1+1e-6,`${msg}: label along its frontage (u=${u.toFixed(3)})`);assert.ok(v>0&&v<=s.roadW+1e-6,`${msg}: label inside its road band (offset ${v.toFixed(2)} of ${s.roadW})`);return{u,v}}
// separating-axis test of two label boxes (4 corners each)
function boxesOverlap(A,B){for(const P of [A,B])for(let i=0;i<4;i++){const a=P[i],b=P[(i+1)%4],ax={x:-(b.y-a.y),y:b.x-a.x},pr=Q=>Q.map(p=>p.x*ax.x+p.y*ax.y);
    const pa=pr(A),pb=pr(B);if(Math.max(...pa)<=Math.min(...pb)+1e-6||Math.max(...pb)<=Math.min(...pa)+1e-6)return false}return true}
const inRing=(p,R)=>{let c=false;for(let i=0,j=R.length-1;i<R.length;j=i++){const a=R[i],b=R[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)c=!c}return c};
// no street name overlaps an edge-length label, and the parcel number is never on a hole
function checkLabels(f,msg){for(const s of f.diag.streets)for(const l of f.diag.lengths.filter(x=>x.map===s.map))assert.ok(!boxesOverlap(s.q,l.q),`${msg}: ${s.map} name of ض${s.no} clear of the length of ض${l.no}`);
  for(const n of f.diag.number)assert.ok(!n.holes.some(h=>inRing(n.p,h)),`${msg}: ${n.map} parcel number not on a hole`)}
const inBand=(p,s)=>{const v=(p.x-s.a.x)*s.d.x+(p.y-s.a.y)*s.d.y;return v>0&&v<=s.roadW};
function checkArrows(f,want,msg){for(const map of ['top','plan']){const got=f.diag.setbacks.filter(s=>s.map===map);
    for(const [no,sb] of Object.entries(want)){if(map==='top'&&!f.edges.find(e=>e.no===+no).main)continue;const s=got.find(x=>x.no===+no);assert.ok(s,`${msg}: ${map} map has the setback arrow of edge ${no}`);
      assert.equal(s.text,`${sb} م`,`${msg}: edge ${no} arrow value`);const len=Math.hypot(s.P1.x-s.P0.x,s.P1.y-s.P0.y);near(len,sb*s.scale,1e-6,`${msg}: edge ${no} arrow length = setback × scale`);
      assert.ok((s.P1.x-s.P0.x)*s.d.x+(s.P1.y-s.P0.y)*s.d.y<0,`${msg}: edge ${no} arrow points into the parcel`)}}}
// TX_DUMP=<folder>: also save each case's sheet as PNG, for a visual check
async function dump(page,name){const dir=process.env.TX_DUMP;if(!dir)return;fs.mkdirSync(dir,{recursive:true});
  const b64=await page.evaluate(async()=>{const b=new Uint8Array(await BLD_OUT.blob.arrayBuffer());let s='';for(let i=0;i<b.length;i+=32768)s+=String.fromCharCode(...b.subarray(i,i+32768));return btoa(s)});
  fs.writeFileSync(path.join(dir,name+'.png'),Buffer.from(b64,'base64'))}
function common(f,no,msg){assert.equal(f.no,no);assert.ok(f.modal,'form open');assert.ok(!f.texts.includes('اسم الشارع'),`${msg}: no «اسم الشارع» placeholder drawn`);
  assert.ok(f.texts.includes(no),`${msg}: parcel number drawn`)}

(async()=>{const exe=browserPath();assert.ok(exe,'no Chromium/Chrome/Edge found; set CHROME_PATH');
  const srv=await serve(ROOT),base=`http://127.0.0.1:${srv.address().port}/`,browser=await chromium.launch({executablePath:exe,headless:true});
  const errors=[],dialogs=[],tmp=fs.mkdtempSync(path.join(os.tmpdir(),'gis-txform-'));
  try{
    const ctx=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
    // every string drawn on each canvas (the transaction sheet is one canvas; PNG and PDF are made from it)
    await ctx.addInitScript(()=>{const W=new WeakMap();window.__texts=W;const f=CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText=function(t,...a){let l=W.get(this.canvas);if(!l)W.set(this.canvas,l=[]);l.push(String(t));return f.call(this,t,...a)}});
    const page=await ctx.newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>{dialogs.push(d.message());d.accept()});
    await page.goto(base+'index.html');await page.waitForFunction(()=>typeof compute==='function'&&window.polygonClipping);
    await page.evaluate(()=>new Promise(r=>{localStorage.clear();sessionStorage.clear();const q=indexedDB.deleteDatabase('gis-parcel-planner-final');q.onsuccess=q.onerror=q.onblocked=()=>r()}));
    await page.goto(base+'index.html');await page.waitForFunction(()=>typeof compute==='function'&&window.polygonClipping);
    // this test covers the planner with the user rules off (data as it is, nothing assumed); they are tested in e2e_user_rules.js
    await page.evaluate(()=>{S.projType='land';S.img.show=false;S.urules.on=false;S.tx.style='full';S.txDef.on=false;urSync();persist()});
    await page.setInputFiles('#parcelFile',path.join(FX,'tx-cases.geojson'));await page.waitForFunction(()=>PARCELS.length===5&&PARCELS.every(p=>p.no)&&CUR_PC);
    const ids={};for(const no of ['T-ONE','T-CORNER','T-FOUR','T-MULTI','T-EMPTY'])ids[no]=await page.evaluate(n=>PARCELS.find(p=>p.no===n).stableId,no);

    // ---------- 0 · before any street work: nothing invented ----------
    console.log('No street data yet (T-ONE straight after import)');
    await plannerSelect(page,'T-ONE');let f=await page.evaluate(TXFORM);common(f,'T-ONE','no data');
    assert.equal(f.diag.streets.length,0,'no road drawn when no street edge is known (the south edge is no longer guessed)');
    assert.deepEqual(f.cards,{front:'غير محدد',rear:'غير محدد',side:'غير محدد'});assert.equal(f.streetLine,'غير محدد');
    assert.ok(f.warn.some(w=>/لم يُحدَّد أي ضلع على شارع/.test(w))&&f.warn.some(w=>/الارتداد غير محدد للضلع 1–4/.test(w)),'warnings');
    assert.ok(f.texts.some(t=>/^تنبيه: بيانات ناقصة/.test(t)),'missing-data warning printed on the sheet');assert.ok(f.none,'no setback known');
    assert.deepEqual(f.diag.number.find(x=>x.map==='plan').lines,['T-ONE','المساحة القابلة للبناء','غير محددة'],'no buildable area claimed when no setback is known');
    assert.ok(/المساحة بعد الارتدادات غير محددة/.test(f.info),'preview says the area after setbacks is unknown');
    assert.equal(f.diag.missing.filter(x=>x.map==='plan').length,4,'«ارتداد غير محدد» drawn on the 4 edges of the plan');
    await dump(page,'0-T-ONE-no-data');log(`T-ONE: no street drawn, cards «غير محدد», ${f.warn.length} warnings shown, sheet says «بيانات ناقصة»`);
    await closeForm(page);

    // ---------- 1 · one street ----------
    console.log('T-ONE — one street (approved in «مزيد», not applied)');
    let st=await inStreetTools(page,4,{loadRoads:true,manual:{2:1.5,3:2},faces:{3:'rear'}});
    assert.equal(st.rows.find(r=>r.no===1).name,'شارع الواحة');assert.ok(st.rows.find(r=>r.no===1).approved);
    await plannerSelect(page,'T-CORNER');await closeForm(page);await plannerSelect(page,'T-ONE');f=await page.evaluate(TXFORM);common(f,'T-ONE','T-ONE');
    const e1=f.edges;assert.equal(e1[0].name,'شارع الواحة');assert.equal(e1[0].nameSrc,'st');assert.ok(e1[0].street);assert.ok(!e1.slice(1).some(e=>e.street),'only edge 1 is a street');
    assert.deepEqual(e1.map(e=>e.sb),[4,1.5,2,null]);assert.deepEqual(e1.map(e=>e.face),['front','side','rear','side']);
    assert.deepEqual(f.cards,{front:'4',rear:'2',side:'1.5، غير محدد'});
    assert.equal(f.sbLine,'أمامي 4 م: ض1 · جانبي 1.5 م: ض2 · خلفي 2 م: ض3 · جانبي غير محدد: ض4');assert.equal(f.streetLine,'شارع الواحة (ض1)');
    const one=f.diag.streets;assert.equal(one.length,2,'one street label per map');one.forEach(s=>{assert.equal(s.no,1);assert.equal(s.name,'شارع الواحة');assert.equal(s.text,'شارع الواحة (عرض 20 م)','width after the name');labelOnFrontage(s,'T-ONE '+s.map)});
    checkArrows(f,{1:4,2:1.5,3:2},'T-ONE');assert.deepEqual(f.diag.missing.filter(x=>x.map==='plan').map(x=>x.no),[4]);
    near(f.area,(30-1.5-0)*(40-4-2),0.05,'T-ONE buildable area (hand)');near(f.area,st.area.buildable,0.05,'T-ONE buildable = Street Tools');near(f.plot,1200,0.05,'plot area');
    assert.ok(f.zoneParts===1&&f.method==='clip','buildable outline drawn');
    checkLabels(f,'T-ONE');assert.ok(f.partial&&/مبدئية/.test(f.info),'provisional area stated');
    for(const s of ['شارع الواحة (عرض 20 م)','4 م','1.5 م','2 م','ارتداد غير محدد','المساحة القابلة للبناء (مبدئية)'])assert.ok(f.texts.includes(s),`T-ONE sheet text «${s}»`);
    assert.ok(f.texts.some(t=>/^(29.99|30|30.01) م$/.test(t))&&f.texts.some(t=>/^(39.99|40|40.01) م$/.test(t)),'edge lengths printed');
    assert.ok(f.texts.some(t=>/^96[89][.d]* م/.test(t)),'buildable area printed');assert.ok(f.warn.some(w=>/الارتداد غير محدد للضلع 4/.test(w)),'missing setback warned');
    assert.ok(/أسماء الشوارع والارتدادات من «مزيد»/.test(f.info),'source stated');
    await dump(page,'1-T-ONE');log(`T-ONE: ض1 «شارع الواحة» in its road band on both maps; setbacks 4 / 1.5 / 2 / غير محدد; area ${f.area.toFixed(2)} m² = hand = Street Tools`);

    // PNG and PDF are the preview canvas
    console.log('PNG / PDF = preview');
    const [dlPng]=await Promise.all([page.waitForEvent('download'),page.click('#bldSave')]);const pngPath=path.join(tmp,'tx.png');await dlPng.saveAs(pngPath);
    const [dlPdf]=await Promise.all([page.waitForEvent('download'),page.click('#bldPdf')]);const pdfPath=path.join(tmp,'tx.pdf');await dlPdf.saveAs(pdfPath);
    const png=fs.readFileSync(pngPath),pdf=fs.readFileSync(pdfPath);
    const cmp=await page.evaluate(async b64=>{const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0)),bmp=await createImageBitmap(new Blob([bytes],{type:'image/png'}),{colorSpaceConversion:'none',premultiplyAlpha:'none'});
      const cv=BLD_OUT.cv,c2=document.createElement('canvas');c2.width=bmp.width;c2.height=bmp.height;const g=c2.getContext('2d');g.drawImage(bmp,0,0);
      const a=g.getImageData(0,0,c2.width,c2.height).data,b=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;let diff=0;if(a.length===b.length)for(let i=0;i<a.length;i++)if(a[i]!==b[i])diff++;
      const prev=new Uint8Array(await (await fetch(document.getElementById('bldImg').src)).arrayBuffer());let same=prev.length===bytes.length;if(same)for(let i=0;i<prev.length;i++)if(prev[i]!==bytes[i]){same=false;break}
      const jpg=Uint8Array.from(atob(cv.toDataURL('image/jpeg',0.95).split(',')[1]),c=>c.charCodeAt(0));return{w:bmp.width,h:bmp.height,cw:cv.width,ch:cv.height,diff,lenOk:a.length===b.length,previewSame:same,jpg:btoa(String.fromCharCode(...jpg.subarray(0,64))),jpgLen:jpg.length,
        jpgAll:Array.from(jpg.subarray(0,jpg.length)).reduce((h,v)=>(h*31+v)>>>0,7),W:BLD_OUT.W,H:BLD_OUT.H}},png.toString('base64'));
    assert.ok(cmp.lenOk&&cmp.diff===0,`PNG pixels = preview canvas (${cmp.w}×${cmp.h}, ${cmp.diff} differing values)`);assert.ok(cmp.previewSame,'preview <img> shows the same PNG bytes');
    // the PDF holds one JPEG of the same canvas, on a page of the sheet's size
    const s=pdf.toString('latin1'),at=s.indexOf('/DCTDecode');assert.ok(at>0,'PDF has a JPEG image');const dictStart=s.lastIndexOf('<<',at),streamAt=s.indexOf('stream',at)+6;
    let st0=streamAt;if(s[st0]==='\r')st0++;if(s[st0]==='\n')st0++;const end=s.indexOf('endstream',st0);let img=pdf.subarray(st0,end);while(img.length&&(img[img.length-1]===10||img[img.length-1]===13))img=img.subarray(0,img.length-1);
    if(/FlateDecode/.test(s.slice(dictStart,streamAt)))img=zlib.inflateSync(img);
    const hash=Array.from(img).reduce((h,v)=>(h*31+v)>>>0,7);assert.equal(img.length,cmp.jpgLen,'PDF image = canvas JPEG (length)');assert.equal(hash,cmp.jpgAll,'PDF image = canvas JPEG (bytes)');
    const mb=/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(s);assert.ok(mb,'PDF page size');near(+mb[1],cmp.W*0.75,0.01,'PDF width');near(+mb[2],cmp.H*0.75,0.01,'PDF height');
    log(`PNG ${cmp.w}×${cmp.h} identical to the preview canvas; preview <img> = PNG bytes; PDF ${mb[1]}×${mb[2]} pt embeds the same canvas as JPEG (${img.length} bytes, byte-identical)`);
    await closeForm(page);

    // ---------- 2 · corner parcel ----------
    console.log('T-CORNER — corner parcel on two streets');
    await plannerSelect(page,'T-CORNER');await closeForm(page);
    st=await inStreetTools(page,4,{manual:{3:2,4:2}});
    await plannerSelect(page,'T-CORNER');f=await page.evaluate(TXFORM);common(f,'T-CORNER','T-CORNER');
    assert.deepEqual(f.edges.map(e=>e.name),['شارع النور','شارع الضياء','','']);assert.deepEqual(f.edges.map(e=>e.street),[true,true,false,false]);
    assert.deepEqual(f.edges.map(e=>e.sb),[5,3,2,2]);assert.deepEqual(f.cards,{front:'5، 3',rear:'2',side:'2'});
    assert.equal(f.streetLine,'شارع النور (ض1)، شارع الضياء (ض2)');
    for(const map of ['top','plan']){const L=f.diag.streets.filter(x=>x.map===map);assert.equal(L.length,2,`${map}: two street names`);
      const a=L.find(x=>x.no===1),b=L.find(x=>x.no===2);assert.equal(a.name,'شارع النور');assert.equal(b.name,'شارع الضياء');
      labelOnFrontage(a,`corner ${map} south`);labelOnFrontage(b,`corner ${map} east`);
      assert.ok(!inBand(a.p,b)&&!inBand(b.p,a),`${map}: neither name sits in the other street's band`)}
    checkArrows(f,{1:5,2:3,3:2,4:2},'T-CORNER');checkLabels(f,'T-CORNER');assert.ok(!f.partial&&!f.none);assert.ok(f.texts.includes('المساحة القابلة للبناء'));near(f.area,(30-3-2)*(40-5-2),0.05,'T-CORNER area (hand)');near(f.area,st.area.buildable,0.05,'T-CORNER = Street Tools');
    assert.ok(!f.texts.some(t=>t.includes('شارع الواحة')),'nothing from T-ONE');assert.equal(f.warn.filter(w=>/غير محدد/.test(w)).length,0,'nothing missing');
    await dump(page,'2-T-CORNER');log(`T-CORNER: «شارع النور» on ض1 and «شارع الضياء» on ض2, each in its own band; setbacks 5 / 3 / 2 / 2; area ${f.area.toFixed(2)} m²`);
    await closeForm(page);

    // ---------- 3 · four streets ----------
    console.log('T-FOUR — a street on each of the four edges');
    await plannerSelect(page,'T-FOUR');await closeForm(page);
    st=await inStreetTools(page,4);
    await plannerSelect(page,'T-FOUR');f=await page.evaluate(TXFORM);common(f,'T-FOUR','T-FOUR');
    const fourNames=['شارع الفرقان','شارع الهدى','شارع الإيمان','شارع السلام'];assert.deepEqual(f.edges.map(e=>e.name),fourNames);
    const fourSb=st.rows.sort((a,b)=>a.no-b.no).map(r=>+r.sb);assert.deepEqual(f.edges.map(e=>e.sb),fourSb);assert.deepEqual(fourSb,[6,4,3,3]);
    for(const map of ['top','plan']){const L=f.diag.streets.filter(x=>x.map===map);assert.equal(L.length,4,`${map}: four names`);
      L.forEach(x=>{assert.equal(x.name,fourNames[x.no-1]);labelOnFrontage(x,`four ${map} ض${x.no}`);L.filter(y=>y!==x).forEach(y=>assert.ok(!inBand(x.p,y),`${map}: ض${x.no} name not in ض${y.no}'s band`))})}
    checkArrows(f,{1:6,2:4,3:3,4:3},'T-FOUR');checkLabels(f,'T-FOUR');near(f.area,(40-4-3)*(30-6-3),0.05,'T-FOUR area (hand)');near(f.area,st.area.buildable,0.05,'T-FOUR = Street Tools');
    assert.deepEqual(f.cards,{front:'6، 4، 3',rear:'غير محدد',side:'غير محدد'});
    await dump(page,'3-T-FOUR');log(`T-FOUR: four names on their own frontages (${fourNames.join(' / ')}); setbacks ${fourSb.join(' / ')}; area ${f.area.toFixed(2)} m²`);
    await closeForm(page);

    // ---------- 4 · multipart with a hole ----------
    console.log('T-MULTI — two parts, hole in the main part');
    await plannerSelect(page,'T-MULTI');await closeForm(page);
    st=await inStreetTools(page,12,{manual:{2:2,3:2,4:2,6:2,7:2,8:2,9:1,10:1,11:1,12:1}});
    await plannerSelect(page,'T-MULTI');f=await page.evaluate(TXFORM);common(f,'T-MULTI','T-MULTI');
    assert.equal(f.edges.length,12);assert.deepEqual(f.edges.map(e=>e.no),[1,2,3,4,5,6,7,8,9,10,11,12]);
    assert.deepEqual(f.edges.map(e=>e.sb),[4,2,2,2,4,2,2,2,1,1,1,1]);assert.deepEqual(f.edges.filter(e=>e.street).map(e=>e.no),[1,5],'south edges of both parts are streets');
    assert.ok(f.edges.filter(e=>e.hole).every(e=>!e.street&&e.face==='hole'),'hole edges are internal boundaries');
    assert.equal(f.streetLine,'شارع المجمع (ض1، 5)');
    checkArrows(f,{1:4,2:2,5:4,6:2,9:1,10:1,11:1,12:1},'T-MULTI');checkLabels(f,'T-MULTI');assert.ok(f.diag.number.every(n=>n.holes.length===1),'hole known to both maps');
    assert.deepEqual(f.diag.streets.filter(x=>x.map==='plan').map(x=>x.no).sort((a,b)=>a-b),[1,5]);f.diag.streets.forEach(x=>labelOnFrontage(x,`multi ${x.map} ض${x.no}`));
    near(f.plot,40*40-10*10+20*20,0.05,'T-MULTI plot area (parts − hole)');near(f.area,(36*34-12*12)+(16*14),0.05,'T-MULTI buildable (hand: parts − hole grown by its setback)');
    near(f.area,st.area.buildable,0.05,'T-MULTI = Street Tools');assert.ok(f.zoneParts===2&&f.method==='clip','two buildable outlines drawn');
    assert.equal(f.sbLine,'أمامي 4 م: ض1، 5 · جانبي 2 م: ض2، 4، 6، 8 · خلفي 2 م: ض3، 7 · حول الفراغ 1 م: ض9–12');   // ض7: the other part's edge facing away from its street
    await dump(page,'4-T-MULTI');log(`T-MULTI: 12 edges (2 parts + hole), streets ض1 and ض5, hole setback 1 m drawn on ض9–12; area ${f.area.toFixed(2)} m² = hand = Street Tools`);
    await closeForm(page);

    // ---------- 5 · no data at all ----------
    console.log('T-EMPTY — never opened in «مزيد»');
    await plannerSelect(page,'T-EMPTY');f=await page.evaluate(TXFORM);common(f,'T-EMPTY','T-EMPTY');
    assert.equal(f.diag.streets.length,0);assert.ok(!fourNames.concat(['شارع الواحة','شارع النور','شارع الضياء','شارع المجمع']).some(n=>f.texts.some(t=>t.includes(n))),'no street name of another parcel');
    assert.ok(f.infoWarn.some(w=>/لم يُحدَّد أي ضلع على شارع/.test(w)),'warning shown in the preview');assert.ok(/لا توجد نتائج محفوظة في «مزيد» لهذه القطعة/.test(f.info));
    await dump(page,'5-T-EMPTY');log('T-EMPTY: no street, «غير محدد», warnings; nothing from the other parcels');
    await closeForm(page);

    // ---------- 6 · switching parcels, also quickly ----------
    console.log('Switching parcels');
    await page.selectOption('#parcelSel',ids['T-CORNER']);await page.selectOption('#parcelSel',ids['T-ONE']);
    await page.waitForFunction(i=>CUR_PC&&CUR_PC.stableId===i&&!document.getElementById('bldModal').hidden&&BLD_OUT&&BLD_OUT.parcel===i,ids['T-ONE'],{timeout:20000});await page.waitForTimeout(800);
    f=await page.evaluate(TXFORM);assert.equal(f.parcel,ids['T-ONE']);assert.equal(f.no,'T-ONE');assert.deepEqual(f.edges.map(e=>e.name),['شارع الواحة','','','']);
    assert.ok(!f.texts.some(t=>t.includes('شارع النور')||t.includes('شارع الضياء')),'nothing from T-CORNER');near(f.area,969,0.05,'T-ONE area after a quick switch');
    const plannerOne=await page.evaluate(()=>S.verts.map(v=>({sb:v.sb,name:v.name})));assert.deepEqual(plannerOne.map(v=>v.name),['شارع الواحة','','',''],'planner table of T-ONE: only its own street, from the street layer');
    await closeForm(page);await plannerSelect(page,'T-CORNER');f=await page.evaluate(TXFORM);assert.deepEqual(f.edges.map(e=>e.name),['شارع النور','شارع الضياء','','']);await closeForm(page);
    log('quick T-CORNER → T-ONE change ends on T-ONE with only its own data; back to T-CORNER shows its own streets');

    // ---------- 7 · approval withdrawn in «مزيد» ----------
    console.log('Approval withdrawn (T-FOUR, ض4)');
    await plannerSelect(page,'T-FOUR');await closeForm(page);await inStreetTools(page,4,{unapprove:[4]});
    await plannerSelect(page,'T-FOUR');f=await page.evaluate(TXFORM);
    assert.equal(f.edges[3].name,'');assert.ok(!f.edges[3].street,'not approved → not drawn as a street');assert.equal(f.edges[3].sb,null,'its rule setback (from the unapproved street width) is not used');
    assert.ok(f.warn.some(w=>/ض4 «شارع السلام»/.test(w)),'unapproved suggestion warned');assert.ok(!f.texts.some(t=>t.includes('شارع السلام')));
    await dump(page,'6-T-FOUR-unapproved');log('ض4 no longer approved → not drawn, setback «غير محدد», suggestion warned');await closeForm(page);

    // ---------- 8 · «تطبيق على المخطط الرئيسي» still works and agrees ----------
    console.log('Apply to the planner (T-ONE)');
    await plannerSelect(page,'T-ONE');await closeForm(page);
    await page.click('#moreStreetTools');await page.waitForURL(/street-tools\.html\?parcel=/);await page.waitForFunction(()=>document.querySelectorAll('#resultRows tr[data-edge]').length===4&&document.querySelector('#resultRows tr[data-edge="0"] .name-input').value==='شارع الواحة');
    await page.click('#sendBack');await page.waitForURL(/streetResult=/);await page.waitForFunction(()=>CUR_PC?.no==='T-ONE'&&S.verts[0].name==='شارع الواحة'&&!location.search.includes('streetResult'),null,{timeout:20000});
    const applied=await page.evaluate(()=>S.verts.map(v=>({name:v.name,nameSrc:v.nameSrc||'',sb:v.sb,role:v.role})));
    assert.deepEqual(applied[0],{name:'شارع الواحة',nameSrc:'streets',sb:4,role:'front'});
    await page.evaluate(()=>txOpen(false));await page.waitForFunction(i=>!document.getElementById('bldModal').hidden&&BLD_OUT&&BLD_OUT.parcel===i,ids['T-ONE']);
    f=await page.evaluate(TXFORM);assert.deepEqual(f.edges.map(e=>e.sb),[4,1.5,2,null]);assert.equal(f.edges[0].name,'شارع الواحة');near(f.area,969,0.05,'same area after apply');
    assert.ok(!f.warn.some(w=>/اسم الشارع في جدول المخطط يختلف/.test(w)),'no name conflict after apply');
    log('after «تطبيق»: planner edge 1 = شارع الواحة / 4 m / front (nameSrc streets); the form is unchanged (same names, setbacks, area)');
    await closeForm(page);

    // ---------- 9 · reload: everything read back from storage ----------
    await page.reload();await page.waitForFunction(()=>typeof compute==='function'&&CUR_PC&&PARCELS.length===5);
    await plannerSelect(page,'T-CORNER');f=await page.evaluate(TXFORM);assert.deepEqual(f.edges.map(e=>e.name),['شارع النور','شارع الضياء','','']);near(f.area,825,0.05,'T-CORNER after reload');
    log('after reload: T-CORNER names / setbacks / area read back from IndexedDB');await closeForm(page);

    assert.deepEqual(errors,[],'no page errors');
    console.log('E2E transaction form passed');
  }finally{await browser.close();srv.close();fs.rmSync(tmp,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
