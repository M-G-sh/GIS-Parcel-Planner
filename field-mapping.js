/* GIS Field Mapping & Domain Lookup («إعدادات الحقول وجداول الربط»), shared by the main planner and «مزيد».
   · Field mapping: for every item (parcel number, plan number / name / code, district, municipality, centre, governorate,
     land use, floors, height, status …) the column of the parcel layer. A column chosen by the user always wins; otherwise the
     column is suggested by name (parcel-fields.js and the patterns below). The GIS file itself is never changed.
   · Domain lookup: tables read from Excel (.xlsx) or CSV. A lookup is used only when the user has set it: the parcel's code
     column (e.g. DIS_ID), the table, the table's key column and the column that holds the right name. Codes are matched as
     text after unifying digits (35 = "35" = "035" = "35.000" = "٣٥"); the name is never guessed from the code and a number is
     never shown as a name. A code with different names in the table is a conflict (no value) until an extra key is added.
   · Values keep their text: a plan number such as «ك ك 1/20/91» or «1/28/13/أ» is never converted to a number.
   Usable in the browser (window.FieldMapping, needs window.ParcelFields; JSZip for .xlsx) and in Node (module.exports). */
(function(root){
  'use strict';
  const PF=root.ParcelFields||(typeof require==='function'?require('./parcel-fields.js'):null);
  const key=PF.key,empty=PF.empty;
  const AR_DIG='٠١٢٣٤٥٦٧٨٩',FA_DIG='۰۱۲۳۴۵۶۷۸۹';
  const latin=s=>String(s??'').replace(/[٠-٩۰-۹]/g,d=>String(AR_DIG.includes(d)?AR_DIG.indexOf(d):FA_DIG.indexOf(d)));
  // a value as text: outer spaces and direction marks removed, nothing else changed
  const clean=v=>empty(v)?'':String(v).replace(/^[\s‎‏‪-‮ ]+|[\s‎‏‪-‮ ]+$/g,'');
  // code key: digits unified, a whole number without its leading zeros / decimals (DBF «35.000», Excel 35, «٣٥»), else normalised text
  function normCode(v){let s=clean(v);if(!s)return'';s=latin(s).replace(/\s+/g,' ');
    if(/^[-+]?\d+(\.0*)?$/.test(s))return String(parseInt(s,10));
    if(/^[-+]?\d*\.?\d+[eE][-+]?\d+$/.test(s)&&Number.isInteger(+s))return String(+s);
    return normText(s)}
  const normText=v=>latin(clean(v)).toLowerCase().replace(/[أإآٱ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[ً-ْـ]/g,'').replace(/\s+/g,' ');
  const isNumeric=v=>/^[-+]?\d+([.,]\d+)?$/.test(latin(clean(v)));
  const isZero=v=>/^0+([.,]0+)?$/.test(latin(clean(v)));
  const CODE=/(id|code|cod|co|key|fid|no|num|number)$|^(رقم|كود|رمز)/;

  /* ---------- items of the mapping ---------- */
  const G_PARCEL='القطعة والمخطط',G_ADMIN='الموقع الإداري',G_USE='الاستخدام والاشتراطات';
  // kind: name (never a number, never 0) · planNo (text, never 0) · code (lookup key) · number · text
  const ITEMS=[
    {id:'parcelNo',label:'رقم القطعة',group:G_PARCEL,kind:'text',tx:'parcelNo',pf:'parcelNo'},
    {id:'planNo',label:'رقم المخطط',group:G_PARCEL,kind:'planNo',tx:'planNo',pf:'planNo'},
    {id:'planName',label:'اسم المخطط',group:G_PARCEL,kind:'name',tx:'planName',pf:'planName'},
    {id:'planCode',label:'كود المخطط (Subdivision ID)',group:G_PARCEL,kind:'code',
      names:['كود المخطط','رمز المخطط','Subdivision ID','SubdivisionID','SUBDIVISION_ID','SUBDIV_ID','PLAN_ID','PlanID','PLAN_CODE'],re:[/^(subdivision|subdiv|plan)(id|code|cod)$/,/^(كود|رمز)(ال)?مخطط/]},
    {id:'planUse',label:'استخدام المخطط (نوع المخطط)',group:G_PARCEL,kind:'name',tx:'planUse',
      names:['استخدام المخطط','نوع المخطط','Plan Type','PlanType','PLAN_TYPE','PlanUse','PLAN_USE'],re:[]},
    {id:'districtName',label:'اسم الحي',group:G_ADMIN,kind:'name',tx:'district',pf:'district'},
    {id:'districtCode',label:'كود الحي',group:G_ADMIN,kind:'code',
      names:['كود الحي','رمز الحي','District ID','DistrictID','DIS_ID','DISTRICT_ID','DIST_ID','DISTRICT_CODE','DIST_CODE'],re:[/^(dis|dist|district)(id|code|cod)$/,/^(كود|رمز)(ال)?حي$/]},
    {id:'municipalityName',label:'اسم البلدية',group:G_ADMIN,kind:'name',tx:'municipality',pf:'municipality'},
    {id:'municipalityCode',label:'كود البلدية',group:G_ADMIN,kind:'code',
      names:['كود البلدية','رمز البلدية','Municipality ID','MunicipalityID','MUN_ID','MUNICIPALITY_ID','MUN_CODE','MUNICIPALITY_CODE'],re:[/^(mun|muni|munic|municipality)(id|code|cod)$/,/^(كود|رمز)(ال)?بلديه/]},
    {id:'centerName',label:'اسم المركز',group:G_ADMIN,kind:'name',tx:'center',
      names:['اسم المركز','المركز','Center Arabic Name','CenterArabicName','CEN_ArabicName','CEN_Arabic','CENTER_NAME','CENTER_ANAME'],re:[/^(cen|center|centre)(arabic|aname|arname|ar|namear|name)/,/^(اسم)?(ال)?مركز$/],not:CODE},
    {id:'centerCode',label:'كود المركز',group:G_ADMIN,kind:'code',
      names:['كود المركز','رمز المركز','Center ID','CenterID','CEN_ID','CENTER_ID','CEN_CODE','CENTER_CODE'],re:[/^(cen|center|centre)(id|code|cod)$/]},
    {id:'governorateName',label:'اسم المحافظة',group:G_ADMIN,kind:'name',tx:'governorate',
      names:['اسم المحافظة','المحافظة','Governorate Arabic Name','GovernorateArabicName','GOV_ArabicName','GOV_Arabic','GOVERNORATE_NAME','GOVERNORAT'],re:[/^(gov|govern|governorat|governorate)(arabic|aname|arname|ar|namear|name)/,/^(اسم)?(ال)?محافظه$/],not:CODE},
    {id:'governorateCode',label:'كود المحافظة',group:G_ADMIN,kind:'code',
      names:['كود المحافظة','رمز المحافظة','Governorate ID','GovernorateID','GOV_ID','GOVERNORATE_ID','GOV_CODE'],re:[/^(gov|governorate)(id|code|cod)$/]},
    {id:'city',label:'المدينة',group:G_ADMIN,kind:'name',tx:'city',names:['المدينة','City','CityName','City Arabic Name'],re:[]},
    {id:'amana',label:'الأمانة',group:G_ADMIN,kind:'name',tx:'amana',names:['الأمانة','الامانة','Amana','Amanah','Amana Arabic Name'],re:[]},
    {id:'landUse',label:'استخدام الأرض',group:G_USE,kind:'name',tx:'parcelUse',pf:'parcelUse'},
    {id:'landUseClass',label:'تصنيف الاستخدام',group:G_USE,kind:'name',tx:'zUseTxt',pf:'zUseTxt'},
    {id:'subUse',label:'الاستخدام الفرعي للقطعة',group:G_USE,kind:'name',tx:'subUse',names:['الاستخدام الفرعي للقطعة','الاستخدام الفرعي','SubUse','SUB_USE'],re:[]},
    {id:'floors',label:'عدد الأدوار',group:G_USE,kind:'number',tx:'floors',pf:'floors'},
    {id:'height',label:'الارتفاع المسموح م',group:G_USE,kind:'number',tx:'height',pf:'height'},
    {id:'status',label:'حالة القطعة',group:G_USE,kind:'text',tx:'status',names:['حالة القطعة','PARCEL_STATUS','ParcelStatus','status'],re:[]}
  ];
  const ITEM=Object.fromEntries(ITEMS.map(it=>[it.id,it]));
  ITEMS.forEach(it=>{if(it.names)it.n=[...new Set(it.names.map(key))]});
  // suggested columns of an item, best first (names in order, then patterns); never a column holding only codes for a name
  function autoColumns(keys,id){const it=ITEM[id];if(!it)return[];if(it.pf)return PF.candidates(keys,it.pf);
    const nk=(keys||[]).map(k=>[k,key(k)]),out=[],seen=new Set(),add=k=>{if(!seen.has(k)){seen.add(k);out.push(k)}};
    it.n.forEach(n=>nk.forEach(([k,x])=>{if(x===n)add(k)}));
    (it.re||[]).forEach(re=>nk.forEach(([k,x])=>{if(x&&re.test(x)&&!(it.not&&it.not.test(x)))add(k)}));return out}

  /* ---------- domains (lookup tables) ---------- */
  const DOMAINS=[
    {id:'district',label:'الأحياء',code:'districtCode',sheet:/district|احياء|الحي/i,
      keyCols:['District ID','DistrictID','DIS_ID','DISTRICT_ID','كود الحي','رمز الحي'],out:{districtName:['District Arabic Name','DistrictArabicName','DIS_ArabicName','District Name','DISTRICT_NAME','اسم الحي']}},
    {id:'municipality',label:'البلديات',code:'municipalityCode',sheet:/munic|بلدي/i,
      keyCols:['Municipality ID','MunicipalityID','MUN_ID','MUNICIPALITY_ID','كود البلدية','رمز البلدية'],out:{municipalityName:['Municipality Arabic Name','MunicipalityArabicName','MUN_ArabicName','Municipality Name','MUNICIPALITY_NAME','اسم البلدية']}},
    {id:'center',label:'المراكز',code:'centerCode',sheet:/cent|مراكز|مركز/i,
      keyCols:['Center ID','CenterID','CEN_ID','CENTER_ID','كود المركز','رمز المركز'],out:{centerName:['Center Arabic Name','CenterArabicName','CEN_ArabicName','Center Name','CENTER_NAME','اسم المركز']}},
    {id:'governorate',label:'المحافظات',code:'governorateCode',sheet:/govern|محافظ/i,
      keyCols:['Governorate ID','GovernorateID','GOV_ID','GOVERNORATE_ID','كود المحافظة','رمز المحافظة'],out:{governorateName:['Governorate Arabic Name','GovernorateArabicName','GOV_ArabicName','Governorate Name','GOVERNORATE_NAME','اسم المحافظة']}},
    {id:'plan',label:'المخططات',code:'planCode',sheet:/plan|subdiv|مخطط/i,
      keyCols:['Subdivision ID','SubdivisionID','Subdivision_ID','SUBDIVISION_ID','PLAN_ID','كود المخطط','رمز المخطط'],
      out:{planNo:['Subdivision Number','SubdivisionNumber','SUBDIVISION_NO','PLAN_NO','رقم المخطط'],planName:['Subdivision Arabic Name','SubdivisionAName','SubdivisionArabicName','PLAN_NAME','اسم المخطط'],
        planUse:['Plan Type','PlanType','PLAN_TYPE','نوع المخطط']}}
  ];
  const DOMAIN=Object.fromEntries(DOMAINS.map(d=>[d.id,d]));
  const findCol=(cols,names)=>{const want=names.map(key);for(const w of want){const c=cols.find(c=>key(c)===w);if(c)return c}return''};
  // the best table and columns for a domain: key and name columns by name, the sheet named after the domain and the
  // smallest table first (a «Districts» sheet before the «Plans» sheet that also lists districts). Always off until the user turns it on.
  function suggestBinding(domainId,tables){const d=DOMAIN[domainId];let best=null;
    (tables||[]).forEach(t=>{const keyCol=findCol(t.columns,d.keyCols);if(!keyCol)return;const outputs={};let n=0;
      for(const [it,names] of Object.entries(d.out)){outputs[it]=findCol(t.columns,names);if(outputs[it])n++}
      if(!n)return;const score=n*10+(d.sheet.test(t.name)?50:0)-t.columns.length;if(!best||score>best.score)best={score,b:{domain:d.id,table:t.id,keyCol,outputs,extra:[],prefer:'gis',on:false}}});
    return best?best.b:null}

  /* ---------- lookup index of one binding ---------- */
  const SEP='\u0001';
  function buildIndex(table,b){if(!table)return{ok:false,why:'الجدول غير موجود (احذف الربط أو ارفع الملف مرة أخرى)'};
    const ci=c=>c?table.columns.indexOf(c):-1,k0=ci(b.keyCol),xs=(b.extra||[]).map(x=>ci(x.col));
    const outs=Object.entries(b.outputs||{}).filter(([,c])=>ci(c)>=0).map(([it,c])=>[it,ci(c)]);
    if(k0<0)return{ok:false,why:'لم يُحدَّد عمود الكود في الجدول'};if(!outs.length)return{ok:false,why:'لم يُحدَّد عمود الاسم في الجدول'};
    if(xs.some(i=>i<0))return{ok:false,why:'عمود مفتاح الربط الإضافي غير موجود في الجدول'};
    const map=new Map();let rows=0;
    for(const r of table.rows){const k=normCode(r[k0]);if(!k)continue;const kk=[k,...xs.map(i=>normCode(r[i]))].join(SEP);
      const val={};outs.forEach(([it,i])=>{val[it]=clean(r[i])});const sig=JSON.stringify(val);let e=map.get(kk);
      if(!e){e={n:0,vals:new Map()};map.set(kk,e)}e.n++;if(!e.vals.has(sig))e.vals.set(sig,val);rows++}
    const conflicts=[],same=[];map.forEach((e,k)=>{if(e.vals.size>1)conflicts.push(k.split(SEP)[0]);else if(e.n>1)same.push(k.split(SEP)[0])});
    return{ok:true,map,rows,keys:map.size,conflicts,same}}

  /* ---------- compiled mapping of one layer: columns of every item and the lookup indexes ---------- */
  // cfg = {mapping:{item: column | '' (none) | undefined (automatic)}, bindings:[{domain,table,keyCol,outputs,extra,prefer,on}]}
  function compile(cfg,keys,tables){const mapping=cfg?.mapping||{},cols={},ks=[...new Set(keys||[])];
    for(const it of ITEMS){const m=mapping[it.id];
      cols[it.id]=m==null?{manual:false,list:autoColumns(ks,it.id)}:{manual:true,list:m&&ks.includes(m)?[m]:[],missing:m&&!ks.includes(m)?m:''}}
    const bindings=(cfg?.bindings||[]).filter(b=>DOMAIN[b.domain]).map(b=>{const t=(tables||[]).find(x=>x.id===b.table);
      return{...b,extra:(b.extra||[]).filter(x=>x&&x.field&&x.col),tableName:t?`${t.name}${t.file?' — '+t.file:''}`:'',index:buildIndex(t,{...b,extra:(b.extra||[]).filter(x=>x&&x.field&&x.col)})}});
    return{cols,bindings,keys:ks}}

  // text broken by a wrong encoding (e.g. Arabic read as UTF-16: «حلقة الفⴁ䔆 䠀✆…»): CJK, Tifinagh, Glagolitic, private use, U+FFFD
  const GARBLED=/[Ⰰ-⹿　-鿿ꀀ-꯿가-힯-�]/;
  // why a value cannot stand for an item ('' = fine)
  function rejectWhy(it,v,field){if((it.kind==='name'||it.kind==='planNo')&&GARBLED.test(v))return`نص ${it.label}${field?` في الحقل ${field}`:''} تالف الترميز ولا يمكن قراءته`;
    if(it.kind==='name'){if(isZero(v))return`القيمة «${v}» ليست ${it.label}`;if(isNumeric(v))return`القيمة «${v}»${field?` في الحقل ${field}`:''} رقم وليست ${it.label} — اختر حقل الاسم أو فعّل جدول ربط للكود`}
    if(it.kind==='planNo'&&isZero(v))return`رقم المخطط «${v}» غير صالح`;return''}
  const sameText=(a,b)=>normText(a)===normText(b);
  /* the values of one parcel: {item: {value, src: 'gis' | 'domain' | '', field, code, warn, note, undef}}
     src «gis» = the layer's own column, «domain» = looked up in a table; undef = a value was expected but none is valid
     (shown as «غير محدد» with the warning) */
  function resolveRow(row,P){const out={};
    for(const it of ITEMS){const c=P.cols[it.id],o={value:'',src:'',field:'',manual:c.manual};out[it.id]=o;
      if(c.missing){o.warn=`الحقل المختار «${c.missing}» غير موجود في هذه الطبقة`;o.undef=true}
      for(const col of c.list){const v=row?.[col];if(empty(v))continue;const s=clean(v);o.field=col;const why=rejectWhy(it,s,col);
        if(why){o.warn=why;o.undef=true;break}o.value=s;o.src='gis';delete o.warn;o.undef=false;break}
      if(!o.field&&c.list[0])o.field=c.list[0]}   // the column exists but is empty for this parcel: named in the warnings
    // a plan number taken from the plan-code column is the internal code, not the plan number
    if(out.planNo.src==='gis'&&out.planCode.field&&out.planNo.field===out.planCode.field){out.planNo={...out.planNo,value:'',src:'',undef:true,warn:`حقل رقم المخطط (${out.planNo.field}) هو نفسه حقل كود المخطط؛ الكود الداخلي ليس رقم المخطط`}}
    for(const B of P.bindings){if(!B.on)continue;const d=DOMAIN[B.domain],codeO=out[d.code],code=codeO.value,outs=Object.keys(B.outputs||{}).filter(it=>B.outputs[it]);
      let why='',val=null;
      if(!B.index.ok)why=`جدول ${d.label}: ${B.index.why}`;
      else if(!code)why=codeO.field?`لا يوجد ${ITEM[d.code].label} لهذه القطعة (الحقل ${codeO.field} فارغ)`:`لم يُحدَّد حقل ${ITEM[d.code].label} في الطبقة`;
      else{const xv=B.extra.map(x=>normCode(row?.[x.field]));
        if(xv.some(x=>!x))why=`مفتاح الربط الإضافي فارغ لهذه القطعة (${B.extra.filter((x,i)=>!xv[i]).map(x=>x.field).join('، ')})`;
        else{const e=B.index.map.get([normCode(code),...xv].join(SEP));
          if(!e)why=`الكود ${code}${xv.length?` (مع ${xv.join(' / ')})`:''} غير موجود في جدول ${B.tableName}`;
          else if(e.vals.size>1){const names=[...e.vals.values()].map(v=>Object.values(v).filter(Boolean).join(' / ')).slice(0,3).join(' | ');
            why=`تعارض: الكود ${code} له ${e.vals.size} قيم مختلفة في جدول ${B.tableName} (${names}) — أضف مفتاح ربط إضافي`;out._conflict=true}
          else val=[...e.vals.values()][0]}}
      for(const id of outs){const o=out[id],it=ITEM[id];let lv=val?val[id]:'',lwhy='';
        if(val&&!lv)lwhy=`${it.label} فارغ في جدول ${B.tableName} للكود ${code}`;else if(lv){lwhy=rejectWhy(it,lv);if(lwhy)lv=''}
        const reason=why||lwhy;
        if(B.prefer==='domain'){
          if(lv){if(o.value&&!sameText(o.value,lv))o.note=`قيمة GIS (${o.field}): ${o.value}`;Object.assign(o,{value:lv,src:'domain',code,table:B.tableName,undef:false});delete o.warn}
          else if(!o.value){o.warn=reason||o.warn;o.undef=true}
          else o.note=`جدول الربط: ${reason}`}
        else if(o.value){if(lv&&!sameText(o.value,lv))o.note=`يختلف عن جدول الربط (الكود ${code}): ${lv}`}
        else if(lv){Object.assign(o,{value:lv,src:'domain',code,table:B.tableName,undef:false});delete o.warn}
        else{o.warn=o.warn||reason;o.undef=true}}}
    return out}
  // one-line warnings of a resolved parcel, for the form and the dialog
  const warnings=R=>ITEMS.filter(it=>R[it.id]?.warn).map(it=>`${it.label}: ${R[it.id].warn}`);

  /* ---------- statistics over a layer (fed in chunks by the page) ---------- */
  function newStats(P){return{n:0,items:Object.fromEntries(ITEMS.map(it=>[it.id,{gis:0,domain:0,undef:0}])),
    bindings:Object.fromEntries(P.bindings.map(b=>[b.domain,{withCode:0,matched:0,missing:new Map(),conflict:new Map(),noCode:0}]))}}
  function addStats(st,R,row,P){st.n++;
    for(const it of ITEMS){const o=R[it.id],s=st.items[it.id];if(o.src==='gis')s.gis++;else if(o.src==='domain')s.domain++;else if(o.undef)s.undef++}
    for(const B of P.bindings){const d=DOMAIN[B.domain],s=st.bindings[B.domain];if(!s)continue;const code=R[d.code].value;if(!code){s.noCode++;continue}s.withCode++;
      if(!B.index.ok)continue;const k=[normCode(code),...B.extra.map(x=>normCode(row?.[x.field]))].join(SEP),e=B.index.map.get(k);
      if(!e)s.missing.set(code,(s.missing.get(code)||0)+1);else if(e.vals.size>1)s.conflict.set(code,(s.conflict.get(code)||0)+1);else s.matched++}
    return st}

  /* ---------- reading Excel (.xlsx) and CSV ---------- */
  const ENT={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
  const decode=s=>s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(m,e)=>e[0]==='#'?String.fromCodePoint(e[1]==='x'||e[1]==='X'?parseInt(e.slice(2),16):+e.slice(1)):ENT[e.toLowerCase()]);
  // element names may carry a namespace prefix (<x:sheet>, <x:row>, <x:c> — OpenXML SDK) or none (Excel)
  const P_='(?:\\w+:)?',tag=(src,flags='g')=>new RegExp(src.replace(/<\//g,'<\\/'+P_).replace(/<(?!\\\/)/g,'<'+P_),flags);
  const RE={si:tag('<si\\b[^>]*>([\\s\\S]*?)</si>|<si\\b[^>]*/>'),rph:tag('<rPh\\b[\\s\\S]*?</rPh>'),t:tag('<t\\b[^>]*>([\\s\\S]*?)</t>|<t\\b[^>]*/>'),
    sheet:tag('<sheet\\b([^>]*?)/?>'),row:tag('<row\\b([^>]*?)(?:/>|>([\\s\\S]*?)</row>)'),c:tag('<c\\b([^>]*?)(?:/>|>([\\s\\S]*?)</c>)'),
    v:tag('<v>([\\s\\S]*?)</v>',''),is:tag('<is>([\\s\\S]*?)</is>',''),rel:/<Relationship\b([^>]*?)\/?>/g};
  // the text of a shared / inline string: every <t> run, phonetic runs (<rPh>) left out
  const runText=x=>decode([...x.replace(RE.rph,'').matchAll(RE.t)].map(m=>m[1]||'').join(''));
  const attr=(s,name)=>{const m=s.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));return m?decode(m[1]):''};
  const colIndex=ref=>{const m=/^([A-Z]+)/.exec(ref||'');if(!m)return-1;let n=0;for(const ch of m[1])n=n*26+ch.charCodeAt(0)-64;return n-1};
  // every sheet of a workbook as rows of text cells; zip = JSZip-like (loadAsync result with file(path).async('string'))
  async function readXlsx(data,JSZipLib){const Z=JSZipLib||root.JSZip;if(!Z)throw new Error('مكتبة فك الضغط (JSZip) غير محمّلة؛ لا يمكن قراءة ملف Excel.');
    let z;try{z=await Z.loadAsync(data)}catch(e){throw new Error('الملف ليس ملف Excel صالحًا (.xlsx). احفظه بصيغة Excel Workbook أو CSV UTF-8.')}
    const txt=async p=>{const f=z.file(p)||z.file(p.replace(/^\//,''));return f?f.async('string'):null};
    const wb=await txt('xl/workbook.xml');if(!wb)throw new Error('لا يحتوي الملف على مصنف Excel (xl/workbook.xml). ملفات .xls القديمة غير مدعومة؛ احفظ الملف بصيغة .xlsx أو CSV.');
    const rels=await txt('xl/_rels/workbook.xml.rels')||'',ss=await txt('xl/sharedStrings.xml');
    const shared=ss?[...ss.matchAll(RE.si)].map(m=>runText(m[1]||'')):[];
    const target=Object.fromEntries([...rels.matchAll(RE.rel)].map(m=>[attr(m[1],'Id'),attr(m[1],'Target')]));
    const out=[];
    for(const m of wb.matchAll(RE.sheet)){const a=m[1],name=attr(a,'name'),rid=(a.match(/\s[\w]+:id="([^"]*)"/)||[])[1];let p=target[rid]||'';if(!p)continue;
      p=p.startsWith('/')?p.slice(1):p.startsWith('xl/')?p:'xl/'+p.replace(/^\.\//,'');const xml=await txt(p);if(xml==null)continue;const rows=[];
      for(const rm of xml.matchAll(RE.row)){const ri=+(attr(rm[1],'r')||rows.length+1)-1,row=[];let seq=0;
        for(const cm of (rm[2]||'').matchAll(RE.c)){const ca=cm[1],body=cm[2]||'',t=attr(ca,'t');let ci=colIndex(attr(ca,'r'));if(ci<0)ci=seq;seq=ci+1;
          const v=(body.match(RE.v)||[])[1];let val='';
          if(t==='s')val=v!=null?shared[+v]??'':'';else if(t==='inlineStr')val=runText((body.match(RE.is)||[])[1]||'');
          else if(t==='b')val=v==='1'?'TRUE':v==='0'?'FALSE':'';else if(t==='e')val='';else val=v!=null?decode(v):'';
          row[ci]=val}
        for(let i=0;i<row.length;i++)if(row[i]==null)row[i]='';rows[ri]=row}
      out.push({name,hidden:/state="(hidden|veryHidden)"/.test(a),rows:Array.from(rows,r=>r||[])})}
    return out}
  // CSV / TSV text (UTF-8, BOM allowed): separator found from the first line (, ; or tab), quoted fields with "" inside
  function parseCsv(text){let s=String(text||'');if(s.charCodeAt(0)===0xFEFF)s=s.slice(1);
    const first=s.split(/\r?\n/,1)[0]||'',count=ch=>first.split(ch).length-1,sep=[',',';','\t'].sort((a,b)=>count(b)-count(a))[0];
    const rows=[];let row=[],f='',q=false;
    for(let i=0;i<s.length;i++){const ch=s[i];
      if(q){if(ch==='"'){if(s[i+1]==='"'){f+='"';i++}else q=false}else f+=ch;continue}
      if(ch==='"'&&f==='')q=true;else if(ch===sep){row.push(f);f=''}else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&s[i+1]==='\n')i++;row.push(f);rows.push(row);row=[];f=''}else f+=ch}
    if(f!==''||row.length){row.push(f);rows.push(row)}return rows}
  // sheets → lookup tables: the first non-empty row is the header; empty rows dropped; repeated header names numbered
  function tablesFrom(sheets,file){const at=Date.now();return(sheets||[]).map(sh=>{const rows=(sh.rows||[]).map(r=>(r||[]).map(v=>v==null?'':String(v)));
      const h=rows.findIndex(r=>r.some(v=>clean(v)));if(h<0)return null;const seen=new Map();
      const columns=rows[h].map((c,i)=>{let n=clean(c)||`عمود ${i+1}`;const k=n;seen.set(k,(seen.get(k)||0)+1);if(seen.get(k)>1)n=`${k} (${seen.get(k)})`;return n});
      const data=rows.slice(h+1).filter(r=>r.some(v=>clean(v))).map(r=>columns.map((_,i)=>r[i]??''));
      return data.length?{id:`${file}#${sh.name}`,file,name:sh.name,hidden:!!sh.hidden,columns,rows:data,at}:null}).filter(Boolean)}
  async function readTableFile(name,data,JSZipLib){const lower=String(name||'').toLowerCase();
    if(/\.(csv|tsv|txt)$/.test(lower)){const text=typeof data==='string'?data:new TextDecoder('utf-8').decode(data);return tablesFrom([{name:name.replace(/\.[^.]+$/,''),rows:parseCsv(text)}],name)}
    if(/\.xlsx$|\.xlsm$/.test(lower))return tablesFrom(await readXlsx(data,JSZipLib),name);
    if(/\.xls$/.test(lower))throw new Error('ملفات Excel القديمة (.xls) غير مدعومة. احفظ الملف بصيغة .xlsx أو CSV UTF-8 ثم ارفعه.');
    throw new Error('ارفع ملف Excel (.xlsx) أو CSV.')}

  /* ---------- storage (IndexedDB through ParcelStore): tables once, the mapping of every layer apart ---------- */
  const REC_TABLES='fm-tables',hash=s=>{let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return(h>>>0).toString(36)};
  const schemaId=keys=>hash([...new Set(keys||[])].sort().join('|'));
  const recLayer=id=>`fm-config:layer:${id}`,recSchema=keys=>`fm-config:schema:${schemaId(keys)}`,REC_LAST='fm-config:last';
  // the layer's own mapping, else one saved for a layer with exactly the same columns, else the lookups saved last: each stays on
  // only when this layer has the very code column it was confirmed with (codeField, e.g. DIS_ID); otherwise it is offered off
  async function loadAll(store,layerId,keys){const s=store||root.ParcelStore;if(!s)return{tables:[],cfg:null,from:''};
    let tables=[],cfg=null,from='';try{tables=(await s.getRecord(REC_TABLES))?.tables||[]}catch(e){}
    try{if(layerId){cfg=await s.getRecord(recLayer(layerId));if(cfg)from='layer'}if(!cfg&&keys?.length){cfg=await s.getRecord(recSchema(keys));if(cfg)from='schema'}
      if(!cfg&&keys?.length){const last=await s.getRecord(REC_LAST);
        if(last?.bindings?.length){cfg={mapping:{},bindings:last.bindings.map(b=>({...b,on:!!b.on&&!!b.codeField&&keys.includes(b.codeField)}))};from='last'}}}catch(e){}
    return{tables,cfg,from}}
  async function saveConfig(store,layerId,keys,cfg){const s=store||root.ParcelStore;if(!s)throw new Error('التخزين المحلي غير متاح.');const v={...cfg,at:Date.now()};
    if(layerId)await s.putRecord(recLayer(layerId),v);if(keys?.length)await s.putRecord(recSchema(keys),v);
    if(v.bindings?.length)await s.putRecord(REC_LAST,{bindings:v.bindings,at:v.at});return v}
  async function resetConfig(store,layerId,keys){const s=store||root.ParcelStore;if(!s)return;if(layerId)await s.deleteRecord(recLayer(layerId));if(keys?.length)await s.deleteRecord(recSchema(keys))}
  async function saveTables(store,tables){const s=store||root.ParcelStore;if(!s)throw new Error('التخزين المحلي غير متاح.');await s.putRecord(REC_TABLES,{tables,at:Date.now()});return tables}

  const api={ITEMS,ITEM,DOMAINS,DOMAIN,GROUPS:[G_PARCEL,G_ADMIN,G_USE],clean,normCode,normText,isNumeric,autoColumns,suggestBinding,buildIndex,compile,resolveRow,warnings,
    newStats,addStats,readXlsx,parseCsv,tablesFrom,readTableFile,schemaId,loadAll,saveConfig,resetConfig,saveTables,REC_TABLES};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.FieldMapping=api;
})(typeof globalThis!=='undefined'?globalThis:this);
