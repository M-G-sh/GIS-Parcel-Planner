'use strict';
/* Unit tests of parcel-fields.js (قراءة حقول القطعة تلقائيًا): the parcel's number, plan number and name, district, municipality,
   use and floors are found by their names in the municipality parcel layer after a spatial join with the plans and the
   districts (full geodatabase / GeoJSON names), in the same layer exported to a shapefile (names cut to 10 characters), in other
   schemas and under Arabic headings; code / id columns never stand in for a name and an empty value passes to the next field.
   Run: node tests/parcel_fields.js */
const assert=require('node:assert/strict'),path=require('node:path');
const PF=require(path.join(__dirname,'..','parcel-fields.js'));
let n=0;const ok=msg=>{n++;console.log('  ✓ '+msg)};

// the user's layer: parcels (DBF names) joined to the plans (Subdivision…) and the districts (DIS_ / MUN_ / CEN_ / GOV_)
const SCHEMA=['OBJECTID_1','Join_Count','TARGET_FID','OBJECTID','FILE_REF','WHO_DID','HOW_DID','WHEN_DID','COMPILE_WH','COMPILE_HO','COMPILE__1',
  'HAS_BUILDI','MARKING_TY','OWNER_OF_T','BLOCK_NO','PARCEL_NUM','PARCEL_TYP','LANDUSE_DE','LANDUSE_CO','LANDUSE_SU','PARCEL_KEY','SUBDIVISIO',
  'DIST_CODE','SECT_CODE','MARKING_ST','IS_REGISTE','IS_LICENSE','PARCEL_LOC','MARKING_RE','TRANSACTIO','LAYER','APPROVAL_D','APPROVED_B',
  'APPROVAL_1','IS_REGULAT','IS_DEDUCTE','REGISTRATI','PARENT_PAR','PLAN_LANDU','PARCEL_STA','REQNUM','IS_BUILT','REG_DATE','LIC_DATE',
  'REG_DATE_H','LIC_DATE_H','LICENSE_NO','DATASOURCE','CREATIONUS','LASTUSER','DATECREATE','FLOORSNO','CONSTRUCTI','REARDEFECT','SIDEDEFECT',
  'FROTDEFECT','BUILD_RATI','DATEMODIFI','ACCURACYST','REQUIREMEN','PARCEL_SUB','SUBDIVIS_1','SUBDIVIS_2','UPDATE_REA','AREA_M','PARCEL_CAS',
  'CASE_DESCR','PRPOPSED_S','PLANNED_PA','SURVEYED_P','AREA_DIFFR','AREA_DIFFE','LAYER_DESC','REGISTRA_1','RER','RESP_IS_NO','RESP_UPDAT',
  'SHAPE_Leng','ApprovalDate','Subdivision_ID','SubdivisionAName','Type','Description','SubdivisionNumber','ApprovalDateHijri','DIS_ID','MUN_ID',
  'CEN_ID','DIS_ArabicName','MUN_ArabicName','CEN_ArabicName','GOV_ID','GOV_ArabicName','DataSourse','Shape_Area_1','Shape_Length','Shape_Area'];
const VALUES={PARCEL_NUM:'59/14',PARCEL_KEY:'K-778812',PARCEL_TYP:'1',PARCEL_STA:'2',BLOCK_NO:'B7',SUBDIVISIO:'77',SUBDIVIS_1:'3',SUBDIVIS_2:'5',
  LANDUSE_DE:'سكني',LANDUSE_CO:'1101',LANDUSE_SU:'فلل',PLAN_LANDU:'سكني',LAYER_DESC:'سكني تجاري',FLOORSNO:2,DIST_CODE:'014',SECT_CODE:'3',
  PLANNED_PA:812.5,SURVEYED_P:808.1,REG_DATE:'2019-05-12',SubdivisionNumber:'3120/أ',SubdivisionAName:'مخطط الروضة',Subdivision_ID:9921,
  DIS_ID:44,MUN_ID:7,CEN_ID:2,GOV_ID:1,DIS_ArabicName:'حي الروضة',MUN_ArabicName:'بلدية العليا',CEN_ArabicName:'الرياض',GOV_ArabicName:'الرياض',
  Type:'سكني',Description:'معتمد',OBJECTID:5521,OBJECTID_1:12,Join_Count:1,TARGET_FID:11};
const row=Object.fromEntries(SCHEMA.map(k=>[k,k in VALUES?VALUES[k]:'']));
const WANT={parcelNo:'59/14',planNo:'3120/أ',planName:'مخطط الروضة',district:'حي الروضة',municipality:'بلدية العليا',parcelUse:'سكني',zUseTxt:'سكني',floors:'2',height:''};

assert.deepEqual(PF.read(row),WANT);
assert.deepEqual(Object.fromEntries(Object.keys(WANT).map(id=>[id,PF.field(row,id)?.key||''])),
  {parcelNo:'PARCEL_NUM',planNo:'SubdivisionNumber',planName:'SubdivisionAName',district:'DIS_ArabicName',municipality:'MUN_ArabicName',
   parcelUse:'LANDUSE_DE',zUseTxt:'LANDUSE_DE',floors:'FLOORSNO',height:''});
ok('the joined municipality layer (geodatabase / GeoJSON names): every item from its own field');

