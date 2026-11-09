/* Navigation bridge for GIS Parcel Planner. Loaded after the original main script. */
(function(){
  'use strict';
  const KEY_IN='gis_planner_street_input_v1',KEY_OUT='gis_planner_street_output_v1';
  const sig=()=>typeof S==='undefined'||!Array.isArray(S.verts)?'':S.verts.map(v=>Number(v.x).toFixed(3)+','+Number(v.y).toFixed(3)).join('|');
  const parcelSig=()=>{if(typeof buildGeo!=='function')return'';const geo=buildGeo();return geo.L.map(p=>{const q=geo.F.toLL(p);return Number(q.lon).toFixed(7)+','+Number(q.lat).toFixed(7)}).join('|')};
  const token=()=>globalThis.crypto?.randomUUID?.()||`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  // Edge identity = its start and end vertex, so results never depend on the row order shown in Street Tools.
  const edgeKey=i=>{const n=S.verts.length,k=v=>Number(v.x).toFixed(3)+','+Number(v.y).toFixed(3);return k(S.verts[i])+'>'+k(S.verts[(i+1)%n])};
  const num=v=>v===null||v===undefined||v===''?NaN:Number(v);
  // Storage can be blocked (private mode, policies): a missing layer id must never stop the transfer.
  const lsGet=k=>{try{return globalThis.localStorage?.getItem(k)||''}catch(e){return''}};
  const FACES=['front','side','rear'];
  const btn=document.getElementById('moreStreetTools');
  if(btn)btn.addEventListener('click',()=>{
    let payload=null;
    try{
      if(typeof S!=='undefined'&&Array.isArray(S.verts)&&S.verts.length>=3&&typeof buildGeo==='function'){
        const geo=buildGeo(),poly=geo.L.map(p=>{const q=geo.F.toLL(p);return[q.lon,q.lat]});
        const attrs=(typeof CUR_PC!=='undefined'&&CUR_PC?.attrs)||{};
        payload={polygon:poly,attrs,parcelNo:String(S.tx?.parcelNo||S.gis?.no||(typeof ParcelFields!=='undefined'&&ParcelFields.value(attrs,'parcelNo'))||attrs.PARCEL_NO||attrs.PLOT_NO||attrs.FID||'القطعة المختارة'),
          signature:sig(),parcelSignature:CUR_PC?.parcelSignature||parcelSig(),parcelId:CUR_PC?.stableId||'',layerId:lsGet('gis_planner_parcel_layer_id_v1'),
          roadLayerId:lsGet('gis_planner_road_layer_id_v1'),edgeData:S.verts.map((v,i)=>({key:edgeKey(i),role:v.role||'side',sb:v.sb??0,name:v.name||'',
            streetW:v.streetW??null,streetWSrc:v.streetWSrc||'',streetMeasure:v.streetMeasure||null,sbSrc:v.sbSrc||''}))};
        // zoning requirements of this parcel (الاشتراطات التنظيمية): «مزيد» shows the same footprint limit next to its own area
        if(S.tx){const keys=['city','amana','municipality','district','planNo','parcelNo','zUse','zUseTxt','ratio','floors','height','far','farNA','parkPct','parkTxt','special','zExc','zRef','zRefDate','zStatus','zRule'];
          payload.zoning={parcelId:CUR_PC?.stableId||'',tx:JSON.parse(JSON.stringify(Object.fromEntries(keys.map(k=>[k,S.tx[k]])))),site:typeof zrSite==='function'?zrSite():null}}
        // multipart parcel: every part and hole goes along, with the setbacks and streets of their edges
        const full=typeof mainFullGeometry==='function'?mainFullGeometry():null;
        if(full){payload.parts=full.parts;payload.mainPart=full.mainPart;payload.ringEdgeData=Object.fromEntries(S.geom.rings.map(r=>[`p${r.part}r${r.ring}`,r.edges.map(e=>({role:e.role||'side',sb:e.sb??0,name:e.name||'',
          streetW:e.streetW??null,streetWSrc:e.streetWSrc||'',streetMeasure:e.streetMeasure||null,sbSrc:e.sbSrc||''}))]))}
      }
    }catch(e){console.warn('Street Tools export:',e)}
    if(payload){const id=token();try{sessionStorage.setItem(KEY_IN,JSON.stringify({token:id,payload}))}catch(e){alert('تعذر حفظ القطعة في مخزن الجلسة. لم يتم فتح الأدوات لتجنب فقدان بياناتها.');return}
      const url=new URL('street-tools.html',location.href);url.searchParams.set('parcel',id);location.href=url.href;
    }else location.href='street-tools.html';
  });
  async function applyReturnedResults(){
    const resultToken=new URLSearchParams(location.search).get('streetResult');let data=null;
    if(resultToken){try{const saved=JSON.parse(sessionStorage.getItem(KEY_OUT)||'null');if(saved?.token===resultToken)data=saved.data}catch(e){console.warn('Street Tools result:',e)}}
    const done=()=>{try{sessionStorage.removeItem(KEY_OUT)}catch(e){}try{const url=new URL(location.href);url.searchParams.delete('streetResult');history.replaceState(null,'',url.href)}catch(e){}};
    if(!data){if(resultToken)done();return}
    if(globalThis.mainParcelLayerReady)try{await globalThis.mainParcelLayerReady}catch(e){console.warn('Main parcel layer restore:',e)}
    if(!Array.isArray(data.entries)||typeof S==='undefined'){done();return}
    const currentId=typeof CUR_PC!=='undefined'?CUR_PC?.stableId:'';
    const sameParcel=data.parcelId&&currentId?data.parcelId===currentId:data.parcelSignature?data.parcelSignature===(CUR_PC?.parcelSignature||parcelSig()):data.signature===sig();
    if(!sameParcel){done();alert('نتائج الشوارع تخص قطعة أرض مختلفة عن القطعة المفتوحة الآن. لم يتم تغيير أي بيانات.');return}
    // lon/lat edge keys are compared numerically (≈5 cm): re-rounding a 7-decimal key to 6 decimals would miss ~1 edge in 10
    const geo=buildGeo(),geoEdge=i=>{const n=geo.L.length,ll=p=>{const q=geo.F.toLL(p);return[Number(q.lon),Number(q.lat)]};return[ll(geo.L[i]),ll(geo.L[(i+1)%n])]};
    const parseKey=key=>{const pts=String(key).split('>').map(point=>point.split(',').map(Number));return pts.length===2&&pts.every(p=>p.length===2&&p.every(Number.isFinite))?pts:null};
    const sameEdge=(a,b)=>a.every((p,k)=>Math.abs(p[0]-b[k][0])<5e-7&&Math.abs(p[1]-b[k][1])<5e-7);
    const resolve=r=>{if(r.key){const bare=String(r.key).replace(/^part:\d+:/,''),pts=parseKey(bare);for(let i=0;i<S.verts.length;i++)if(edgeKey(i)===bare||(pts&&sameEdge(pts,geoEdge(i))))return i;return -1}
      return Number.isInteger(r.edge)&&r.edge>=0&&r.edge<S.verts.length?r.edge:-1};
    const mainTarget=i=>i>=0?{obj:S.verts[i],at:i,main:true,label:`الضلع ${i+1}`}:null;
    // Multipart parcel (in the planner or in the results): the geometry must match part by part and hole by hole,
    // and every approved edge must resolve to its part/ring/edge; otherwise nothing is applied.
    const G2=globalThis.StreetGeometry,full=typeof mainFullGeometry==='function'?mainFullGeometry():null,multiResult=!!data.geometry?.multi;
    const fail=msg=>{done();alert(msg+'\nلم يتم تغيير أي بيانات.')};
    let target=r=>mainTarget(resolve(r));
    if(full||multiResult){
      if(!G2)return fail('مكتبة الهندسة غير محمّلة؛ لا يمكن التحقق من أجزاء القطعة.');
      if(!full)return fail('النتائج تخص قطعة متعددة الأجزاء أو بها فراغات، بينما القطعة المفتوحة في المخطط الرئيسي حلقة واحدة. أعد اختيار القطعة من الطبقة ثم طبّق النتائج.');
      if(!multiResult)return fail('القطعة في المخطط الرئيسي متعددة الأجزاء أو بها فراغات، والنتائج المستلمة لا تحمل هندسة كل الأجزاء. أعد التحليل في «مزيد» ثم طبّق النتائج.');
      if(!G2.sameStructure(full.parts,data.geometry.parts))return fail('هندسة القطعة في النتائج لا تطابق أجزاءها وفراغاتها في المخطط الرئيسي (عدد الأجزاء أو الفراغات أو مساحاتها).');
      target=r=>{const id=G2.parseEdgeId(r.key);if(!id||(full.parcelId&&id.parcelId!==full.parcelId))return null;
        if(id.part===full.mainPart&&id.ring===0){for(let i=0;i<S.verts.length;i++)if(sameEdge([id.a,id.b],geoEdge(i)))return mainTarget(i);return null}
        const ring=S.geom.rings.find(x=>x.part===id.part&&x.ring===id.ring);if(!ring)return null;const n=ring.ll.length;
        for(let e=0;e<n;e++)if(sameEdge([id.a,id.b],[ring.ll[e],ring.ll[(e+1)%n]]))return{obj:ring.edges[e],at:e,main:false,label:`${id.ring?`الفراغ ${id.ring} في الجزء ${id.part+1}`:`الجزء ${id.part+1}`} · الضلع ${e+1}`};
        return null}}
    const approved=data.entries.filter(r=>r.apply&&String(r.street||'').trim()).map(r=>({...r,t:target(r)}));
    if((full||multiResult)&&approved.some(r=>!r.t))return fail(`تعذّر ربط ${approved.filter(r=>!r.t).length} من الأضلاع المعتمدة بأجزاء القطعة في المخطط الرئيسي، لذلك لم يُطبَّق أي جزء من النتائج.`);
    const valid=approved.filter(r=>r.t);valid.forEach(r=>{r.at=r.t.at});
    if(!valid.length){done();return}
    const list=valid.map(r=>r.t.main?String(r.t.at+1):r.t.label).join('، ');
    if(!confirm(`تم استلام نتائج ربط الشوارع للأضلاع: ${list}.\nسيُحدَّث اسم الشارع وعرضه والارتداد المعتمد لهذه الأضلاع فقط، دون تغيير باقي الأضلاع.\nهل تريد المتابعة؟`)){done();return}
    const conflicts=[];
    valid.forEach(r=>{const v=r.t.obj,sb=num(v.sb),w=num(v.streetW);
      if(Number.isFinite(r.setback)&&sb>0&&Math.abs(sb-r.setback)>1e-6)conflicts.push(`• ${r.t.label}: الارتداد الحالي ${sb} م ← الجديد ${r.setback} م`);
      if(Number.isFinite(r.width)&&w>0&&Math.abs(w-r.width)>1e-6)conflicts.push(`• ${r.t.label}: عرض الشارع الحالي ${w} م ← الجديد ${r.width} م`)});
    const onMain=valid.filter(r=>r.t.main),txW=num(S.tx?.streetW),primary=onMain.find(r=>r.face?r.face==='front':r.front)||onMain[0]||null;
    if(primary&&Number.isFinite(num(primary.width))&&txW>0&&Math.abs(txW-num(primary.width))>1e-6)conflicts.push(`• عرض الشارع في نموذج المعاملة: ${txW} م ← الجديد ${num(primary.width)} م`);
    const overwrite=!conflicts.length||confirm(`توجد قيم سابقة مختلفة:\n${conflicts.join('\n')}\n\nموافق = استبدال القيم السابقة\nإلغاء = الإبقاء على القيم السابقة وتحديث أسماء الشوارع فقط`);
    valid.forEach(r=>{
      // nameSrc marks a street name applied from Street Tools (also when its face is «جانبي»), for the transaction form
      const v=r.t.obj;v.name=String(r.street).trim();v.nameSrc='streets';
      if(FACES.includes(r.face))v.role=r.face;else if(r.front)v.role='front';
      const sb=num(v.sb),w=num(v.streetW);
      if(Number.isFinite(r.setback)&&r.setback>=0&&(overwrite||!(sb>0))){v.sb=r.setback;v.sbSrc=r.setbackSource||''}
      if(Number.isFinite(r.width)&&r.width>0&&(overwrite||!(w>0))){v.streetW=r.width;v.streetWSrc=r.widthSource||'';v.streetMeasure=r.measure||null}
    });
    if(primary&&S.tx){S.tx.street=primary.street;S.tx.streetEdge=String(primary.at);
      if(Number.isFinite(primary.width)&&(overwrite||!(txW>0)))S.tx.streetW=String(primary.width)}
    if(typeof persist==='function')persist();if(typeof syncInputs==='function')syncInputs();if(typeof renderVerts==='function')renderVerts();if(typeof schedule==='function')schedule();
    if(typeof saveMainParcelSnapshot==='function'&&typeof CUR_PC!=='undefined')await saveMainParcelSnapshot(CUR_PC);
    done();
    if(typeof toast==='function')toast(`تم تطبيق ربط ${valid.length} أضلاع على القطعة${overwrite?'':' مع الإبقاء على القيم السابقة'}.`)
  }
  applyReturnedResults().catch(error=>{console.error('Street Tools return failed:',error);alert('تعذر تطبيق نتائج الشوارع. لم تتغير بيانات القطعة.')});
})();
