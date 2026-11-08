'use strict';
/* Unit tests of field-mapping.js («إعدادات الحقول وجداول الربط»): the user's lookup workbook (data/GIS_Parcel_Planner_Domain_Lookups.xlsx,
   read with the module's own reader when the file and jszip are present, else the same rows as CSV), parcel layers with full,
   cut (shapefile), Arabic and English column names, Null / empty values, district / municipality / plan codes, a code that differs
   from its name, repeated codes (same values = not a conflict; different values = conflict until an extra key), plan numbers kept
   as text, manual columns over automatic ones, saving / restoring per layer, and thousands of parcels.
   Run: node tests/field_mapping.js   (NODE_PATH with jszip for the .xlsx part) */
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const FM=require(path.join(__dirname,'..','field-mapping.js'));
let n=0;const ok=msg=>{n++;console.log('  ✓ '+msg)};
const XLSX_FILE=path.join(__dirname,'..','data','GIS_Parcel_Planner_Domain_Lookups.xlsx');
let JSZip=null;try{JSZip=require('jszip')}catch(e){}

// the rows of the workbook used below, as CSV (the fallback when the workbook or jszip is missing)
const CSV={
  Plans:'Subdivision ID,Subdivision Number,Subdivision Arabic Name,District ID,District Arabic Name,Municipality ID,Municipality Arabic Name,Center ID,Center Arabic Name,Governorate ID,Governorate Arabic Name,Plan Type\n'+
    '836,ك ك 1/20/91,جوهرة العسيلة رقم 2,0,خارج نطاق الاحياء,9,الشرائع,12,مكة المكرمة,1,محافظة مكة,مخطط سكنى\n'+
    '563,1/28/13/أ,مخطط البوابة رقم (1) ( حي التخصصي تعديل مخطط ),72,حي ام الجود,13,الحديبية,12,مكة المكرمة,1,محافظة مكة,مخطط سكنى\n'+
    '1504,12/1435هـ المعدل,المخطط التنظيمي لتوسعة المنطقة الصناعية بجنوب مكة,0,خارج نطاق الاحياء,18,x,12,مكة المكرمة,1,محافظة مكة,صناعي\n'.repeat(3)+
    '262,,"حلقة الفⴁ䔆 䠀✆䐆ⴆ",0,خارج نطاق الاحياء,9,الشرائع,12,مكة المكرمة,1,محافظة مكة,0\n'+
    '524,"المعدل 1/7/119/ز/س ",مخطط المعدل,0,خارج نطاق الاحياء,9,الشرائع,12,مكة المكرمة,1,محافظة مكة,مخطط سكنى\n'+
    '900,0,مخطط برقم صفري,0,خارج نطاق الاحياء,9,الشرائع,12,مكة المكرمة,1,محافظة مكة,مخطط سكنى\n',
  Districts:'District ID,District Arabic Name\n0,خارج نطاق الاحياء\n35,حي الصفوة\n72,حي ام الجود\n',
  Municipalities:'Municipality ID,Municipality Arabic Name\n6,العزيزية\n9,الشرائع\n13,الحديبية\n',
  Centers:'Center ID,Center Arabic Name\n12,مكة المكرمة\n6,جعرانة\n',
  Governorates:'Governorate ID,Governorate Arabic Name\n1,محافظة مكة\n2,محافظة الجموم\n'};

