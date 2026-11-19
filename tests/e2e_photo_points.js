'use strict';
/* Browser test of the photo points («نقاط الصور», photo-points.js) and of «حذف الأرض».
   A) synthetic GeoJSON layer (photo name + link, served by this test): the form of a parcel takes the photo of the point inside it,
      a parcel with a point a few metres outside takes that one, a parcel whose attributes name a photo takes it by name, a parcel
      with no point nearby keeps the empty frame; the photo date comes from the photo name; the list offers the candidates;
      the layer is restored after a reload.
   B) the user's File Geodatabase when it is on this computer (PP_GDB, default G:/4_11_2026/4_11_2026/DB_4_11_2026.gdb):
      the folder is opened, its point layer and attachment table are read, the photo comes from inside the .gdb (JPEG bytes).
   C) «حذف الأرض» removes the parcel only: settings and user rules stay.
   Needs playwright-core (NODE_PATH) and Chromium/Chrome (CHROME_PATH).  Run: node tests/e2e_photo_points.js */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const ROOT=path.resolve(__dirname,'..'),TMP=fs.mkdtempSync(path.join(os.tmpdir(),'pp-e2e-'));
const GDB=process.env.PP_GDB||'G:/4_11_2026/4_11_2026/DB_4_11_2026.gdb';
function browserPath(){if(process.env.CHROME_PATH)return process.env.CHROME_PATH;
  return['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium','/usr/bin/google-chrome'].find(p=>fs.existsSync(p))}
const log=(...a)=>console.log('  ✓',...a);

// a small PNG of one colour (the photos served by the test)
function png(w,h,[r,g,b]){const crcT=[...Array(256)].map((_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0});
  const crc=buf=>{let c=0xffffffff;for(const x of buf)c=crcT[(c^x)&255]^(c>>>8);return(c^0xffffffff)>>>0};
  const chunk=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(t),d]),c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([l,td,c])};
  const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;
  const raw=Buffer.alloc((w*3+1)*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++)raw.set([r,g,b],y*(w*3+1)+1+x*3);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ih),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))])}
