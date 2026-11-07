'use strict';
/* Main-planner bridge with parcel layers: stable-id matching, part-prefixed edge keys, face → edge role, blocked storage.
   Run: node tests/bridge_layer.js */
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const src=fs.readFileSync(__dirname+'/../street-bridge.js','utf8');
const verts=()=>[{x:0,y:0,sb:0,role:'side',name:''},{x:30,y:0,sb:0,role:'side',name:''},{x:30,y:35,sb:0,role:'side',name:''},{x:0,y:35,sb:0,role:'side',name:''}];
const geo={L:[{x:0,y:0},{x:30,y:0},{x:30,y:35},{x:0,y:35}],F:{toLL:p=>({lat:21.45+p.y/110000,lon:39.8+p.x/104000})}};
const geoKey=i=>{const k=p=>{const q=geo.F.toLL(p);return q.lon.toFixed(7)+','+q.lat.toFixed(7)};return k(geo.L[i])+'>'+k(geo.L[(i+1)%4])};
function ctx({search='',stored={},answers=[],current={stableId:'parcel:7:abc',parcelSignature:'sig-7',attrs:{PARCEL_NO:'P-7'}},storage=true}={}){
  const handlers={},m=new Map(Object.entries(stored)),prompts=[],alerts=[],S={verts:verts(),tx:{street:'',streetEdge:'',streetW:''}};let snapshot=0;
  const c={S,console,URL,URLSearchParams,setTimeout,document:{getElementById:id=>id==='moreStreetTools'?{addEventListener:(n,fn)=>{handlers[n]=fn}}:null},
    sessionStorage:{getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)},
    location:{search,href:'http://localhost/GIS_Parcel_Planner_Final/index.html'+search},history:{replaceState(){}},
    confirm:msg=>{prompts.push(msg);return answers.length?answers.shift():true},alert:msg=>alerts.push(msg),toast(){},
    buildGeo:()=>geo,CUR_PC:current,persist(){},syncInputs(){},renderVerts(){},schedule(){},saveMainParcelSnapshot:async()=>{snapshot++}};
  if(storage)c.localStorage={getItem:k=>({gis_planner_parcel_layer_id_v1:'layer-1',gis_planner_road_layer_id_v1:'roads-1'})[k]||null};
  else Object.defineProperty(c,'localStorage',{get(){throw new Error('SecurityError: storage blocked')}});
  vm.createContext(c);vm.runInContext(src,c);return{c,S,handlers,m,prompts,alerts,snapshots:()=>snapshot}}
const settle=()=>new Promise(r=>setImmediate(r));
(async()=>{
  // export carries the layer ids and the stable parcel id; blocked storage does not stop the transfer
  let z=ctx();z.handlers.click();let p=JSON.parse(z.m.get('gis_planner_street_input_v1')).payload;
  assert.equal(p.layerId,'layer-1');assert.equal(p.roadLayerId,'roads-1');assert.equal(p.parcelId,'parcel:7:abc');assert.equal(p.parcelSignature,'sig-7');
  z=ctx({storage:false});z.handlers.click();p=JSON.parse(z.m.get('gis_planner_street_input_v1')).payload;assert.equal(p.layerId,'');assert.match(z.c.location.href,/street-tools\.html\?parcel=/);

  // return: matched by stable id; part-prefixed lon/lat keys resolve to the planner's ring; faces become edge roles
  const data={parcelId:'parcel:7:abc',parcelSignature:'other',entries:[
    {key:'part:0:'+geoKey(0),street:'شارع الملك فهد',width:15,setback:3,face:'front',apply:true},
    {key:'part:0:'+geoKey(2),street:'شارع خلفي',width:12,setback:2,face:'rear',apply:true},
    {key:'part:1:'+geoKey(1),street:'جزء آخر',width:10,face:'side',apply:false}]};
  z=ctx({search:'?streetResult=t1',stored:{gis_planner_street_output_v1:JSON.stringify({token:'t1',data})}});await settle();
  assert.equal(z.alerts.length,0,z.alerts.join());assert.equal(z.S.verts[0].name,'شارع الملك فهد');assert.equal(z.S.verts[0].role,'front');assert.equal(z.S.verts[0].sb,3);
  assert.equal(z.S.verts[2].name,'شارع خلفي');assert.equal(z.S.verts[2].role,'rear');assert.equal(z.S.verts[2].streetW,12);
  assert.deepEqual(JSON.parse(JSON.stringify(z.S.verts[1])),verts()[1],'not-applied edge untouched');assert.equal(z.S.tx.street,'شارع الملك فهد');assert.equal(z.S.tx.streetEdge,'0');
  assert.equal(z.snapshots(),1,'per-parcel snapshot saved after applying');assert.ok(!z.m.has('gis_planner_street_output_v1'),'result consumed once');

  // results for another parcel of the layer are refused, whatever the geometry signature says
  z=ctx({search:'?streetResult=t2',stored:{gis_planner_street_output_v1:JSON.stringify({token:'t2',data:{...data,parcelId:'parcel:8:def',parcelSignature:'sig-7'}})}});await settle();
  assert.equal(z.alerts.length,1);assert.equal(z.S.verts[0].name,'');assert.equal(z.prompts.length,0);
  console.log('Bridge with parcel layers: stable ids, part-prefixed keys, face roles, blocked storage and wrong-parcel refusal passed');
})().catch(e=>{console.error(e);process.exit(1)});