// nothing that is a code, an id or another parcel / plan column is ever a candidate
const cand=id=>PF.candidates(SCHEMA,id);
assert.deepEqual(cand('parcelNo'),['PARCEL_NUM'],'parcel number: not PARCEL_KEY / PARCEL_TYP / PARCEL_STA / PARENT_PAR / BLOCK_NO');
assert.deepEqual(cand('planNo'),['SubdivisionNumber'],'plan number: not SUBDIVISIO / Subdivision_ID / PLANNED_PA / PLAN_LANDU');
assert.deepEqual(cand('planName'),['SubdivisionAName']);
assert.deepEqual(cand('district'),['DIS_ArabicName'],'district: not DIS_ID / DIST_CODE');
assert.deepEqual(cand('municipality'),['MUN_ArabicName'],'municipality: not MUN_ID');
assert.deepEqual(cand('parcelUse'),['LANDUSE_DE','LAYER_DESC'],'use: not LANDUSE_CO / LANDUSE_SU / PLAN_LANDU');
assert.deepEqual(cand('floors'),['FLOORSNO']);
assert.deepEqual(cand('height'),[],'no height field in this schema');
ok('codes, ids and neighbouring columns (DIS_ID, DIST_CODE, LANDUSE_CO, PARCEL_KEY, SUBDIVISIO …) are never candidates');

// empty or <Null>: the next field of the same item
assert.equal(PF.value({...row,LANDUSE_DE:'<Null>'},'parcelUse'),'سكني تجاري');
assert.equal(PF.value({...row,LANDUSE_DE:'  '},'parcelUse'),'سكني تجاري');
assert.equal(PF.value({...row,DIS_ArabicName:null},'district'),'','no other district name: empty, never the code');
assert.equal(PF.value({...row,FLOORSNO:0},'floors'),'0','an explicit 0 is a value');
ok('an empty / <Null> value passes to the next field; an explicit 0 stays');

// the same layer exported to a shapefile: DBF names cut to 10 characters
const SHP={PARCEL_NUM:'59/14',LANDUSE_DE:'سكني',LANDUSE_CO:'1101',FLOORSNO:'2',DIS_ID:44,MUN_ID:7,DIS_Arabic:'حي الروضة',MUN_Arabic:'بلدية العليا',
  CEN_Arabic:'الرياض',GOV_Arabic:'الرياض',SUBDIVISIO:'77',Subdivis_3:'9921',Subdivis_4:'مخطط الروضة',Subdivis_5:'3120/أ'};
assert.deepEqual(PF.read(SHP,['parcelNo','district','municipality','parcelUse','floors','planNo','planName']),
  {parcelNo:'59/14',district:'حي الروضة',municipality:'بلدية العليا',parcelUse:'سكني',floors:'2',planNo:'',planName:''});
ok('shapefile names (DIS_Arabic, MUN_Arabic) read; the cut plan fields (Subdivis_3/4/5) are left empty, not guessed');

// other schemas and Arabic headings
assert.deepEqual(PF.read({OBJECTID:1,PARCEL_NO:'P-1',PLAN_NO:'3120/أ',DISTRICT:'حي النرجس',MUNICIPALITY:'بلدية شمال الرياض',LAND_USE:'سكني',BLOCK_NO:'B1'},
  ['parcelNo','planNo','district','municipality','parcelUse']),{parcelNo:'P-1',planNo:'3120/أ',district:'حي النرجس',municipality:'بلدية شمال الرياض',parcelUse:'سكني'});
assert.deepEqual(PF.read({'رقم_القطعه':'12','رقم المخطط':'44/س','اسم المخطط':'مخطط السلام','اسم الحى':'حي السلام','اسم البلديه':'بلدية الشفا','عدد الادوار':'3','أقصى ارتفاع م':'12'},
  ['parcelNo','planNo','planName','district','municipality','floors','height']),
  {parcelNo:'12',planNo:'44/س',planName:'مخطط السلام',district:'حي السلام',municipality:'بلدية الشفا',floors:'3',height:'12'});
assert.deepEqual(PF.read({PLOT_NO:'7',PLAN_NUMBE:'99',PLAN_NAME:'الواحة',DISTRICT_A:'حي الواحة',MUNICIPALI:'بلدية الواحة',NO_OF_FLOO:'4',HEIGHT_MAX:'16'},
  ['parcelNo','planNo','planName','district','municipality','floors','height']),
  {parcelNo:'7',planNo:'99',planName:'الواحة',district:'حي الواحة',municipality:'بلدية الواحة',floors:'4',height:'16'});
ok('other schemas (PARCEL_NO / PLAN_NO / DISTRICT …), Arabic headings with ه / ى variants, cut names (MUNICIPALI, NO_OF_FLOO)');

// look-alikes that are not the item
assert.deepEqual(PF.read({DISTRICT_ID:3,DIST_NO:'5',MUNICIPALITY_CODE:'M1','رقم البلدية':'8',FLOOR_AREA:300,FLOOR_HEIG:3.2,HEIGHT:'',PLANNED_AREA:500,PLAN_ID:'9'},
  ['district','municipality','floors','height','planNo','planName']),{district:'',municipality:'',floors:'',height:'',planNo:'',planName:''});
ok('look-alikes stay empty: DISTRICT_ID, MUNICIPALITY_CODE, رقم البلدية, FLOOR_AREA, FLOOR_HEIG, PLANNED_AREA, PLAN_ID');

// the layer's parcel-number column from its keys alone
assert.equal(PF.keyOf(SCHEMA,'parcelNo'),'PARCEL_NUM');
assert.equal(PF.keyOf(['OBJECTID','PARCEL_KEY','PARCEL_TYP','ParcelNumber'],'parcelNo'),'ParcelNumber');
assert.equal(PF.keyOf(['OBJECTID','name'],'parcelNo'),'','no number column: the caller keeps its own fallback');
ok('parcel-number column of a layer: PARCEL_NUM / ParcelNumber before PARCEL_KEY or PARCEL_TYP');

console.log(`parcel_fields: ${n} checks passed`);