(async()=>{
  // ---------- 1 · the lookup workbook ----------
  let tables,real=false;
  if(JSZip&&fs.existsSync(XLSX_FILE)){tables=await FM.readTableFile('GIS_Parcel_Planner_Domain_Lookups.xlsx',fs.readFileSync(XLSX_FILE),JSZip);real=true;
    assert.deepEqual(tables.map(t=>t.name),['Plans','Districts','Municipalities','Centers','Governorates','Read Me']);
    assert.deepEqual(tables.map(t=>t.rows.length),[533,86,13,6,2,9],'data rows of every sheet (header excluded)');
    assert.deepEqual(tables[0].columns,['Subdivision ID','Subdivision Number','Subdivision Arabic Name','District ID','District Arabic Name','Municipality ID','Municipality Arabic Name','Center ID','Center Arabic Name','Governorate ID','Governorate Arabic Name','Plan Type']);
    ok('real workbook read by the module (no external library in the page): 6 sheets, 533 plans, 86 districts, 13 municipalities, 6 centres, 2 governorates')}
  else{tables=Object.entries(CSV).flatMap(([name,text])=>FM.tablesFrom([{name,rows:FM.parseCsv(text)}],'lookups.csv'));
    console.log(`  · ${fs.existsSync(XLSX_FILE)?'jszip not found (NODE_PATH)':'data/GIS_Parcel_Planner_Domain_Lookups.xlsx not found'}: the workbook rows are taken from CSV`)}
  const T=name=>tables.find(t=>t.name===name),D=T('Districts'),M=T('Municipalities'),P=T('Plans');
  const row=(t,col,v)=>t.rows.find(r=>FM.normCode(r[t.columns.indexOf(col)])===FM.normCode(v));
  assert.equal(row(D,'District ID',35)[1],'حي الصفوة');assert.equal(row(M,'Municipality ID',6)[1],'العزيزية');
  assert.equal(row(P,'Subdivision ID',836)[1],'ك ك 1/20/91');assert.equal(row(P,'Subdivision ID',563)[1],'1/28/13/أ');
  ok('District 35 = حي الصفوة · Municipality 6 = العزيزية · Subdivision ID 836 → number «ك ك 1/20/91» (text kept as is)');

  // suggestions: the dedicated sheet of each domain, off until the user turns it on
  const sug=Object.fromEntries(FM.DOMAINS.map(d=>[d.id,FM.suggestBinding(d.id,tables)]));
  assert.deepEqual(Object.fromEntries(Object.entries(sug).map(([k,b])=>[k,b&&tables.find(t=>t.id===b.table).name])),{district:'Districts',municipality:'Municipalities',center:'Centers',governorate:'Governorates',plan:'Plans'});
  assert.deepEqual(sug.plan.outputs,{planNo:'Subdivision Number',planName:'Subdivision Arabic Name',planUse:'Plan Type'});assert.equal(sug.plan.keyCol,'Subdivision ID');
  assert.ok(Object.values(sug).every(b=>b.on===false),'never on by itself');
  const ix=FM.buildIndex(P,sug.plan);assert.ok(ix.ok);assert.deepEqual(ix.conflicts,[],'1504 repeated with the same values: not a conflict');assert.ok(ix.same.includes('1504'));
  ok('suggested tables: Districts / Municipalities / Centers / Governorates / Plans (key + name columns), all off; 1504 ×3 same values ≠ conflict');

  // ---------- 2 · a parcel layer (full names, as GeoJSON from the geodatabase) ----------
  const keysFull=['OBJECTID','PARCEL_NUM','PARCEL_KEY','LANDUSE_DE','LANDUSE_CO','FLOORSNO','DIST_CODE','Subdivision_ID','SubdivisionNumber','SubdivisionAName','DIS_ID','MUN_ID','CEN_ID','GOV_ID','DIS_ArabicName','MUN_ArabicName','CEN_ArabicName','GOV_ArabicName','REG_DATE'];
  const cfgOn={mapping:{},bindings:Object.values(sug).map(b=>({...b,on:true}))};
  let C=FM.compile(cfgOn,keysFull,tables);
  const col=id=>C.cols[id].list[0]||'';
  assert.deepEqual(Object.fromEntries(['parcelNo','planNo','planName','planCode','districtName','districtCode','municipalityName','municipalityCode','centerName','centerCode','governorateName','governorateCode','landUse','floors'].map(id=>[id,col(id)])),
    {parcelNo:'PARCEL_NUM',planNo:'SubdivisionNumber',planName:'SubdivisionAName',planCode:'Subdivision_ID',districtName:'DIS_ArabicName',districtCode:'DIS_ID',municipalityName:'MUN_ArabicName',municipalityCode:'MUN_ID',
     centerName:'CEN_ArabicName',centerCode:'CEN_ID',governorateName:'GOV_ArabicName',governorateCode:'GOV_ID',landUse:'LANDUSE_DE',floors:'FLOORSNO'});
  ok('automatic columns of the joined layer: Subdivision_ID = plan code, SubdivisionNumber = plan number, SubdivisionAName = name; DIS_/MUN_/CEN_/GOV_ ID = codes');

  // codes only (names empty / <Null>): names come from the tables; plan number and name from the plan code
  let R=FM.resolveRow({PARCEL_NUM:'59/14',Subdivision_ID:836,SubdivisionNumber:'<Null>',SubdivisionAName:'',DIS_ID:'35',MUN_ID:'6.000',CEN_ID:'١٢',GOV_ID:1,DIS_ArabicName:null,MUN_ArabicName:' ',LANDUSE_DE:'سكني',FLOORSNO:'2'},C);
  const pick=(R,ids)=>Object.fromEntries(ids.map(id=>[id,[R[id].value,R[id].src]]));
  assert.deepEqual(pick(R,['planNo','planName','planUse','districtName','municipalityName','centerName','governorateName','landUse']),
    {planNo:['ك ك 1/20/91','domain'],planName:['جوهرة العسيلة رقم 2','domain'],planUse:['مخطط سكنى','domain'],districtName:['حي الصفوة','domain'],municipalityName:['العزيزية','domain'],
     centerName:['مكة المكرمة','domain'],governorateName:['محافظة مكة','domain'],landUse:['سكني','gis']});
  assert.equal(R.districtName.code,'35');assert.equal(R.planCode.value,'836');assert.notEqual(R.planNo.value,R.planCode.value,'the plan number is not the internal code');
  ok('codes → names (35 → حي الصفوة, "6.000" → العزيزية, «١٢» → مكة المكرمة); 836 → «ك ك 1/20/91» / جوهرة العسيلة رقم 2; <Null>, empty and spaces read as missing');

  // a binding that is off is never used; a code missing from the table and a number in a name field are «غير محدد», never the code
  C=FM.compile({mapping:{},bindings:[{...sug.district,on:false}]},keysFull,tables);R=FM.resolveRow({DIS_ID:35},C);
  assert.equal(R.districtName.value,'');assert.ok(!R.districtName.undef,'off: nothing expected');
  C=FM.compile(cfgOn,keysFull,tables);R=FM.resolveRow({DIS_ID:999,MUN_ID:6,Subdivision_ID:77777},C);
  assert.equal(R.districtName.value,'');assert.ok(R.districtName.undef);assert.match(R.districtName.warn,/الكود 999 غير موجود في جدول Districts/);
  assert.equal(R.planNo.value,'');assert.match(R.planNo.warn,/77777 غير موجود/);
  C=FM.compile({mapping:{districtName:'DIS_ID'},bindings:[]},keysFull,tables);R=FM.resolveRow({DIS_ID:35},C);
  assert.equal(R.districtName.value,'');assert.ok(R.districtName.undef);assert.match(R.districtName.warn,/«35».*رقم وليست اسم الحي/);
  C=FM.compile({mapping:{planNo:'Subdivision_ID'},bindings:[]},keysFull,tables);R=FM.resolveRow({Subdivision_ID:836},C);
  assert.equal(R.planNo.value,'');assert.match(R.planNo.warn,/الكود الداخلي ليس رقم المخطط/);
  ok('lookup off = not used; code 999 / plan 77777 missing → «غير محدد» with the reason; DIS_ID chosen as a name or Subdivision_ID as the plan number → refused');

  // values of the table that are not names: «0» plan number, a garbled name, outer spaces
  C=FM.compile(cfgOn,keysFull,tables);
  // a plan whose number in the table is «0» (7 such plans in the workbook)
  const zero=P.rows.find(r=>FM.clean(r[1])==='0'&&FM.clean(r[2])&&!/[Ⰰ-鿿]/.test(r[2]));
  R=FM.resolveRow({Subdivision_ID:zero[0]},C);assert.equal(R.planNo.value,'');assert.match(R.planNo.warn,/«0» غير صالح/);assert.equal(R.planName.value,FM.clean(zero[2]),'its name is still read');
  R=FM.resolveRow({Subdivision_ID:262},C);assert.equal(R.planName.value,'');assert.match(R.planName.warn,/تالف الترميز/);assert.match(R.planNo.warn,/فارغ في جدول/);
  R=FM.resolveRow({Subdivision_ID:524},C);assert.equal(R.planNo.value,'المعدل 1/7/119/ز/س','outer spaces trimmed, nothing else changed');
  R=FM.resolveRow({Subdivision_ID:1504},C);assert.equal(R.planNo.value,'12/1435هـ المعدل');
  ok('table values: plan number «0» refused, garbled name of plan 262 refused (not shown), «المعدل 1/7/119/ز/س » trimmed only, 1504 resolved');

  // GIS name first (default) with a note when the table differs; «جدول الربط أولًا» the other way
  R=FM.resolveRow({DIS_ID:35,DIS_ArabicName:'حي الروضة'},C);assert.deepEqual([R.districtName.value,R.districtName.src],['حي الروضة','gis']);assert.match(R.districtName.note,/حي الصفوة/);
  C=FM.compile({mapping:{},bindings:[{...sug.district,on:true,prefer:'domain'}]},keysFull,tables);R=FM.resolveRow({DIS_ID:35,DIS_ArabicName:'حي الروضة'},C);
  assert.deepEqual([R.districtName.value,R.districtName.src],['حي الصفوة','domain']);assert.match(R.districtName.note,/حي الروضة/);
  ok('priority: GIS name first (difference noted), or the table first when chosen');

  // ---------- 3 · repeated codes with different names: conflict until an extra key ----------
  const dup=FM.tablesFrom([{name:'DistrictsByMun',rows:FM.parseCsv('District ID;Municipality ID;District Arabic Name\n7;3;حي أ\n7;9;حي ب\n8;3;حي ج\n')}],'dup.csv')[0];
  const bD={domain:'district',table:dup.id,keyCol:'District ID',outputs:{districtName:'District Arabic Name'},extra:[],prefer:'gis',on:true};
  C=FM.compile({mapping:{},bindings:[bD]},['DIS_ID','MUN_ID'],[dup]);assert.deepEqual(C.bindings[0].index.conflicts,['7']);
  R=FM.resolveRow({DIS_ID:7,MUN_ID:9},C);assert.equal(R.districtName.value,'');assert.match(R.districtName.warn,/تعارض: الكود 7 له 2 قيم مختلفة/);
  assert.equal(FM.resolveRow({DIS_ID:8,MUN_ID:3},C).districtName.value,'حي ج');
  C=FM.compile({mapping:{},bindings:[{...bD,extra:[{field:'MUN_ID',col:'Municipality ID'}]}]},['DIS_ID','MUN_ID'],[dup]);
  assert.deepEqual(C.bindings[0].index.conflicts,[]);assert.equal(FM.resolveRow({DIS_ID:7,MUN_ID:9},C).districtName.value,'حي ب');assert.equal(FM.resolveRow({DIS_ID:7,MUN_ID:3},C).districtName.value,'حي أ');
  assert.match(FM.resolveRow({DIS_ID:7,MUN_ID:''},C).districtName.warn,/مفتاح الربط الإضافي فارغ/);
  ok('code 7 with two names → conflict, no value; extra key MUN_ID ↔ Municipality ID → حي أ / حي ب; empty extra key reported');

  // ---------- 4 · other layers: shapefile names, Arabic and English headings, manual columns ----------
  const shp=['PARCEL_NUM','DIS_ID','MUN_ID','DIS_Arabic','MUN_Arabic','Subdivis_3','Subdivis_4','Subdivis_5','SUBDIVISIO','FLOORSNO'];
  C=FM.compile(cfgOn,shp,tables);assert.equal(col('planCode'),'');assert.equal(col('districtCode'),'DIS_ID');assert.equal(col('districtName'),'DIS_Arabic');
  R=FM.resolveRow({PARCEL_NUM:'1',DIS_ID:'72',MUN_ID:'13',DIS_Arabic:'',Subdivis_3:'836',SUBDIVISIO:'77'},C);
  assert.deepEqual([R.districtName.value,R.districtName.src,R.municipalityName.value,R.planNo.value],['حي ام الجود','domain','الحديبية','']);
  assert.match(R.planNo.warn,/لم يُحدَّد حقل كود المخطط/,'the cut plan columns are not guessed');
  C=FM.compile({...cfgOn,mapping:{planCode:'Subdivis_3'}},shp,tables);R=FM.resolveRow({Subdivis_3:'836'},C);assert.equal(R.planNo.value,'ك ك 1/20/91','after choosing the column by hand');
  ok('shapefile layer: DIS_Arabic / DIS_ID found; cut plan columns (Subdivis_3 …) left alone until chosen by hand, then 836 → ك ك 1/20/91');
  const ar=['رقم القطعة','كود الحي','رمز البلدية','كود المخطط','اسم المركز'],en=['Parcel Number','District ID','Municipality ID','Subdivision ID','Center Arabic Name'];
  C=FM.compile(cfgOn,ar,tables);assert.deepEqual(['parcelNo','districtCode','municipalityCode','planCode','centerName'].map(col),ar);
  R=FM.resolveRow({'رقم القطعة':'٣/١٢','كود الحي':'٣٥','رمز البلدية':'٠٠٦','كود المخطط':'563','اسم المركز':'مكة المكرمة'},C);
  assert.deepEqual([R.parcelNo.value,R.districtName.value,R.municipalityName.value,R.planNo.value,R.centerName.src],['٣/١٢','حي الصفوة','العزيزية','1/28/13/أ','gis']);
  C=FM.compile(cfgOn,en,tables);assert.deepEqual(['parcelNo','districtCode','municipalityCode','planCode','centerName'].map(col),en);
  ok('Arabic headings (كود الحي، رمز البلدية «٠٠٦») and English headings (District ID, Subdivision ID): same results; «٣/١٢» kept as written');
  C=FM.compile({mapping:{landUse:'LANDUSE_CO',floors:'',parcelNo:'NOPE'},bindings:[]},keysFull,tables);R=FM.resolveRow({LANDUSE_DE:'سكني',LANDUSE_CO:'1101',FLOORSNO:'3',PARCEL_NUM:'5'},C);
  assert.deepEqual([R.landUse.value,R.landUse.manual,R.floors.value,R.parcelNo.value],['','1101'==='x'?'':true,'','']);
  assert.match(R.landUse.warn,/رقم وليست استخدام الأرض/);assert.match(R.parcelNo.warn,/«NOPE» غير موجود/);
  C=FM.compile({mapping:{landUse:'LAYER_DESC'},bindings:[]},[...keysFull,'LAYER_DESC'],tables);assert.equal(FM.resolveRow({LANDUSE_DE:'سكني',LAYER_DESC:'تجاري'},C).landUse.value,'تجاري');
  ok('a column chosen by hand wins (LAYER_DESC over LANDUSE_DE); «بلا حقل» reads nothing; a chosen column missing from the layer is reported');

  // ---------- 5 · plan numbers as text ----------
  C=FM.compile({mapping:{},bindings:[]},['SubdivisionNumber'],[]);
  for(const v of ['ك ك 1/20/91','1/28/13/أ','007/1','٠١٢/٣','2134','12-5 ب'])assert.equal(FM.resolveRow({SubdivisionNumber:v},C).planNo.value,v);
  assert.equal(FM.resolveRow({SubdivisionNumber:'0'},C).planNo.value,'');
  assert.deepEqual(['35',35,'035','35.000','٣٥',' 35 ','3.5E1'].map(FM.normCode),Array(7).fill('35'));
  ok('plan numbers kept exactly (leading zeros, Arabic digits, «/», «-»); codes 35 = "035" = "35.000" = «٣٥» = 3.5E1');

  // ---------- 6 · CSV reader, storage per layer, statistics, thousands of parcels ----------
  const csv=FM.parseCsv('﻿"District ID";"District Arabic Name"\r\n"35";"حي ""الصفوة"""\r\n36;حي; آخر\n');assert.deepEqual(csv,[['District ID','District Arabic Name'],['35','حي "الصفوة"'],['36','حي',' آخر']]);
  ok('CSV: BOM, «;» separator, quotes and "" inside a value, CRLF');
  const mem=new Map(),store={getRecord:async k=>mem.get(k)??null,putRecord:async(k,v)=>{mem.set(k,JSON.parse(JSON.stringify(v)))},deleteRecord:async k=>{mem.delete(k)}};
  await FM.saveTables(store,tables);await FM.saveConfig(store,'L1',keysFull,cfgOn);
  let got=await FM.loadAll(store,'L1',keysFull);assert.equal(got.from,'layer');assert.equal(got.tables.length,tables.length);assert.equal(got.cfg.bindings.length,5);
  got=await FM.loadAll(store,'L2',[...keysFull].reverse());assert.equal(got.from,'schema','another layer with the same columns');
  got=await FM.loadAll(store,'L3',['A','B']);assert.equal(got.from,'last');assert.deepEqual(got.cfg.mapping,{},'columns of another layer are not carried');
  assert.ok(got.cfg.bindings.every(b=>!b.on),'lookups saved without their code column: offered off');
  // a lookup confirmed with its code column stays on in another layer having that column, and is offered off otherwise
  await FM.saveConfig(store,'L1',keysFull,{mapping:{},bindings:[{...sug.district,on:true,codeField:'DIS_ID'},{...sug.plan,on:true,codeField:'Subdivision_ID'}]});
  got=await FM.loadAll(store,'SHP',['PARCEL_NUM','DIS_ID','Subdivis_3']);assert.deepEqual(got.cfg.bindings.map(b=>[b.domain,b.on]),[['district',true],['plan',false]]);
  await FM.resetConfig(store,'L1',keysFull);assert.equal((await FM.loadAll(store,'L1',keysFull)).from,'last','reset: the layer falls back to the last lookups (offered by code column)');
  ok('saved per layer (and for a layer with exactly the same columns), restored, reset; another layer gets the last lookups only where its code column is the same (DIS_ID on, Subdivision_ID absent → off)');
  C=FM.compile(cfgOn,keysFull,tables);const codes=[35,72,0,999],rows=Array.from({length:5000},(_,i)=>({PARCEL_NUM:`P-${i}`,DIS_ID:codes[i%4],MUN_ID:i%2?6:13,Subdivision_ID:i%5?836:'',LANDUSE_DE:i%7?'سكني':'<Null>'}));
  const t0=process.hrtime.bigint(),st=FM.newStats(C);rows.forEach(r=>FM.addStats(st,FM.resolveRow(r,C),r,C));const ms=Number(process.hrtime.bigint()-t0)/1e6;
  assert.equal(st.n,5000);assert.equal(st.bindings.district.matched,3750);assert.deepEqual([...st.bindings.district.missing],[['999',1250]]);assert.equal(st.bindings.plan.noCode,1000);
  assert.equal(st.items.districtName.domain,3750);assert.equal(st.items.districtName.undef,1250);assert.equal(st.items.landUse.gis,rows.filter((_,i)=>i%7).length);
  ok(`5000 parcels resolved in ${ms.toFixed(0)} ms: district matched 3750, code 999 missing ×1250, 1000 without plan code`);
  console.log(`field_mapping: ${n} checks passed${real?' (real workbook)':' (CSV rows of the workbook)'}`);
})().catch(e=>{console.error(e);process.exit(1)});
