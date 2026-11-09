/* «إعدادات الحقول وجداول الربط» on the main planner (field-mapping.js holds the logic):
   · the dialog: one searchable select per item listing every column of the layer with 3 sample values; lookup tables from Excel
     / CSV with, per domain, the parcel's code column, the table, its key and name columns, an extra key, the priority and an
     on / off switch; a preview of the current parcel with the source of every value;
   · the mapping of every layer and the tables are kept in IndexedDB and restored with the layer;
   · values reach the transaction form (sources: GIS / جدول الربط / يدوي; a value typed by hand is never replaced), the sheet,
     PNG / PDF, the map tooltips, the plan CSV and «مزيد»; every parcel is processed in short slices so the page never freezes.
   Loaded after the page script; uses its globals (S, PARCELS, CUR_PC, MAIN_PARCEL_LAYER_ID, gisKeys, gisFields …). */
(function(){
  'use strict';
  const FM=window.FieldMapping;if(!FM)return;
  const q=s=>document.querySelector(s),E=s=>String(s??'').replace(/[&<>"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
  const TXI=FM.ITEMS.filter(it=>it.tx),TXK=new Set(TXI.map(it=>it.tx)),SRC={gis:'GIS',domain:'جدول الربط',manual:'يدوي'};
  const FMS=window.FMS={layerId:'',keys:[],keySet:new Set(),cfg:{mapping:{},bindings:[]},tables:[],from:'',P:null,stats:null,gen:0,busy:false,cache:new Map()};
  const store=()=>window.ParcelStore||null;
  const pageReady=()=>typeof S!=='undefined';

  /* ---------- the layer's mapping ---------- */
  // the parcel-number column chosen in «حقل رقم القطعة» (S.gisNoField) is the manual choice of that item
  function effMapping(cfg,keys){const m={...(cfg?.mapping||{})};if(m.parcelNo==null&&S.gisNoField&&keys.includes(S.gisNoField))m.parcelNo=S.gisNoField;return m}
  function compileNow(){FMS.P=FM.compile({mapping:effMapping(FMS.cfg,FMS.keys),bindings:FMS.cfg.bindings},FMS.keys,FMS.tables);FMS.cache.clear()}
  // a row with columns the layer does not have (a test row, a KML name): automatic columns from its own keys
  function planFor(row){if(!FMS.P)return null;const ks=Object.keys(row||{});if(ks.every(k=>FMS.keySet.has(k)))return FMS.P;
    const sig=ks.join('|');let P=FMS.cache.get(sig);if(!P){P=FM.compile({mapping:effMapping(FMS.cfg,ks),bindings:FMS.cfg.bindings},ks,FMS.tables);if(FMS.cache.size>30)FMS.cache.clear();FMS.cache.set(sig,P)}return P}
  window.fmResolve=row=>{const P=planFor(row||{});return P?FM.resolveRow(row||{},P):null};
  window.fmLoadForLayer=async function(){if(!pageReady())return FMS;FMS.layerId=typeof MAIN_PARCEL_LAYER_ID!=='undefined'?MAIN_PARCEL_LAYER_ID||'':'';
    FMS.keys=PARCELS.length&&typeof gisKeys==='function'?gisKeys():[];FMS.keySet=new Set(FMS.keys);
    const r=await FM.loadAll(store(),FMS.layerId,FMS.keys);FMS.tables=r.tables||[];FMS.from=r.from;
    FMS.cfg=r.cfg?{mapping:{...(r.cfg.mapping||{})},bindings:JSON.parse(JSON.stringify(r.cfg.bindings||[]))}:{mapping:{},bindings:[]};
    if(FMS.cfg.mapping.parcelNo!=null)S.gisNoField=FMS.cfg.mapping.parcelNo||'';
    compileNow();if(PARCELS.length&&typeof gisRefreshNos==='function')gisRefreshNos();fmInfo();fmApplyAll();return FMS};
  window.fmSetParcelNoField=function(col){if(!FMS.P)return;FMS.cfg.mapping.parcelNo=col||undefined;compileNow();saveCfg().catch(()=>{});fmApplyAll()};
  async function saveCfg(){const cfg={mapping:Object.fromEntries(Object.entries(FMS.cfg.mapping).filter(([,v])=>v!==undefined)),bindings:FMS.cfg.bindings};
    return FM.saveConfig(store(),FMS.layerId,FMS.keys,cfg)}

  /* ---------- every parcel, in slices ---------- */
  const fxOf=R=>{const v={},s={},u={};for(const it of FM.ITEMS){const o=R[it.id];if(o.value)v[it.id]=o.value;if(o.src)s[it.id]=o.src;if(o.undef)u[it.id]=o.warn||'غير محدد'}return{v,s,u}};
  async function fmApplyAll(){const gen=++FMS.gen,list=PARCELS,P=FMS.P;if(!P||!list.length){FMS.stats=null;FMS.busy=false;fmInfo();return}
    const st=FM.newStats(P);let i=0;FMS.busy=true;
    while(i<list.length){const t0=performance.now();
      while(i<list.length&&performance.now()-t0<12){const pc=list[i++],row=pc.attrs||pc.props||{},R=FM.resolveRow(row,P);pc.fx=fxOf(R);FM.addStats(st,R,row,P)}
      if(i<list.length){fmInfo(`جارٍ تطبيق إعدادات الحقول على القطع… ${i} / ${list.length}`);await new Promise(r=>setTimeout(r,0));if(gen!==FMS.gen)return}}
    FMS.busy=false;FMS.stats=st;fmInfo()}
  window.fmApplyAll=fmApplyAll;
  function fmInfo(msg){const el=q('#fmInfo');if(!el)return;if(msg){el.textContent=msg;return}
    if(!FMS.P||!PARCELS.length){el.textContent=FMS.tables.length?`جداول الربط المحفوظة: ${new Set(FMS.tables.map(t=>t.file)).size} ملف. حمّل طبقة القطع لربط الحقول.`:'';return}
    const man=FM.ITEMS.filter(it=>FMS.P.cols[it.id].manual).length,on=FMS.cfg.bindings.filter(b=>b.on).map(b=>FM.DOMAIN[b.domain].label);
    const st=FMS.stats,und=st?FM.ITEMS.map(it=>[it,st.items[it.id].undef]).filter(([,n])=>n):[];
    const off=FMS.from==='last'?FMS.cfg.bindings.filter(b=>!b.on).map(b=>FM.DOMAIN[b.domain].label):[];
    el.textContent=`الحقول: ${man?`${man} مختار يدويًا والباقي تلقائي`:'تلقائي'}${FMS.from==='schema'?' (إعدادات طبقة بنفس الحقول)':''} · جداول الربط: ${on.length?'مفعّلة لـ '+on.join('، '):'غير مفعّلة'}`+
      (FMS.from==='last'?` (من آخر إعدادات محفوظة${off.length?`؛ ${off.join('، ')} تحتاج تأكيد حقل الكود في «إعدادات الحقول»`:''})`:'')+
      (st?` · طُبّقت على ${st.n} قطعة`:'')+(und.length?` · غير محدد: ${und.slice(0,4).map(([it,n])=>`${it.label} ${n}`).join('، ')}`:'')}

  /* ---------- the transaction form of the current parcel ---------- */
  // mode 'parcel' (a parcel was just chosen: txFromParcel), 'restore' (its saved state), 'refresh' (the mapping changed).
  // A value typed by hand (fSrc 'manual') is kept in 'restore' and 'refresh'. A saved state from before this feature has no
  // fSrc: a value equal to the resolved one is marked with that source, any other value is kept as typed by hand.
  window.fmTxApply=function(R,mode){if(!R||!pageReady())return;const prev=S.tx.fSrc&&typeof S.tx.fSrc==='object'?S.tx.fSrc:null,fSrc={},fWarn={},fNote={};
    const legacy=mode==='restore'&&!prev;
    for(const it of TXI){const k=it.tx,o=R[it.id],cur=String(S.tx[k]??'').trim();
      if(mode!=='parcel'&&prev&&prev[k]==='manual'&&cur){fSrc[k]='manual';continue}
      if(legacy&&cur){fSrc[k]=o.value&&FM.normText(o.value)===FM.normText(cur)?o.src:'manual';continue}
      if(it.id==='parcelNo'&&!o.manual){fSrc[k]=cur?(prev?.[k]==='manual'&&mode!=='parcel'?'manual':'gis'):'';continue}  // own column picker
      // an item without any column keeps what the page set (e.g. «مبنية» from HAS_BUILDI, the use class from the parcel use)
      if(o.manual||o.src||o.undef){S.tx[k]=o.value;fSrc[k]=o.src}else fSrc[k]=cur?(prev?.[k]&&prev[k]!=='manual'&&mode!=='parcel'?prev[k]:'gis'):'';
      if(!S.tx[k]&&o.warn)fWarn[k]=o.warn;if(o.note&&S.tx[k])fNote[k]=o.note}
    S.tx.fSrc=fSrc;S.tx.fWarn=fWarn;S.tx.fNote=fNote;
    // zoning requirements: a value from GIS or from a table is «gis» there; manual / rule values are never touched
    const z=S.tx.zSrc||(S.tx.zSrc={});
    for(const it of TXI){const k=it.tx;if(!(k in z)||['manual','rule','user'].includes(z[k]))continue;if(fSrc[k]==='gis'||fSrc[k]==='domain')z[k]=S.tx[k]?'gis':'';else if(fSrc[k]!=='manual'&&!S.tx[k])z[k]=''}};
  window.fmAfterRestore=function(pc){const R=fmResolve(pc?.attrs||{});if(R)fmTxApply(R,'restore')};
  window.fmTouched=function(path){if(!String(path).startsWith('tx.'))return;const k=path.slice(3);if(!TXK.has(k))return;
    S.tx.fSrc=S.tx.fSrc||{};S.tx.fSrc[k]=String(S.tx[k]??'').trim()?'manual':'';if(S.tx.fSrc[k]==='manual'&&S.tx.fWarn)delete S.tx.fWarn[k];fmBadges()};
  // the form / sheet text of an item: its value, else «غير محدد» when a value was expected (warning), else ''
  window.fmShow=(v,k)=>String(v??'').trim()||(S.tx.fWarn&&S.tx.fWarn[k]?'غير محدد':'');
  function fmRefreshCurrent(){if(typeof CUR_PC==='undefined'||!CUR_PC)return;const R=fmResolve(CUR_PC.attrs||{});if(!R)return;fmTxApply(R,'refresh');
    if(window.ZoningRules&&!['manual','rule'].includes(S.tx.zSrc?.zUse)){const Z=window.ZoningRules,u=Z.classifyUse(S.tx.zUseTxt),alt=!S.tx.zUseTxt?Z.classifyUse(S.tx.parcelUse):'';S.tx.zUse=u||(alt&&alt!=='other'?alt:'');if(S.tx.zSrc)S.tx.zSrc.zUse=S.tx.zUse?'gis':''}
    S.gis=gisFields(CUR_PC.attrs||{});try{zrAutoApply(0)}catch(e){}try{userApply()}catch(e){}
    syncInputs();try{txHints()}catch(e){}persist();schedule();fmBadges()}
  window.fmRefreshCurrent=fmRefreshCurrent;
  // source badges: «GIS» / «جدول الربط» / «يدوي», «غير محدد» with its warning; the list of warnings under the parcel card
  window.fmBadges=function(){if(!pageReady())return;const f=S.tx.fSrc||{},w=S.tx.fWarn||{},n=S.tx.fNote||{};
    // every badge of a mapped item is computed here from both sources (zSrc of the requirements, fSrc of the mapping), so a
    // value typed by hand shows «يدوي» at once and a value replaced by a saved rule keeps «قاعدة»
    const z=S.tx.zSrc||{},ZL={gis:'GIS',manual:'يدوي',rule:'قاعدة',user:'قاعدة المستخدم'};
    document.querySelectorAll('[data-fsrc],[data-zsrc]').forEach(el=>{const k=el.dataset.fsrc||el.dataset.zsrc;if(!TXK.has(k))return;
      const has=String(S.tx[k]??'').trim()!=='',gisNo=k==='parcelNo'&&!has&&!!S.gis?.no;let t='',c='';
      if(el.dataset.fsrc){if(has&&f[k]){t=SRC[f[k]]||'';c=f[k]}}else{const s=gisNo?'gis':has?z[k]:'';t=ZL[s]||'';c=t?s:''}
      if(has&&f[k]==='domain'&&(!(k in z)||!z[k]||z[k]==='gis')){t=SRC.domain;c='domain'}
      if(has&&f[k]==='manual'){t=SRC.manual;c='manual'}
      if(!has&&!gisNo&&w[k]){t='غير محدد';c='undef'}
      if(el.textContent!==t)el.textContent=t;el.className='zsrc'+(c?' '+c:'');el.title=w[k]&&!has?w[k]:n[k]||''});
    const box=q('#fmTxWarn');if(box){const list=TXI.filter(it=>w[it.tx]&&!String(S.tx[it.tx]??'').trim()).map(it=>`${it.label}: غير محدد — ${w[it.tx]}`)
      .concat(TXI.filter(it=>n[it.tx]&&String(S.tx[it.tx]??'').trim()).map(it=>`${it.label}: ${n[it.tx]}`));
      box.hidden=!list.length;box.innerHTML=list.map(s=>`<div>${E(s)}</div>`).join('')}};
  // map tooltip and CSV columns of a parcel
  window.fmTip=pc=>{const v=pc?.fx?.v;if(!v)return'';const a=[v.planNo?`مخطط ${v.planNo}`:'',v.districtName||'',v.municipalityName?`بلدية ${v.municipalityName}`:''].filter(Boolean);return a.length?'<br>'+E(a.join(' · ')):''};
  const CSV_ITEMS=['planNo','planName','planCode','districtName','municipalityName','centerName','governorateName','landUse'];
  window.fmCsvHead=()=>[...CSV_ITEMS.map(id=>FM.ITEM[id].label),'مصدر البيانات','تحذيرات الربط'];
  window.fmCsvRow=pc=>{let fx=pc?.fx;if(!fx&&pc){const R=fmResolve(pc.attrs||{});if(R)fx=fxOf(R)}if(!fx)return CSV_ITEMS.map(()=>'').concat(['','']);
    return[...CSV_ITEMS.map(id=>fx.v[id]||(fx.u[id]?'غير محدد':'')),CSV_ITEMS.filter(id=>fx.s[id]).map(id=>`${FM.ITEM[id].label}: ${SRC[fx.s[id]]}`).join(' · '),
      Object.entries(fx.u).map(([id,m])=>`${FM.ITEM[id].label}: ${m}`).join(' · ')]};

  /* ---------- the dialog ---------- */
  let D=null;const isOpen=()=>!!q('#fmModal')&&!q('#fmModal').hidden;
  const shorten=(s,n=28)=>{s=String(s);return s.length>n?s.slice(0,n-1)+'…':s};
  function samplesOf(keys){const out=new Map(keys.map(k=>[k,[]])),need=new Set(keys);
    for(const pc of PARCELS){const a=pc.attrs||pc.props||{};for(const k of need){const v=a[k];if(v==null||typeof v==='object')continue;const s=String(v).trim();if(!s||/^<null>$/i.test(s))continue;const l=out.get(k);if(!l.includes(s)){l.push(s);if(l.length>=3)need.delete(k)}}if(!need.size)break}
    return out}
  const optText=k=>{const s=D.samples.get(k)||[];return`${k} — ${s.length?s.map(v=>shorten(v)).join(' · '):'(فارغ في كل القطع)'}`};
  function recompile(){D.P=FM.compile({mapping:D.mapping,bindings:D.bindings},FMS.keys,FMS.tables)}
  window.fmOpenDialog=async function(tab){if(!pageReady())return;if(PARCELS.length&&(!FMS.P||FMS.layerId!==(MAIN_PARCEL_LAYER_ID||'')))await fmLoadForLayer();
    else if(!FMS.tables.length){try{FMS.tables=(await FM.loadAll(store(),'',[])).tables||[]}catch(e){}}
    D={mapping:effMapping(FMS.cfg,FMS.keys),bindings:JSON.parse(JSON.stringify(FMS.cfg.bindings||[])),tab:tab||'fields',samples:samplesOf(FMS.keys),stats:null,gen:0};
    recompile();q('#fmModal').hidden=false;renderTab();draftStats();setTimeout(()=>q('#fmModal [aria-selected="true"]')?.focus(),0)};
  function closeDialog(){if(!q('#fmModal'))return;q('#fmModal').hidden=true;D&&(D.gen++);q('#fmBtn')?.focus()}
  function setTab(t){D.tab=t;renderTab()}
  function renderTab(){if(!D)return;document.querySelectorAll('#fmModal [data-fmtab]').forEach(b=>{const on=b.dataset.fmtab===D.tab;b.setAttribute('aria-selected',on?'true':'false');b.tabIndex=on?0:-1});
    // a change inside the same tab keeps the scroll position (a switch at the bottom does not jump to the top)
    const body=q('#fmBody'),keep=body.dataset.tab===D.tab?body.scrollTop:0;body.innerHTML=D.tab==='fields'?fieldsHtml():D.tab==='domains'?domainsHtml():previewHtml();
    body.dataset.tab=D.tab;body.scrollTop=keep;status()}
  const curRow=()=>typeof CUR_PC!=='undefined'&&CUR_PC?CUR_PC.attrs||{}:null;
  const curR=()=>{const r=curRow();return r&&D.P?FM.resolveRow(r,D.P):null};
  function valLine(R,id){if(!R)return'';const o=R[id];if(o.value)return`القطعة الحالية: <b>${E(o.value)}</b> <span class="zsrc ${o.src}">${SRC[o.src]||''}</span>${o.src==='domain'?` الكود ${E(o.code)}`:o.field?` · ${E(o.field)}`:''}${o.note?` <span class="fm-bad">· ${E(o.note)}</span>`:''}`;
    return o.undef?`القطعة الحالية: <b class="fm-bad">غير محدد</b> — ${E(o.warn||'')}`:'القطعة الحالية: —'}
  function colSelect(id,cls,extra=''){const c=D.P.cols[id],m=D.mapping[id],auto=FM.autoColumns(FMS.keys,id)[0]||'';
    const opts=[`<option value="__auto"${m==null?' selected':''}>تلقائي — ${auto?E(optText(auto)):'لا يوجد حقل مطابق'}</option>`];
    if(id!=='parcelNo')opts.push(`<option value="__none"${m===''?' selected':''}>بلا حقل (لا يُقرأ من الطبقة)</option>`);
    FMS.keys.forEach(k=>opts.push(`<option value="${E(k)}"${m===k?' selected':''}>${E(optText(k))}</option>`));
    return`<select class="${cls}" data-item="${id}" ${extra}>${opts.join('')}</select>${c.missing?`<div class="fm-bad">الحقل المحفوظ «${E(c.missing)}» غير موجود في هذه الطبقة</div>`:''}`}
  function fieldsHtml(){if(!PARCELS.length)return`<p class="hint">حمّل طبقة القطع أولًا (القسم 01) لربط حقولها. يمكنك رفع جداول الربط من تبويب «جداول الربط».</p>`;
    const R=curR();return`<p class="hint">يقترح البرنامج الحقل المناسب لكل بيان تلقائيًا؛ اختيارك اليدوي يتقدّم دائمًا. يظهر كل حقل مع 3 قيم من بيانات الطبقة. ${FMS.keys.length} حقلًا في ${PARCELS.length} قطعة.</p>`+
      FM.GROUPS.map(g=>`<section class="fm-group"><h3>${E(g)}</h3>${FM.ITEMS.filter(it=>it.group===g).map(it=>{const man=D.mapping[it.id]!=null;
        return`<div class="fm-row" data-row="${it.id}"><div class="fm-lab"><label for="fmSel_${it.id}">${E(it.label)}</label> <span class="fm-tag ${man?'manual':'auto'}">${man?'يدوي':'تلقائي'}</span></div>
          <input type="search" class="fm-q" data-for="${it.id}" placeholder="بحث في الحقول…" aria-label="بحث في حقول ${E(it.label)}">
          ${colSelect(it.id,'fm-sel',`id="fmSel_${it.id}"`)}<div class="fm-val" data-val="${it.id}">${valLine(R,it.id)}</div></div>`}).join('')}</section>`).join('')}
  const tableOf=id=>FMS.tables.find(t=>t.id===id)||null;
  const tSamples=(t,col)=>{if(!t)return'';const i=t.columns.indexOf(col),s=[];for(const r of t.rows){const v=String(r[i]??'').trim();if(v&&!s.includes(v)){s.push(v);if(s.length>=3)break}}return s.map(v=>shorten(v,22)).join(' · ')};
  function tColSelect(t,val,attrs,none){const cols=t?t.columns:[];return`<select ${attrs}>${none?`<option value="">${none}</option>`:''}${cols.map(c=>`<option value="${E(c)}"${c===val?' selected':''}>${E(c)} — ${E(tSamples(t,c))}</option>`).join('')}</select>`}
  function domainsHtml(){const files=[...new Set(FMS.tables.map(t=>t.file))];
    let h=`<div class="fm-up"><label class="btn" for="fmFile">رفع جدول ربط (Excel ‎.xlsx أو CSV)</label><input type="file" id="fmFile" accept=".xlsx,.xlsm,.csv,.tsv,.txt" multiple hidden>
      <button class="sm" data-fmact="suggest"${FMS.tables.length?'':' disabled'}>اقتراح الربط من الجداول</button>
      <span class="hint">تُحفظ الجداول في متصفحك فقط (IndexedDB) ولا يُعدَّل ملف GIS. لا يُعتبر أي رقم كودًا إلا بعد تحديد حقل الكود وجدول الربط وعمود الاسم وتفعيل الربط.</span></div>`;
    h+=files.length?`<ul class="fm-files">${files.map(f=>`<li><b>${E(f)}</b>: ${FMS.tables.filter(t=>t.file===f).map(t=>`${E(t.name)} (${t.rows.length} صف · ${t.columns.length} عمود)`).join('، ')} <button class="sm" data-fmact="delfile" data-file="${E(f)}">حذف</button></li>`).join('')}</ul>`:'<p class="hint">لا توجد جداول ربط بعد.</p>';
    h+=FM.DOMAINS.map(d=>{const b=D.bindings.find(x=>x.domain===d.id),t=b?tableOf(b.table):null,B=D.P.bindings.find(x=>x.domain===d.id);
      const head=`<div class="fm-dhead"><b>${E(d.label)}</b> <span class="fm-tag ${b?.on?'manual':'auto'}">${b?.on?'مفعّل':'غير مفعّل'}</span></div>`;
      const codeSel=PARCELS.length?`<label>حقل ${E(FM.ITEM[d.code].label)} في الطبقة${colSelect(d.code,'fm-sel',`aria-label="حقل ${E(FM.ITEM[d.code].label)} في الطبقة"`)}</label>`:'';
      // the sheet name first (a long file name would hide it); the file only when two files have a sheet of that name
      const tLabel=x=>`${x.name} (${x.rows.length} صف)${FMS.tables.some(y=>y!==x&&y.name===x.name)?` — ${x.file}`:''}`;
      const tSel=`<label>جدول الربط<select data-dom="${d.id}" data-f="table"><option value="">— اختر جدولًا —</option>${FMS.tables.map(x=>`<option value="${E(x.id)}"${b?.table===x.id?' selected':''} title="${E(x.file)}">${E(tLabel(x))}</option>`).join('')}</select></label>`;
      if(!b)return`<section class="fm-dom">${head}<div class="fm-grid">${codeSel}${tSel}</div></section>`;
      const outs=Object.keys(d.out).map(it=>`<label>عمود ${E(FM.ITEM[it].label)}${tColSelect(t,b.outputs?.[it]||'',`data-dom="${d.id}" data-f="out" data-it="${it}"`,'— لا يُملأ من الجدول —')}</label>`).join('');
      const x=b.extra?.[0]||{};
      const extra=`<label>مفتاح ربط إضافي — حقل الطبقة<select data-dom="${d.id}" data-f="xfield"><option value="">— بدون —</option>${FMS.keys.map(k=>`<option value="${E(k)}"${x.field===k?' selected':''}>${E(optText(k))}</option>`).join('')}</select></label>
        <label>مفتاح ربط إضافي — عمود الجدول${tColSelect(t,x.col||'',`data-dom="${d.id}" data-f="xcol"`,'— بدون —')}</label>`;
      return`<section class="fm-dom" data-domcard="${d.id}">${head}<div class="fm-grid">${codeSel}${tSel}
        <label>عمود الكود في الجدول${tColSelect(t,b.keyCol,`data-dom="${d.id}" data-f="key"`,'— اختر —')}</label>${outs}${extra}
        <label>الأولوية عند وجود الاسم في الطبقة<select data-dom="${d.id}" data-f="prefer"><option value="gis"${b.prefer!=='domain'?' selected':''}>حقل GIS المباشر أولًا ثم الجدول</option><option value="domain"${b.prefer==='domain'?' selected':''}>جدول الربط أولًا</option></select></label></div>
        <div class="btns"><label class="chk"><input type="checkbox" data-dom="${d.id}" data-f="on"${b.on?' checked':''}> تفعيل هذا الربط (بعد مراجعة نتيجة المطابقة)</label><button class="sm" data-fmact="unbind" data-dom="${d.id}">إزالة الربط</button></div>
        <div class="fm-st" data-st="${d.id}">${statHtml(d,B)}</div></section>`}).join('');
    return h}
  function statHtml(d,B){if(!B)return'';const ix=B.index;if(!ix.ok)return`<span class="fm-bad">${E(ix.why)}</span>`;
    const list=a=>a.slice(0,8).map(E).join('، ')+(a.length>8?` … (+${a.length-8})`:'');
    let h=`الجدول: ${ix.rows} صف · ${ix.keys} كود`+(ix.same.length?` · مكرر بالقيم نفسها (ليس تعارضًا): ${list(ix.same)}`:'')+(ix.conflicts.length?` · <span class="fm-bad">كود له أكثر من قيمة: ${list(ix.conflicts)} — أضف مفتاح ربط إضافي</span>`:'');
    const s=D.stats?.bindings?.[d.id];
    if(!PARCELS.length)return h;if(!s)return h+'<br>جارٍ فحص المطابقة على القطع…';
    const miss=[...s.missing.keys()],conf=[...s.conflict.keys()];
    return h+`<br>القطع: لها كود ${s.withCode} · <span class="fm-ok">مطابقة ${s.matched}</span>`+(miss.length?` · <span class="fm-bad">غير موجود في الجدول ${miss.length} كود (${list(miss)})</span>`:'')+
      (conf.length?` · <span class="fm-bad">تعارض ${conf.length} (${list(conf)})</span>`:'')+(s.noCode?` · بلا كود ${s.noCode}`:'')}
  function previewHtml(){if(!PARCELS.length)return'<p class="hint">حمّل طبقة القطع أولًا.</p>';const R=curR(),st=D.stats;
    const no=typeof CUR_PC!=='undefined'&&CUR_PC?(CUR_PC.no||CUR_PC.label||''):'';
    let h=`<p class="hint">القيم كما ستظهر في نموذج المعاملة واللوحة و«مزيد» بالإعدادات الحالية (قبل الحفظ). القطعة الحالية: <b>${E(no||'—')}</b>. القيمة المكتوبة يدويًا في النموذج تبقى كما هي.</p>
      <table class="fm-table"><thead><tr><th>البيان</th><th>القيمة</th><th>المصدر</th><th>الحقل / الكود</th><th>ملاحظة</th>${st?'<th>كل القطع</th>':''}</tr></thead><tbody>`;
    for(const it of FM.ITEMS){const o=R?R[it.id]:{},s=st?.items[it.id];
      h+=`<tr><td>${E(it.label)}</td><td>${o.value?E(o.value):o.undef?'<b class="fm-bad">غير محدد</b>':'—'}</td><td>${o.src?`<span class="zsrc ${o.src}">${SRC[o.src]}</span>`:''}</td>
        <td>${E(o.src==='domain'?`${o.code} ← ${o.table}`:o.field||'')}</td><td class="${o.warn?'fm-bad':''}">${E(o.warn||o.note||'')}</td>${st?`<td>${s.gis?`GIS ${s.gis}`:''}${s.domain?` · جدول ${s.domain}`:''}${s.undef?` · <span class="fm-bad">غير محدد ${s.undef}</span>`:''}</td>`:''}</tr>`}
    return h+'</tbody></table>'+(st?`<p class="hint">فُحصت ${st.n} قطعة.</p>`:'<p class="hint">جارٍ فحص كل القطع…</p>')}
  function status(msg){const el=q('#fmStatus');if(el)el.textContent=msg||(FMS.layerId||PARCELS.length?`الإعدادات تُحفظ لهذه الطبقة${FMS.layerId?'':' (بحسب أسماء حقولها)'} في متصفحك.`:'')}
  // statistics of the draft over every parcel, in slices; the visible parts are refreshed when done
  async function draftStats(){if(!D||!PARCELS.length)return;const gen=++D.gen,P=D.P,st=FM.newStats(P),list=PARCELS;let i=0;D.stats=null;
    while(i<list.length){const t0=performance.now();while(i<list.length&&performance.now()-t0<10){const row=list[i++].attrs||{};FM.addStats(st,FM.resolveRow(row,P),row,P)}
      if(i<list.length){status(`جارٍ فحص القطع… ${i} / ${list.length}`);await new Promise(r=>setTimeout(r,0));if(!D||gen!==D.gen)return}}
    D.stats=st;status();if(D.tab==='domains')FM.DOMAINS.forEach(d=>{const el=q(`#fmBody [data-st="${d.id}"]`);if(el)el.innerHTML=statHtml(d,D.P.bindings.find(x=>x.domain===d.id))});
    else if(D.tab==='preview')renderTab()}
  let dt=0;const changed=(rerender)=>{recompile();if(rerender)renderTab();else{const R=curR();document.querySelectorAll('#fmBody [data-val]').forEach(el=>{el.innerHTML=valLine(R,el.dataset.val)})}
    clearTimeout(dt);dt=setTimeout(draftStats,150)};
  function bindingOf(dom,create){let b=D.bindings.find(x=>x.domain===dom);if(!b&&create){b={domain:dom,table:'',keyCol:'',outputs:{},extra:[],prefer:'gis',on:false};D.bindings.push(b)}return b}
  // several files at once (e.g. one CSV per table) are read one after the other
  let upQ=Promise.resolve();const uploadFiles=list=>{for(const f of [...(list||[])])upQ=upQ.then(()=>uploadFile(f));return upQ};
  async function uploadFile(file){if(!file)return;status(`جارٍ قراءة ${file.name}…`);
    try{const data=/\.(csv|tsv|txt)$/i.test(file.name)?await file.text():await file.arrayBuffer(),tables=await FM.readTableFile(file.name,data);
      if(!tables.length)throw new Error('لا يحتوي الملف على جداول ببيانات (صف عناوين ثم صفوف).');
      FMS.tables=[...FMS.tables.filter(t=>t.file!==file.name),...tables];await FM.saveTables(store(),FMS.tables);
      let n=0;FM.DOMAINS.forEach(d=>{const b=D.bindings.find(x=>x.domain===d.id);if(b&&tableOf(b.table))return;const s=FM.suggestBinding(d.id,FMS.tables);if(s){if(b)Object.assign(b,s);else D.bindings.push(s);n++}});
      recompile();renderTab();draftStats();status(`قُرئ ${file.name}: ${tables.map(t=>`${t.name} (${t.rows.length} صف)`).join('، ')}.${n?` اقتُرح ربط ${n} جدول — راجع نتيجة المطابقة ثم فعّل الربط واحفظ.`:''}`)}
    catch(e){status('تعذّرت قراءة الملف: '+(e.message||e));toast('تعذّرت قراءة جدول الربط: '+(e.message||e))}}
  // each lookup keeps the code column it was confirmed with (codeField): another layer with that column gets it on, any other off
  async function save(){const cfg={mapping:Object.fromEntries(Object.entries(D.mapping).filter(([,v])=>v!=null)),
      bindings:D.bindings.filter(b=>b.table).map(b=>({...b,codeField:D.P.cols[FM.DOMAIN[b.domain].code]?.list[0]||''}))};
    try{await FM.saveConfig(store(),FMS.layerId,FMS.keys,cfg)}catch(e){toast('تعذّر حفظ إعدادات الحقول: '+(e.message||e));return}
    FMS.cfg={mapping:{...cfg.mapping},bindings:JSON.parse(JSON.stringify(cfg.bindings))};FMS.from='layer';S.gisNoField=cfg.mapping.parcelNo||'';compileNow();
    if(typeof gisRefreshNos==='function')gisRefreshNos();fmRefreshCurrent();closeDialog();fmApplyAll();toast('حُفظت إعدادات الحقول وجداول الربط وطُبّقت على القطع.')}
  async function reset(){if(!confirm('إعادة ضبط ربط الحقول وجداول الربط لهذه الطبقة إلى التلقائي؟ (الجداول المرفوعة تبقى محفوظة)'))return;
    try{await FM.resetConfig(store(),FMS.layerId,FMS.keys)}catch(e){}FMS.cfg={mapping:{},bindings:[]};FMS.from='';S.gisNoField='';compileNow();
    if(typeof gisRefreshNos==='function')gisRefreshNos();fmRefreshCurrent();fmApplyAll();D.mapping={};D.bindings=[];recompile();renderTab();draftStats();status('أُعيد الضبط إلى الاقتراح التلقائي.')}
  function filterOptions(input){const sel=input.parentElement.querySelector('select.fm-sel'),t=input.value.trim().toLowerCase();if(!sel)return;let first=null;
    [...sel.options].forEach(o=>{const keep=!t||o.value===sel.value||o.value.startsWith('__')||o.textContent.toLowerCase().includes(t);o.hidden=!keep;if(keep&&!first&&!o.value.startsWith('__')&&t)first=o})}

  function wire(){const m=q('#fmModal');if(!m||m.dataset.wired)return;m.dataset.wired='1';
    q('#fmBtn')?.addEventListener('click',()=>fmOpenDialog('fields'));
    q('#fmClose').onclick=closeDialog;q('#fmCancel').onclick=closeDialog;q('#fmSave').onclick=save;q('#fmReset').onclick=reset;
    m.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();closeDialog()}});
    m.querySelector('.fm-tabs').addEventListener('click',e=>{const b=e.target.closest('[data-fmtab]');if(b)setTab(b.dataset.fmtab)});
    m.querySelector('.fm-tabs').addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;const tabs=[...m.querySelectorAll('[data-fmtab]')],i=tabs.findIndex(b=>b.dataset.fmtab===D.tab);
      const n=tabs[(i+(e.key==='ArrowLeft'?1:tabs.length-1))%tabs.length];setTab(n.dataset.fmtab);n.focus()});
    const body=q('#fmBody');
    body.addEventListener('input',e=>{if(e.target.classList.contains('fm-q'))filterOptions(e.target)});
    body.addEventListener('change',e=>{const el=e.target;
      if(el.id==='fmFile'){const list=[...el.files];el.value='';uploadFiles(list);return}
      if(el.classList.contains('fm-sel')){const id=el.dataset.item,v=el.value;D.mapping[id]=v==='__auto'?undefined:v==='__none'?'':v;if(D.mapping[id]===undefined)delete D.mapping[id];
        const row=el.closest('.fm-row');if(row){const tg=row.querySelector('.fm-tag');tg.textContent=D.mapping[id]!=null?'يدوي':'تلقائي';tg.className='fm-tag '+(D.mapping[id]!=null?'manual':'auto')}
        changed(D.tab==='domains');return}
      const dom=el.dataset.dom;if(!dom)return;const f=el.dataset.f,b=bindingOf(dom,f==='table');if(!b)return;
      if(f==='table'){if(!el.value){D.bindings=D.bindings.filter(x=>x!==b);changed(true);return}const s=FM.suggestBinding(dom,[tableOf(el.value)].filter(Boolean));
        Object.assign(b,{table:el.value,keyCol:s?.keyCol||'',outputs:s?.outputs||{},extra:[]});changed(true);return}
      if(f==='key')b.keyCol=el.value;else if(f==='out')b.outputs={...b.outputs,[el.dataset.it]:el.value};else if(f==='prefer')b.prefer=el.value;
      else if(f==='on')b.on=el.checked;else if(f==='xfield'||f==='xcol'){const x=b.extra?.[0]||{};x[f==='xfield'?'field':'col']=el.value;b.extra=x.field||x.col?[x]:[]}
      changed(f==='on')});
    body.addEventListener('click',e=>{const b=e.target.closest('[data-fmact]');if(!b)return;const a=b.dataset.fmact;
      if(a==='suggest'){let n=0;FM.DOMAINS.forEach(d=>{if(D.bindings.some(x=>x.domain===d.id&&tableOf(x.table)))return;const s=FM.suggestBinding(d.id,FMS.tables);if(s){D.bindings=D.bindings.filter(x=>x.domain!==d.id);D.bindings.push(s);n++}});changed(true);status(n?`اقتُرح ربط ${n} جدول (غير مفعّل): راجع المطابقة ثم فعّله.`:'لا توجد اقتراحات جديدة.')}
      else if(a==='unbind'){D.bindings=D.bindings.filter(x=>x.domain!==b.dataset.dom);changed(true)}
      else if(a==='delfile'){const f=b.dataset.file;if(!confirm(`حذف جداول «${f}» من المتصفح؟`))return;FMS.tables=FMS.tables.filter(t=>t.file!==f);FM.saveTables(store(),FMS.tables).catch(()=>{});changed(true)}})}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',wire);else wire();
  // tables saved earlier are known before any layer is loaded (the info line and the dialog)
  if(store())FM.loadAll(store(),'',[]).then(r=>{if(!FMS.tables.length)FMS.tables=r.tables||[];fmInfo()}).catch(()=>{});
})();
