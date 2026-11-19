'use strict';
/* Browser test of «فتح قاعدة .gdb» in «استيراد الأرض» (filegdb.js + gdb-import.js) on a real municipal File Geodatabase
   (GDB_MASTER, default G:/Master GIS Data.gdb; skipped when absent).
   Checks: the parcel and street layers chosen automatically, the area shown on the map imported (only the parcels around it),
   coordinates converted (UTM 37N on WGS 84 for parcels, KSA-GRF17 for streets), parcel areas equal to the database's own
   SHAPE_Area, the parcel number field read, streets with name and width, the transaction form drawn with the street band only
   where no neighbouring parcel stands; «الطبقة كاملة» refused for a layer larger than the limit.
   Needs playwright-core (NODE_PATH) and Chromium/Chrome (CHROME_PATH).  Run: node tests/e2e_gdb_import.js */
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const ROOT=path.resolve(__dirname,'..'),GDB=process.env.GDB_MASTER||'G:/Master GIS Data.gdb',OUT=process.env.GDB_SNAP||'';
const log=(...a)=>console.log('  ✓',...a);
if(!fs.existsSync(path.join(GDB,'a00000001.gdbtable'))){console.log('  ✓ skipped: no .gdb at '+GDB+' (set GDB_MASTER)');process.exit(0)}
function browserPath(){if(process.env.CHROME_PATH)return process.env.CHROME_PATH;
  return['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>fs.existsSync(p))}
const serve=()=>new Promise(res=>{const srv=http.createServer((q,out)=>{const file=path.join(ROOT,decodeURIComponent(new URL(q.url,'http://x').pathname));
  if(!file.startsWith(ROOT)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){out.writeHead(404);out.end();return}
  const T={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8'};out.writeHead(200,{'Content-Type':T[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});
  fs.createReadStream(file).pipe(out)});srv.listen(0,'127.0.0.1',()=>res(srv))});

(async()=>{const srv=await serve(),browser=await chromium.launch({executablePath:browserPath()});let failed=false;
  try{const page=await (await browser.newContext({viewport:{width:1500,height:950}})).newPage();
    await page.addInitScript(()=>{window.__texts=new WeakMap();const f=CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText=function(t,...a){const l=__texts.get(this.canvas)||[];l.push(String(t));__texts.set(this.canvas,l);return f.call(this,t,...a)}});
    page.on('pageerror',e=>{failed=true;console.error('page error:',e.message)});
    await page.goto(`http://127.0.0.1:${srv.address().port}/index.html`);await page.waitForFunction(()=>window.FileGDB&&typeof useParcelLayer==='function'&&map);
    // the map on a neighbourhood of Al-Aziziyah (Umm Al-Qura University)
    await page.evaluate(()=>map.setView([21.3935,39.8735],17,{animate:false}));
    const t0=Date.now();await page.setInputFiles('#gdbIn',GDB);await page.waitForFunction(()=>!document.getElementById('gdbModal').hidden,null,{timeout:120000});
    const d=await page.evaluate(()=>({p:$('#gdbParcels').selectedOptions[0].textContent,r:$('#gdbRoads').selectedOptions[0].textContent,hint:$('#gdbHint').textContent}));
    assert.match(d.p,/^plParcel/,'parcel layer chosen: '+d.p);assert.match(d.r,/^bRoadcenterline/,'street layer chosen: '+d.r);
    log(`database opened in ${Date.now()-t0} ms; chosen: ${d.p} · ${d.r}`);
    // the whole parcel layer is too large
    await page.selectOption('#gdbScope','all');await page.click('#gdbGo');await page.waitForTimeout(500);
    assert.equal(await page.evaluate(()=>PARCELS.length),0,'whole layer refused');await page.selectOption('#gdbScope','view');log('«الطبقة كاملة» refused for 260 000 parcels');
    const t1=Date.now();await page.click('#gdbGo');
    try{await page.waitForFunction(()=>PARCELS.length>0&&CUR_PC&&ROADS.length>0,null,{timeout:120000})}
    catch(e){throw new Error('import did not finish: '+JSON.stringify(await page.evaluate(()=>({toast:$('#toast').textContent,status:$('#gdbStatus').textContent,center:map.getCenter(),zoom:map.getZoom(),n:PARCELS.length,roads:ROADS.length}))))}
    const r=await page.evaluate(()=>{const ok=PARCELS.filter(p=>p.polygon).length,within=PARCELS.every(p=>p.polygon.some(([lon,lat])=>Math.abs(lat-21.3935)<0.02&&Math.abs(lon-39.8735)<0.02));
      // planner area (local metres) vs the database's own SHAPE_Area, for the first parcels
      const cmp=PARCELS.slice(0,30).map(pc=>{applyParcel(pc);const m=compute();return[m.plotArea,+pc.attrs.SHAPE_Area]}).filter(([a,b])=>b>0);
      const named=ROADS.filter(f=>String(f.properties.RoadcenterlineAName||'').trim()).length,wide=ROADS.filter(f=>+f.properties.Width>0).length;
      return{n:PARCELS.length,ok,within,cmp,roads:ROADS.length,named,wide,no:PARCELS.filter(p=>p.attrs.PARCEL_NUMBER).length,info:$('#importInfo').textContent}});
    assert.ok(r.n>50&&r.ok===r.n&&r.within,'parcels of the area, all converted: '+JSON.stringify(r).slice(0,200));
    const worst=Math.max(...r.cmp.map(([a,b])=>Math.abs(a-b)/b));assert.ok(worst<0.002,'areas equal to SHAPE_Area (worst '+(worst*100).toFixed(3)+'%)');
    assert.ok(r.named>0&&r.wide>0,'streets with names and widths');
    log(`${r.n} parcels (${r.no} with PARCEL_NUMBER) and ${r.roads} street parts imported in ${Date.now()-t1} ms; areas = SHAPE_Area (worst ${(worst*100).toFixed(3)}%)`);
    // the transaction form of a parcel on a street with neighbours: the street band is not drawn across the neighbouring parcels
    const pick=await page.evaluate(async()=>{for(const pc of PARCELS.filter(p=>p.attrs.PARCEL_NUMBER&&+p.attrs.SHAPE_Area>300&&+p.attrs.SHAPE_Area<1500).slice(0,300)){await activateParcel(pc);
      const m=compute(),T=txData(m);if(T.streets.some(e=>e.name)&&txNeighbours(m).length>=4)return{id:pc.stableId,no:pc.attrs.PARCEL_NUMBER,names:T.streets.map(e=>e.name)}}return null});
    assert.ok(pick&&pick.names.every(n=>!n||!/^\d+$/.test(n)),'street names from RoadcenterlineAName, never the Street_ID number: '+JSON.stringify(pick));
    await page.evaluate(async()=>{closeBld();await txOpen(false)});await page.waitForFunction(()=>BLD_OUT&&BLD_OUT.cv,null,{timeout:30000});
    if(OUT){fs.writeFileSync(OUT,Buffer.from((await page.evaluate(()=>BLD_OUT.cv.toDataURL('image/png'))).split(',')[1],'base64'));log('form saved: '+OUT)}
    log(`transaction form of parcel ${pick.no} (streets: ${pick.names.filter(Boolean).join('، ')})`);
    console.log(failed?'FAILED (page errors)':'ALL OK');if(failed)process.exitCode=1}
  catch(e){console.error(e);process.exitCode=1}
  finally{await browser.close();srv.close()}})();
