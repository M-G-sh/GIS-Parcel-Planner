/* Parcel attribute fields found automatically («قراءة حقول القطعة تلقائيًا»), shared by the main planner and «مزيد».
   The same field reaches the program under different names: full names from a geodatabase or GeoJSON (DIS_ArabicName,
   SubdivisionNumber), names cut to 10 characters in a shapefile's DBF (DIS_Arabic, LANDUSE_DE, MUNICIPALI), other schemas
   (DISTRICT, PLAN_NO) and Arabic headings (اسم الحي، رقم المخطط). For each item the known names come first, in order, then
   name patterns. A code or id column (DIS_ID, DIST_CODE, LANDUSE_CO, MUN_ID) never stands in for a name, and an empty or
   <Null> value passes to the next candidate. Nothing is guessed from the values themselves.
   Usable in the browser (window.ParcelFields) and in Node (module.exports). */
(function(root){
  'use strict';
  // name key: lower case, Arabic letter forms unified (أ إ آ → ا، ة → ه، ى → ي), diacritics, tatweel, spaces and punctuation dropped
  const key=s=>String(s??'').toLowerCase().replace(/[أإآٱ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي')
    .replace(/[ً-ْـ]/g,'').replace(/[^a-z0-9؀-ۿ]/g,'');
  const empty=v=>v==null||typeof v==='object'||!String(v).trim()||/^(<null>|null)$/i.test(String(v).trim());
  // a code / id / number column of a name item (DIS_ID, DIST_CODE, LANDUSE_CO, MUN_ID, رقم البلدية)
  const CODE=/(id|code|cod|co|key|fid|no|num|number)$|^(رقم|كود|رمز)/;
  const ITEMS={
    // parcel number (رقم القطعة): PARCEL_NUM / PARCEL_NO / PLOT_NO …, never PARCEL_KEY, PARCEL_TYP, PARCEL_STA or PARENT_PAR
    parcelNo:{names:['رقم القطعة','ParcelNumber','ParcelNo','PARCEL_NUM','PARCEL_NUMB','PLOT_NO','PLOT_NUM','PLOT_NUMBER','LAND_NO'],
      re:[/^(parcel|plot|qataa|qitaa)(no|num|nbr)/,/^رقم(ال)?قطعه/]},
    // plan (subdivision) number and name (رقم / اسم المخطط): SubdivisionNumber, SubdivisionAName, PLAN_NO, PLAN_NAME …
    planNo:{names:['رقم المخطط','PlanNumber','PLAN_NO','PLAN_NUM','PLAN_NUMBE','SubdivisionNumber','SubdivisionNo','SUBDIVISION_NO','SUBDIVISION_NUM','SUBDIV_NO'],
      re:[/^(plan|subdivision|subdiv|scheme)(no|num|nbr)/,/^رقم(ال)?مخطط/]},
    planName:{names:['اسم المخطط','PlanName','PLAN_NAME','PLAN_ANAME','SubdivisionAName','SubdivisionArabicName','Subdivision Arabic Name','SubdivisionName','SUBDIVISION_NAME','SUBDIV_NAME'],
      re:[/^(plan|subdivision|subdiv|scheme)(a|ar|arabic)?name/,/^اسم(ال)?مخطط/],not:CODE},
    // district (الحي): the Arabic name first (DIS_ArabicName / DIS_Arabic), then any district name; never DIS_ID or DIST_CODE
    district:{names:['اسم الحي','الحي','District Arabic Name','DistrictArabicName','DIS_ArabicName','DIS_Arabic','DISTRICT_ANAME','DISTRICT_AR','DISTRICT_A','DISTRICT_NAME','DISTRICT','NEIGHBORHOOD','HAY','HAY_NAME'],
      re:[/^(dis|dist|distr|district)(arabic|aname|arname|ar|namear)/,/^(district|neighbo)/,/^(dis|dist)(name|nm)/,/^(اسم)?(ال)?حي$/,/^اسم(ال)?حي/],not:CODE},
    // municipality (البلدية): MUN_ArabicName / MUN_Arabic / MUNICIPALITY / MUNICIPALI …; never MUN_ID
    municipality:{names:['اسم البلدية','البلدية','Municipality Arabic Name','MunicipalityArabicName','MUN_ArabicName','MUN_Arabic','MUNICIPALITY_ANAME','MUNICIPALITY_NAME','MUNICIPALITY','MUNICIPALI','BALADIYA'],
      re:[/^(mun|muni|munic|municipal|municipality)(arabic|aname|arname|ar|namear)/,/^(municipal|munic|balad)/,/^mun(name|nm)/,/^(اسم)?(ال)?بلديه/],not:CODE},
    // parcel use (استخدام القطعة): the use description (LANDUSE_DE, LAYER_DESC …); never the code LANDUSE_CO
    parcelUse:{names:['استخدام القطعة','اسم الطبقة بالعربية','LandUse','LANDUSE_DE','LANDUSE_DESC','LAYER_DESC','PARCEL_USE','LANDUSE_DESCRIPTION','LAND_USE_DESC','LANDUSE_AR','LANDUSE_ANAME'],
      re:[/^(landuse|landusage|lnduse)(de|des|desc|description|ar|arabic|aname|arname|name)/,/^layerdesc/,/^استخدام(ال)?(قطعه|ارض)/],not:CODE},
    // land-use class text for the zoning requirements (تصنيف الاستخدام)
    zUseTxt:{names:['تصنيف الاستخدام','تصنيف استخدام الأرض','استخدام الأرض','LAND_USE','LandUseClass','UseClass','LANDUSE_DE','LANDUSE_DESC'],
      re:[/^landuse(de|des|desc|description)$/]},
    // number of floors (عدد الأدوار): FLOORSNO / FLOORS_NO / NO_FLOORS / MAX_FLOORS / NO_OF_FLOO …; never a floor height or area
    floors:{names:['أقصى عدد أدوار','الحد الأقصى لعدد الأدوار','عدد الأدوار','Floors','MAX_FLOORS','NO_FLOORS','FLOORSNO','FLOORS_NO','FLOORS_NUM','NUM_FLOORS','FLOOR_COUNT'],
      re:[/^(max|allowed)?floors(no|num|number|nbr|count|cnt)?$/,/^(max|allowed)?(no|num|number|nbr)(of)?(floors?|floo|flr)/,/^floorcount$/,/عدد(ال)?ادوار/],not:/height|heig|area|desc|ratio|rati/},
    // maximum building height (أقصى ارتفاع): MAX_HEIGHT / MaxHeight / HEIGHT_MAX …; a plain HEIGHT is read by name only
    height:{names:['أقصى ارتفاع م','الحد الأقصى للارتفاع','الارتفاع المسموح','MaxHeight','MAX_HEIGHT','HEIGHT'],
      re:[/^(max|allowed|permitted)(bld|build|building|bldg)?(height|heigh|heig|hght|hgt)/,/^(height|hght|hgt)(max|allowed)/,/^(اقصي)?(ال)?ارتفاع(المسموح|م)?$/],not:CODE}
  };
  const COMPILED=Object.fromEntries(Object.entries(ITEMS).map(([id,it])=>[id,{n:[...new Set(it.names.map(key))],re:it.re,not:it.not||null}]));
  const has=id=>Object.prototype.hasOwnProperty.call(COMPILED,id);
  // matching column names, best first: known names in their order, then the patterns in theirs
  function candidates(keys,id){const it=COMPILED[id];if(!it)return[];const nk=(keys||[]).map(k=>[k,key(k)]),out=[],seen=new Set();
    const add=k=>{if(!seen.has(k)){seen.add(k);out.push(k)}};
    it.n.forEach(n=>nk.forEach(([k,x])=>{if(x===n)add(k)}));
    it.re.forEach(re=>nk.forEach(([k,x])=>{if(x&&re.test(x)&&!(it.not&&it.not.test(x)))add(k)}));
    return out}
  // the column of a layer for an item (values not looked at), e.g. the parcel-number column
  const keyOf=(keys,id)=>candidates(keys,id)[0]||'';
  // the first candidate of one row that holds a value: {key, value} or null
  function field(row,id){if(!row||typeof row!=='object')return null;
    for(const k of candidates(Object.keys(row),id))if(!empty(row[k]))return{key:k,value:String(row[k]).trim()};return null}
  const value=(row,id)=>field(row,id)?.value||'';
  const read=(row,ids=Object.keys(ITEMS))=>Object.fromEntries(ids.map(id=>[id,value(row,id)]));
  const api={ITEMS,key,empty,has,candidates,keyOf,field,value,read};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.ParcelFields=api;
})(typeof globalThis!=='undefined'?globalThis:this);