const PHOTOS={'2026-11-04_09-10-11_21.40000_39.80000.jpg':[200,40,40],'2026-11-04_09-20-22_21.40100_39.80000.jpg':[40,160,40],'2026-11-05_08-00-00_21.40200_39.80000.jpg':[40,40,200]};
const served=[];
const serve=()=>new Promise(res=>{const srv=http.createServer((q,out)=>{const u=decodeURIComponent(new URL(q.url,'http://x').pathname);
  if(u.startsWith('/photos/')){const c=PHOTOS[u.slice(8)];served.push(u.slice(8));if(!c){out.writeHead(404);out.end();return}
    out.writeHead(200,{'Content-Type':'image/jpeg','Access-Control-Allow-Origin':'*'});out.end(png(60,80,c));return}
  const file=path.join(ROOT,u);if(!file.startsWith(ROOT)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){out.writeHead(404);out.end();return}
  const T={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8'};out.writeHead(200,{'Content-Type':T[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});
  fs.createReadStream(file).pipe(out)});srv.listen(0,'127.0.0.1',()=>res(srv))});

// a 20 × 20 m parcel drawn by hand around (lat, lon), shifted dy metres north; its attributes stay empty
const DRAW=async([lat,lon,dy])=>{S.coordMode='local';S.refLat=lat;S.refLon=lon;S.projType='land';CUR_PC=null;
  S.verts=[[-10,dy-10],[10,dy-10],[10,dy+10],[-10,dy+10]].map(([x,y])=>({x,y,sb:0,role:'side',name:''}));S.geom=null;structural();syncInputs();M=compute();clearTxPhoto()};
const FORM=`(async()=>{closeBld();await txOpen(false);await new Promise((r,no)=>{const t0=Date.now(),t=setInterval(()=>{if(BLD_OUT&&BLD_OUT.cv){clearInterval(t);r()}else if(Date.now()-t0>20000){clearInterval(t);no(new Error('form not drawn: '+($('#toast')?.textContent||'')+' bad='+compute().bad))}},50)});return{img:TXIMG?[TXIMG.naturalWidth,TXIMG.naturalHeight]:null,
  px:TXIMG?(()=>{const c=document.createElement('canvas');c.width=c.height=1;const g=c.getContext('2d');g.drawImage(TXIMG,0,0,1,1);return[...g.getImageData(0,0,1,1).data].slice(0,3)})():null,
  at:S.tx.photoAt,texts:__texts.get(BLD_OUT.cv)||[],pick:[...document.querySelectorAll('#ppPick option')].map(o=>o.textContent),info:$('#ppInfo').textContent}})()`;
const near=(a,b)=>a&&a.every((v,i)=>Math.abs(v-b[i])<=12);

(async()=>{const srv=await serve(),port=srv.address().port,base=`http://127.0.0.1:${port}`;
  const browser=await chromium.launch({executablePath:browserPath()});let failed=false;
  try{const ctx=await browser.newContext({viewport:{width:1500,height:950}}),page=await ctx.newPage();
    // every string drawn on a canvas (to read the form)
    await page.addInitScript(()=>{window.__texts=new WeakMap();const f=CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText=function(t,...a){const l=__texts.get(this.canvas)||[];l.push(String(t));__texts.set(this.canvas,l);return f.call(this,t,...a)}});
    page.on('dialog',d=>d.accept());page.on('pageerror',e=>{failed=true;console.error('page error:',e.message)});
    await page.goto(base+'/index.html');await page.waitForFunction(()=>window.PhotoPoints&&typeof ppAuto==='function');

    console.log('A) GeoJSON photo layer');
    const names=Object.keys(PHOTOS),pts=[[21.40000,39.80000,names[0]],[21.40100,39.80000,names[1]],[21.40200,39.80000,names[2]],[21.40000,39.80000+0.0004,'']];
    const gj={type:'FeatureCollection',features:pts.map(([la,lo,n],i)=>({type:'Feature',properties:{'اسم_الصورة':n||'2026-11-06_10-00-00_x.jpg','رابط_الصورة':n?`${base}/photos/${n}`:`${base}/photos/missing.jpg`,'#':i+1},geometry:{type:'Point',coordinates:[lo,la]}}))};
    fs.writeFileSync(path.join(TMP,'photos.geojson'),JSON.stringify(gj));
    await page.setInputFiles('#ppFileIn',path.join(TMP,'photos.geojson'));await page.waitForFunction(()=>PP_SET&&PP_SET.points.length===4);
    assert.deepEqual(await page.evaluate(()=>PP_SET.fields),{name:'اسم_الصورة',url:'رابط_الصورة'},'photo name / link columns found by their values');
    // point inside the parcel
    await page.evaluate(DRAW,[21.40000,39.80000,0]);let f=await page.evaluate(FORM);
    assert.ok(near(f.px,PHOTOS[names[0]]),'photo of the point inside the parcel: '+f.px);assert.equal(f.at,'2026-11-04 09:10:11','date and time from the photo name');
    assert.ok(f.texts.includes('٢٠٢٦/١١/٠٤'),'photo date on the form');assert.ok(f.pick[0].includes('داخل القطعة'),'list: '+f.pick.join(' | '));
    log('point inside the parcel → its photo, date 2026/11/04 on the form');
    // the nearest point a few metres outside (photos are taken from the street)
    await page.evaluate(DRAW,[21.40100,39.80000,-15]);f=await page.evaluate(FORM);
    assert.ok(near(f.px,PHOTOS[names[1]]),'nearest point outside the parcel: '+f.px);assert.match(f.pick[0],/على بعد ٥ م|على بعد 5 م/,'distance shown: '+f.pick[0]);
    log('point 5 m outside → its photo, distance shown');
    // reopening the same parcel keeps the photo shown
    const before=served.length;f=await page.evaluate(FORM);assert.equal(served.length,before,'reopening the same parcel does not reload the photo');
    // a parcel whose attributes name a photo takes it, wherever its point is
    await page.evaluate(async([n])=>{PP_FOR='';await ppAuto(M,{stableId:'named',attrs:{'اسم الصورة':n}})},[names[2]]);
    assert.ok(near(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=1;const g=c.getContext('2d');g.drawImage(TXIMG,0,0,1,1);return[...g.getImageData(0,0,1,1).data].slice(0,3)}),PHOTOS[names[2]]),'photo linked by its name');
    assert.equal(await page.evaluate(()=>PP_CANDS[0].how),'name');log('photo named in the parcel attributes → linked by name first');
    // no point within 40 m
    await page.evaluate(DRAW,[21.45,39.85,0]);f=await page.evaluate(FORM);
    assert.equal(f.img,null,'no photo point nearby → empty frame');assert.ok(f.texts.includes('صورة التوثيق الفوتوغرافي'),'empty frame drawn');assert.match(f.info,/لا توجد صورة/);
    log('no point within 40 m → frame left empty, said so');
    // the layer is kept after a reload (photos then come from their links)
    await page.reload();await page.waitForFunction(()=>PP_SET&&PP_SET.points.length===4);log('photo layer restored after a reload');

    console.log('D) map: parcels still clickable with the photo points shown');
    await page.setInputFiles('#parcelFile',path.join(ROOT,'tests','fixtures','tx-cases.geojson'));await page.waitForFunction(()=>PARCELS.length>=3&&CUR_PC);
    const c=await page.evaluate(()=>PARCELS.slice(0,2).map(pc=>{const r=pcWgs(pc);return{id:pc.stableId,lat:r.reduce((a,p)=>a+p[1],0)/r.length,lon:r.reduce((a,p)=>a+p[0],0)/r.length}}));
    fs.writeFileSync(path.join(TMP,'pts2.geojson'),JSON.stringify({type:'FeatureCollection',features:[{type:'Feature',properties:{n:names[1],u:`${base}/photos/${names[1]}`},geometry:{type:'Point',coordinates:[c[0].lon,c[0].lat]}}]}));
    await page.setInputFiles('#ppFileIn',path.join(TMP,'pts2.geojson'));await page.waitForFunction(()=>PP_SET&&PP_SET.points.length===1);
    const at=async(ll,dx=0)=>page.evaluate(([ll,dx])=>{setView('map');const p=map.latLngToContainerPoint([ll.lat,ll.lon]),b=map.getContainer().getBoundingClientRect();return{x:b.left+p.x+dx,y:b.top+p.y}},[ll,dx]);
    await page.evaluate(([ll])=>{setView('map');map.setView([ll.lat,ll.lon],18,{animate:false})},[c[1]]);await page.waitForTimeout(400);
    assert.ok(await page.evaluate(()=>PP_MAP&&PP_MAP.getLayers().length===1),'photo point drawn at street zoom');
    let q=await at(c[1]);await page.mouse.click(q.x,q.y);await page.waitForFunction(id=>CUR_PC&&CUR_PC.stableId===id,c[1].id,{timeout:10000});
    log('a parcel is selected by a click on the map while the photo points are shown');
    await page.evaluate(([ll])=>map.setView([ll.lat,ll.lon],18,{animate:false}),[c[0]]);await page.waitForTimeout(400);
    q=await at(c[0],25);await page.mouse.click(q.x,q.y);await page.waitForFunction(id=>CUR_PC&&CUR_PC.stableId===id,c[0].id,{timeout:10000});   // beside the point
    await page.waitForTimeout(300);q=await at(c[0]);await page.mouse.click(q.x,q.y);await page.waitForFunction(()=>PP_CANDS[0]&&PP_CANDS[0].how==='map'&&TXIMG,null,{timeout:10000});
    log('a click on a photo point inside the selected parcel gives it that photo');
    await page.evaluate(()=>map.setZoom(13,{animate:false}));await page.waitForTimeout(300);
    assert.ok(await page.evaluate(()=>!PP_MAP),'photo points hidden below street zoom');log('photo points hidden when zoomed out (light map)');

    console.log('C) «حذف الأرض»');
    await page.evaluate(()=>{S.urules.div=4;persist()});await page.evaluate(DRAW,[21.40000,39.80000,0]);await page.evaluate(()=>setView('map'));
    await page.click('#mDel');await page.waitForTimeout(200);
    const del=await page.evaluate(()=>({n:S.verts.length,bad:compute().bad,div:S.urules.div,layer:!!PP_SET,poly:!!curPoly}));
    assert.deepEqual(del,{n:0,bad:true,div:4,layer:true,poly:false},'parcel removed, settings and layers kept');
    await page.evaluate(()=>{S.urules.div=5;persist()});log('parcel removed from the map; user rules and the photo layer kept');

    console.log('B) File Geodatabase');
    if(!fs.existsSync(path.join(GDB,'a00000001.gdbtable')))log('skipped: no .gdb at '+GDB+' (set PP_GDB)');
    else{await page.setInputFiles('#ppGdbIn',GDB);await page.waitForFunction(()=>PP_SET&&PP_SET.attach,null,{timeout:120000});
      const g=await page.evaluate(()=>({layer:PP_SET.layer,n:PP_SET.points.length,att:PP_SET.attach.count,f:PP_SET.fields,p:PP_SET.points[0]}));
      assert.ok(g.n>0&&g.att>0&&g.f.name,'point layer and attachments read: '+JSON.stringify(g).slice(0,200));
      const cnt=served.length;await page.evaluate(DRAW,[g.p.lat,g.p.lon,0]);f=await page.evaluate(FORM);
      assert.ok(f.img&&f.img[0]>100,'photo from inside the .gdb');assert.equal(served.length,cnt,'nothing downloaded');
      assert.equal(f.at,await page.evaluate(n=>txPhotoAt(n),g.p.name),'date from the photo name');
      const onMap=await page.evaluate(async p=>{setView('map');map.setView([p.lat,p.lon],18,{animate:false});await new Promise(r=>setTimeout(r,300));return PP_MAP?PP_MAP.getLayers().length:0},g.p);
      assert.ok(onMap>=1&&onMap<g.n,'only the photo points around the view are drawn: '+onMap);
      log(`«${g.layer}»: ${g.n} points, ${g.att} attached photos; the parcel's photo read from inside the .gdb (${f.img.join('×')})`)}
    console.log(failed?'FAILED (page errors)':'ALL OK');if(failed)process.exitCode=1}
  catch(e){console.error(e);process.exitCode=1}
  finally{await browser.close();srv.close();fs.rmSync(TMP,{recursive:true,force:true})}})();
