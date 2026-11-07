/* GIS Parcel Planner | Street Tools. No external API or automated regulatory approval. */
(function(){
'use strict';
const G=window.StreetGeometry;
const $=id=>document.getElementById(id);
const KEY_IN='gis_planner_street_input_v1',KEY_OUT='gis_planner_street_output_v1',KEY_STORE='gis_planner_street_store_v1',KEY_SET='gis_planner_street_settings_v1';
const KEY_PARCEL_LAYER='gis_planner_parcel_layer_id_v1',KEY_ROAD_LAYER='gis_planner_road_layer_id_v1';
const state={parcels:[],selected:0,roads:[],roadIndex:null,matches:[],signature:'',parcelSignature:'',edgeData:[],parcelLayerId:'',roadLayerId:'',parcelSpatial:null,selection:-1,frame:null,center:null,scale:null,mode:'vector',view:null,map:null,layers:null,mLayer:null,mParts:null,isDemo:false,
  measure:{active:false,mode:'',edge:-1,a:null,b:null,hover:null,override:null,share:null}};
const FACE={front:'أمامي',side:'جانبي',rear:'خلفي'},STORE_PREFIX='street-result:';
const SRC_W={measured:'مقاس من الخريطة',manual:'مدخل يدويًا',gis:'من بيانات GIS'},SRC_SB={custom:'محسوب بالقاعدة',fixed:'ارتداد ثابت',manual:'مدخل يدويًا',previous:'من المخطط الرئيسي'};
const fmt=(n,d=1)=>Number.isFinite(n)?Number(n).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:d}):'—';
const nval=id=>{const n=Number($(id).value);return Number.isFinite(n)?n:null};
const esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
let timer=0;function toast(message){const t=$('toast');t.textContent=message;t.hidden=false;clearTimeout(timer);timer=setTimeout(()=>t.hidden=true,4000)}
function note(id,text,good=false,bad=false){const e=$(id);e.textContent=text;e.className='load-note'+(good?' status-ok':'')+(bad?' status-bad':'')}
function readPayload(){const token=new URLSearchParams(location.search).get('parcel');if(!token)return null;try{const v=JSON.parse(sessionStorage.getItem(KEY_IN)||'null');return v?.token===token?v.payload:null}catch(e){return null}}
function currentParcel(){return state.parcels[state.selected]||null}
function parcelCoordinates(){return currentParcel()?.polygon||null}
function parcelSignature(polygon){return Array.isArray(polygon)?polygon.map(p=>Number(p[0]).toFixed(7)+','+Number(p[1]).toFixed(7)).join('|'):''}
function parcelParts(parcel=currentParcel()){if(!parcel)return[];return parcel.parts?.length?parcel.parts:[{outer:parcel.polygon||[],holes:[]}]}
function isMulti(parcel=currentParcel()){return G.isMultiParts(parcelParts(parcel))}
// Edge numbering of the table and the maps: the outer ring of every part, then every hole.
function edgeRings(parcel=currentParcel()){const parts=parcelParts(parcel),out=[];parts.forEach((p,k)=>out.push({part:k,ring:0,pts:p.outer||[]}));
  parts.forEach((p,k)=>(p.holes||[]).forEach((h,j)=>out.push({part:k,ring:j+1,pts:h})));return out}
// Edge numbers shown to the user: for a multipart parcel the main planner's order (main outer ring, other outer rings,
// then holes); the table order and every stored index stay unchanged.
let dispCache=null;
function dispInfo(){const parcel=currentParcel();if(!parcel)return null;const key=(parcel.stableId||'')+'|'+edgeCount()+'|'+parcel.mainPart;if(dispCache?.key===key)return dispCache;
  const rings=edgeRings(),n=rings.reduce((t,r)=>t+r.pts.length,0),num=Array.from({length:n},(_,i)=>i+1),tag=new Array(n).fill('');
  if(isMulti()){const parts=parcelParts(),mainPart=Number.isInteger(parcel.mainPart)?parcel.mainPart:G.mainPartIndex(parts),offs=new Map();let off=0,no=1;
    rings.forEach(r=>{offs.set(r.part+':'+r.ring,{off,n:r.pts.length});off+=r.pts.length});
    G.ringDisplayOrder(parts,mainPart).forEach(o=>{const at=offs.get(o.part+':'+o.ring);if(!at)return;
      for(let i=0;i<at.n;i++){num[at.off+i]=no++;tag[at.off+i]=o.ring?`فراغ ${o.holeNo} · الجزء ${o.part+1}`:`الجزء ${o.part+1}${o.part===mainPart?' (الرئيسي)':''}`}})}
  return dispCache={key,num,tag}}
const dispNo=i=>dispInfo()?.num[i]??i+1;
function edgeAt(i,parcel){let o=0;for(const r of edgeRings(parcel)){if(i<o+r.pts.length){const l=i-o;return{...r,local:l,a:r.pts[l],b:r.pts[(l+1)%r.pts.length]}}o+=r.pts.length}return null}
function ringPts(part,ring,parcel){const p=parcelParts(parcel)[part];return p?(ring?p.holes?.[ring-1]:p.outer)||[]:[]}
function parcelGeometrySignature(parcel){return parcelParts(parcel).map(part=>`O:${parcelSignature(part.outer)}${(part.holes||[]).map(h=>`H:${parcelSignature(h)}`).join('')}`).join('||')}
function buildParcelIndex(){const points=state.parcels.flatMap(p=>parcelParts(p).flatMap(part=>part.outer));if(!points.length){state.parcelSpatial=null;return}
  const lon=points.reduce((sum,p)=>sum+p[0],0)/points.length,lat=points.reduce((sum,p)=>sum+p[1],0)/points.length,frame=G.frame(lon,lat),size=250,index=new Map(),large=new Set(),projected=[];
  state.parcels.forEach((parcel,id)=>{const rings=parcelParts(parcel).map(part=>({outer:part.outer.map(p=>frame.toXY(p)),holes:(part.holes||[]).map(r=>r.map(p=>frame.toXY(p)))}));projected[id]=rings;
    rings.forEach(shape=>{const ring=shape.outer;if(ring.length<3)return;const xs=ring.map(p=>p.x),ys=ring.map(p=>p.y),x0=Math.floor(Math.min(...xs)/size),x1=Math.floor(Math.max(...xs)/size),y0=Math.floor(Math.min(...ys)/size),y1=Math.floor(Math.max(...ys)/size);
      if((x1-x0+1)*(y1-y0+1)>256){large.add(id);return}for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++){const key=x+','+y,list=index.get(key)||[];list.push(id);index.set(key,list)}})});
  state.parcelSpatial={frame,size,index,large,projected}}
function parcelCandidates(box){const grid=state.parcelSpatial;if(!grid)return state.parcels.map((_,i)=>i);
  const x0=Math.floor(box.minX/grid.size),x1=Math.floor(box.maxX/grid.size),y0=Math.floor(box.minY/grid.size),y1=Math.floor(box.maxY/grid.size),ids=new Set(grid.large);
  if((x1-x0+1)*(y1-y0+1)>4096)return state.parcels.map((_,i)=>i);
  for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)for(const id of grid.index.get(x+','+y)||[])ids.add(id);return[...ids]}
function pointInRing(point,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a.y>point.y)!==(b.y>point.y)&&point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)inside=!inside}return inside}
function screenWorld(x,y,w,h,scale){return{x:state.center.x+(x-w/2-state.view.offsetX)/scale,y:state.center.y-(y-h/2-state.view.offsetY)/scale}}
function parcelsInView(w,h,scale){if(!state.parcelSpatial||!state.frame||!state.view)return state.parcels.map((_,i)=>i);
  const corners=[[0,0],[w,0],[w,h],[0,h]].map(([x,y])=>state.parcelSpatial.frame.toXY(state.frame.toLL(screenWorld(x,y,w,h,scale))));
  return parcelCandidates({minX:Math.min(...corners.map(p=>p.x)),maxX:Math.max(...corners.map(p=>p.x)),minY:Math.min(...corners.map(p=>p.y)),maxY:Math.max(...corners.map(p=>p.y))})}
function parcelAtScreen(x,y,w,h,scale){const grid=state.parcelSpatial;if(!grid)return-1;const point=grid.frame.toXY(state.frame.toLL(screenWorld(x,y,w,h,scale))),ids=parcelCandidates({minX:point.x-1,maxX:point.x+1,minY:point.y-1,maxY:point.y+1});
  let selected=-1,smallest=Infinity;for(const id of ids){for(const shape of grid.projected[id]||[]){const ring=shape.outer;if(!pointInRing(point,ring)||(shape.holes||[]).some(hole=>pointInRing(point,hole)))continue;let area=0;for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length];area+=a.x*b.y-b.x*a.y}area=Math.abs(area);if(area<smallest){smallest=area;selected=id}}}return selected}
function layerFingerprint(kind,items){let hash=2166136261;const add=text=>{for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619)};
  add(kind);for(const item of items){add(String(item.id||''));add(JSON.stringify(item.geometry||item.polygon||null));add(JSON.stringify(item.props||item.properties||{}))}return`${kind}-${items.length}-${(hash>>>0).toString(36)}`}
async function persistLayer(kind,items,file){if(!window.ParcelStore)return'';const id=layerFingerprint(kind,items);
  await ParcelStore.putLayer(kind,id,items,{source:file?.name||'',count:items.length});
  localStorage.setItem(kind==='parcels'?KEY_PARCEL_LAYER:KEY_ROAD_LAYER,id);return id}
function rebuildRoadIndex(){state.roadIndex=state.roads.length?G.buildRoadIndex(state.roads):null}
function persistSelection(){if(!window.ParcelStore||!state.parcelLayerId||!currentParcel())return;
  ParcelStore.putRecord('active-parcel',{layerId:state.parcelLayerId,parcelSignature:state.parcelSignature,parcelId:currentParcel().stableId||currentParcel().id}).catch(error=>console.warn('Parcel selection was not persisted:',error))}
function prepareParcel(parcel){const attrs=parcel.props||parcel.properties||{},entries=Object.entries(attrs),normalized=new Map(entries.map(([key,value])=>[key.toLowerCase(),value]));
  const sourceId=parcel.sourceId||normalized.get('objectid')||normalized.get('parcel_id')||normalized.get('parcel_no')||normalized.get('plot_no')||normalized.get('fid')||'';
  parcel.id=String(parcel.id||normalized.get('parcel_no')||normalized.get('plot_no')||normalized.get('fid')||parcel.label||sourceId||'قطعة غير مرقمة');
  if(!parcel.parts?.length&&parcel.geometry)parcel.parts=polygonParts(parcel.geometry,4326);
  if(!parcel.parts?.length&&parcel.polygon?.length)parcel.parts=[{outer:parcel.polygon,holes:[]}];
  if(!parcel.fromPlanner&&!parcel.deduped&&G.isMultiParts(parcel.parts)){parcel.parts=parcel.parts.map(p=>({outer:G.dedupeRingLL(p.outer),holes:(p.holes||[]).map(h=>G.dedupeRingLL(h)).filter(h=>h.length>=3)})).filter(p=>p.outer.length>=3);
    parcel.polygon=parcel.parts.slice().sort((a,b)=>Math.abs(G.ringArea(b.outer.map(q=>({x:q[0],y:q[1]}))))-Math.abs(G.ringArea(a.outer.map(q=>({x:q[0],y:q[1]})))))[0]?.outer||parcel.polygon;parcel.deduped=true}
  parcel.parcelSignature=parcel.parcelSignature||parcelGeometrySignature(parcel);
  parcel.stableId=parcel.stableId||`parcel:${encodeURIComponent(String(sourceId||'geometry'))}:${layerFingerprint('feature',[parcel])}`;
  parcel.searchText=[parcel.id,...entries.flatMap(([key,value])=>[key,value])].join(' ').toLocaleLowerCase();return parcel}
function renderParcelAttributes(){const box=$('parcelAttributes'),parcel=currentParcel();if(!box)return;box.textContent='';if(!parcel){box.hidden=true;return}
  const attrs=parcel.props||parcel.properties||{},entries=Object.entries(attrs),find=names=>{const wanted=new Set(names.map(x=>x.toLowerCase()));return entries.find(([key,value])=>wanted.has(key.toLowerCase())&&value!==null&&String(value).trim()!=='')?.[1]};
  const fields=[['رقم القطعة',['PARCEL_NO','PLOT_NO','parcel_id','FID']],['رقم المخطط',['PLAN_NO','PLAN_NUMBER','PLANID']],['الحي',['DISTRICT','NEIGHBORHOOD']],['البلدية',['MUNICIPALITY','MUNICIPALITY_NAME']],['الاستخدام',['LAND_USE','USE','USAGE']]];
  for(const [label,keys] of fields){const value=find(keys);if(value===undefined)continue;const item=document.createElement('div'),term=document.createElement('dt'),description=document.createElement('dd');term.textContent=label;description.textContent=String(value);item.append(term,description);box.append(item)}
  {const area=parcelArea(parcel,()=>[]),parts=parcelParts(parcel).length,holes=parcelParts(parcel).reduce((n,p)=>n+(p.holes||[]).length,0),item=document.createElement('div'),term=document.createElement('dt'),description=document.createElement('dd');
    term.textContent='المساحة (محسوبة من الحدود)';description.textContent=area?`${fmt(area.original,2)} م²${parts>1?` · ${parts} أجزاء`:''}${holes?` · ${holes} فراغ داخلي`:''}`:'—';item.append(term,description);box.append(item)}
  const shown=new Set(fields.flatMap(x=>x[1]).map(x=>x.toLowerCase())),other=entries.filter(([key])=>!shown.has(key.toLowerCase()));
  if(other.length){const item=document.createElement('div');item.className='all-fields';item.textContent=other.map(([key,value])=>`${key}: ${String(value??'')}`).join(' · ');box.append(item)}
  box.hidden=false}
function selectParcel(index){const next=typeof index==='number'?index:state.parcels.findIndex(p=>p.stableId===String(index));if(!Number.isInteger(next)||next<0||next>=state.parcels.length)return;
  if(state.measure.active)endMeasure();state.selected=next;const parcel=currentParcel();state.signature=parcel.signature||'';
  state.parcelSignature=parcel.parcelSignature||parcelGeometrySignature(parcel);state.edgeData=parcel.edgeData||[];state.matches=[];state.selection=-1;state.view=null;state.center=null;state.frame=null;if(state.map)state.map._streetFit=false;
  const restored=restoreFromStore();updateParcelChoices();renderParcelAttributes();persistSelection();if(restored)refresh();else analyze({auto:true})}
// Edge data of a multipart parcel in table order; the planner's own keys are replaced by lon/lat edge ids.
function plannerEdgeData(parcel,v){const out=[];edgeRings(parcel).forEach(r=>{const main=r.part===(v.mainPart??0)&&r.ring===0,src=main?v.edgeData:v.ringEdgeData?.[`p${r.part}r${r.ring}`];
    const ok=Array.isArray(src)&&src.length===r.pts.length;r.pts.forEach((_,i)=>{const e=ok?{...src[i]}:{};delete e.key;out.push(e)})});return out}
// Zoning requirements of a parcel from the main planner: sent with the parcel, or its saved planner state (other parcels).
// The footprint limit shown here is the smaller of this table's area inside the setbacks and the coverage limit, computed
// with the main page's own rules (zoning-rules.js); requirements are never assumed here either.
const ZONING=new Map();let zoningPayload=null;
function zoningFor(parcel){if(!window.ZoningRules||!parcel)return null;const id=parcel.stableId||'';
  if(zoningPayload&&(zoningPayload.parcelId||'')===id)return zoningPayload;if(!id)return null;if(ZONING.has(id))return ZONING.get(id);ZONING.set(id,null);
  if(window.ParcelStore)ParcelStore.getRecord('planner-parcel:'+id).then(s=>{if(s?.tx){ZONING.set(id,{parcelId:id,tx:s.tx,site:null});if(currentParcel()?.stableId===id)renderAreaSummary()}}).catch(()=>{});
  return null}
function zoningSummary(res,missing){const Z0=window.ZoningRules;if(!Z0)return null;const z=zoningFor(currentParcel()),tx=z?.tx||{},R=Z0.readRegs(tx);
  const site=z?.site||{city:tx.city||'',amana:tx.amana||'',municipality:tx.municipality||'',district:tx.district||'',planNo:tx.planNo||'',parcelNo:tx.parcelNo||''};
  const rule=tx.zRule?Z0.loadRules().find(r=>r.id===tx.zRule)||null:null,match=rule?Z0.matchRule(rule,site,R.use,R.useTxt):null;
  return Z0.compute({A:res.original,G:res.valid?res.buildable:null,gState:res.valid?(missing?'partial':'ok'):'invalid',regs:R,approval:Z0.approval(R,{rule,match})})}
function loadPayload(){const v=readPayload();if(!v||!Array.isArray(v.polygon)||v.polygon.length<3)return;zoningPayload=v.zoning||null;
  const multi=G.isMultiParts(v.parts);
  state.parcels=[prepareParcel({polygon:v.polygon,parts:multi?v.parts:undefined,mainPart:multi?v.mainPart:undefined,fromPlanner:multi,props:v.attrs||{},id:String(v.parcelNo||'القطعة المختارة'),sourceId:v.parcelId||'',stableId:v.parcelId||undefined,layerId:v.layerId||'',signature:v.signature||'',parcelSignature:v.parcelSignature||parcelSignature(v.polygon),edgeData:v.edgeData||[]})];
  if(multi)state.parcels[0].edgeData=plannerEdgeData(state.parcels[0],v);
  state.parcelLayerId=v.layerId||'';state.roadLayerId=v.roadLayerId||'';
  state.selected=0;state.signature=state.parcels[0].signature;state.parcelSignature=state.parcels[0].parcelSignature;state.edgeData=state.parcels[0].edgeData;
  buildParcelIndex();
  $('parcel-select-wrap').hidden=true;note('parcelStatus',`تم استقبال قطعة الأرض من المخطط الرئيسي · ${state.parcels[0].id}`,true);
  const restored=restoreFromStore();if(restored)refresh();else analyze({auto:true});
  toast(restored?'تم استرجاع نتائج الربط والقياسات المحفوظة لهذه القطعة.':'تم تحميل القطعة المختارة من المشروع. ارفع طبقة الشوارع لبدء التحليل.')}

// Coordinate parsing is intentionally strict: do not guess arbitrary projected CRSs.
const deg=Math.PI/180;
function utmToLL(E,N,z,south=false){const A=6378137,invf=298.257223563,f=1/invf,e2=f*(2-f),ep2=e2/(1-e2),k0=.9996;
  const n0=south?N-10000000:N,M=n0/k0,mu=M/(A*(1-e2/4-3*e2*e2/64-5*e2**3/256));const e1=(1-Math.sqrt(1-e2))/(1+Math.sqrt(1-e2));
  const p=mu+(3*e1/2-27*e1**3/32)*Math.sin(2*mu)+(21*e1**2/16-55*e1**4/32)*Math.sin(4*mu)+(151*e1**3/96)*Math.sin(6*mu)+(1097*e1**4/512)*Math.sin(8*mu);
  const C=Math.cos(p)**2*ep2,T=Math.tan(p)**2,N1=A/Math.sqrt(1-e2*Math.sin(p)**2),R1=A*(1-e2)/Math.pow(1-e2*Math.sin(p)**2,1.5),D=(E-500000)/(N1*k0);
  const lat=p-(N1*Math.tan(p)/R1)*(D**2/2-(5+3*T+10*C-4*C*C-9*ep2)*D**4/24+(61+90*T+298*C+45*T*T-252*ep2-3*C*C)*D**6/720);
  const lon=((z-1)*6-180+3)*deg+(D-(1+2*T+C)*D**3/6+(5-2*C+28*T-3*C*C+8*ep2+24*T*T)*D**5/120)/Math.cos(p);
  return [lon/deg,lat/deg]}
function guessCRS(source,coords){const txt=String(source||'');
  const epsg=(txt.match(/EPSG[:/ ]+(\d{4,5})/i)||txt.match(/AUTHORITY\[\s*"EPSG"\s*,\s*"(\d+)"\s*\]/i)||[])[1];
  if(epsg)return Number(epsg);
  const utm=(txt.match(/UTM[_ \-]*(?:zone[_ ]*)?(\d{1,2})\s*([NS])?/i)||txt.match(/Zone_(\d{1,2})([NS])/i)||[]);
  if(utm.length)return (utm[2]?.toUpperCase()==='S'?32700:32600)+Number(utm[1]);
  if(/GEOGCS|WGS[_ ]?(19)?84|GCS_WGS_1984/i.test(txt)&&!/PROJCS|PROJCRS/i.test(txt))return 4326;
  if(!coords||Math.abs(coords[0])<=180&&Math.abs(coords[1])<=90)return 4326;
  return null}
function convertCoords(p,epsg){const a=Number(p[0]),b=Number(p[1]);if(!Number.isFinite(a)||!Number.isFinite(b))throw Error('إحداثيات غير صالحة في الملف');
  if(epsg===4326){if(Math.abs(a)>180||Math.abs(b)>90)throw Error('ملف الإحداثيات خارج حدود WGS84 بالدرجات');return[a,b]}
  if(epsg>=32601&&epsg<=32660)return utmToLL(a,b,epsg-32600);
  if(epsg>=32701&&epsg<=32760)return utmToLL(a,b,epsg-32700,true);
  throw Error('نظام الإحداثيات غير مدعوم: EPSG:'+epsg+'. حول البيانات إلى WGS84 / EPSG:4326 أو UTM WGS84.')}
function cleanRing(raw){const a=raw.filter(p=>Array.isArray(p)&&p.length>=2);if(a.length>3&&a[0][0]===a[a.length-1][0]&&a[0][1]===a[a.length-1][1])return a.slice(0,-1);return a}
function signedArea(P){let a=0;for(let i=0;i<P.length;i++){const p=P[i],q=P[(i+1)%P.length];a+=p[0]*q[1]-q[0]*p[1]}return a/2}
function containsPoint(point,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside}return inside}
function groupShapefileRings(rings){const sorted=rings.map(cleanRing).filter(r=>r.length>=3).sort((a,b)=>Math.abs(signedArea(b))-Math.abs(signedArea(a))),parts=[];
  sorted.forEach(ring=>{const parents=parts.filter(p=>containsPoint(ring[0],p.outer)).sort((a,b)=>Math.abs(signedArea(a.outer))-Math.abs(signedArea(b.outer)));
    if(parents.length)parents[0].holes.push(ring);else parts.push({outer:ring,holes:[]})});return parts}
function polygonParts(geometry,crs){if(!geometry)return[];
  if(geometry.type==='GeometryCollection')return geometry.geometries.flatMap(g=>polygonParts(g,crs));
  const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.type==='MultiPolygon'?geometry.coordinates:[];
  return polygons.map(poly=>({outer:cleanRing((poly[0]||[]).map(p=>convertCoords(p,crs))),holes:poly.slice(1).map(r=>cleanRing(r.map(p=>convertCoords(p,crs)))).filter(r=>r.length>=3)})).filter(p=>p.outer.length>=3)}
function largestRing(geometry,crs){return polygonParts(geometry,crs).sort((a,b)=>Math.abs(signedArea(b.outer))-Math.abs(signedArea(a.outer)))[0]?.outer||null}
function normalizeLines(geom,crs){if(!geom)return[];const list=geom.type==='LineString'?[geom.coordinates]:geom.type==='MultiLineString'?geom.coordinates:geom.type==='GeometryCollection'?geom.geometries.flatMap(g=>normalizeLines(g,crs).map(x=>x.coordinates)):[];
  return list.map(coords=>({type:'LineString',coordinates:coords.map(p=>convertCoords(p,crs))})).filter(x=>x.coordinates.length>=2)}
function parseGeoJSON(json,kind){const crs=guessCRS(json.crs?.properties?.name||json.crs?.name||'',null);
  const fc=json.type==='FeatureCollection'?json.features:json.type==='Feature'?[json]:[{type:'Feature',geometry:json,properties:{}}];
  // Some CAD exports contain EPSG:326xx without CRS metadata; reject instead of silently treating metres as degrees.
  const first=fc.find(f=>f.geometry)?.geometry;let firstPt=null;
  function findFirst(g){if(!g)return null;let c=g.coordinates;while(Array.isArray(c)&&Array.isArray(c[0]))c=c[0];return Array.isArray(c)&&c.length>=2?c:null}
  firstPt=findFirst(first);const epsg=crs||guessCRS('',firstPt);if(epsg===null)throw Error('ملف GeoJSON بإحداثيات مترية بدون CRS. احفظه من GIS بنظام EPSG:4326 ثم ارفعه.');
  if(kind==='parcel')return fc.map((f,i)=>{const parts=polygonParts(f.geometry,epsg),main=parts.slice().sort((a,b)=>Math.abs(signedArea(b.outer))-Math.abs(signedArea(a.outer)))[0];return main?{id:String(f.properties?.PLOT_NO??f.properties?.PARCEL_NO??f.properties?.رقم_القطعة??f.properties?.FID??f.id??i+1),sourceId:String(f.id??f.properties?.OBJECTID??f.properties?.PARCEL_ID??f.properties?.PARCEL_NO??f.properties?.PLOT_NO??f.properties?.FID??''),props:f.properties||{},polygon:main.outer,parts,geometry:f.geometry}:null}).filter(Boolean);
  return fc.flatMap((f,i)=>normalizeLines(f.geometry,epsg).map((g,k)=>({type:'Feature',geometry:g,properties:{...f.properties,__source:i,__part:k}})))}
function parseShp(buffer){const view=new DataView(buffer),out=[];let off=100;while(off+12<=buffer.byteLength){const nbytes=view.getInt32(off+4,false)*2,rs=off+8;
  if(nbytes<=0||rs+nbytes>buffer.byteLength)break;const shape=view.getInt32(rs,true);
  if([3,5,13,15,23,25].includes(shape)){const np=view.getInt32(rs+36,true),n=view.getInt32(rs+40,true),starts=[];
    if(np>100000||n>10000000||np<1||n<2||rs+44+4*np+16*n>rs+nbytes){out.push(null);off=rs+nbytes;continue}
    for(let k=0;k<np;k++)starts.push(view.getInt32(rs+44+4*k,true));const pb=rs+44+4*np,coords=[];
    for(let k=0;k<n;k++)coords.push([view.getFloat64(pb+16*k,true),view.getFloat64(pb+16*k+8,true)]);
    out.push({shape,parts:starts.map((at,j)=>coords.slice(at,j+1<np?starts[j+1]:n))});
  }else out.push(null);off=rs+nbytes}
  return out}
function parseDbf(buffer,cpg){const u=new Uint8Array(buffer),v=new DataView(buffer);if(u.length<32)return[];const count=v.getUint32(4,true),hl=v.getUint16(8,true),rl=v.getUint16(10,true),fields=[];
  for(let off=32;off+32<=Math.min(hl,u.length)&&u[off]!==13;off+=32){let name='';for(let k=0;k<11&&u[off+k];k++)name+=String.fromCharCode(u[off+k]);fields.push({name,len:u[off+16]})}
  let charset=/1256|arabic/i.test(cpg||'')?'windows-1256':'utf-8';let dec=new TextDecoder(charset);const fallback=new TextDecoder('windows-1256'),out=[];
  for(let i=0;i<Math.min(count,1000000)&&hl+(i+1)*rl<=u.length;i++){let off=hl+i*rl+1,row={};for(const f of fields){const slice=u.subarray(off,off+f.len);let s=dec.decode(slice);if(charset==='utf-8'&&s.includes('�'))s=fallback.decode(slice);row[f.name]=s.replace(/\0/g,'').trim();off+=f.len}out.push(row)}return out}
async function parseZip(file,kind){if(!window.JSZip)throw Error('مكتبة فك ملفات ZIP لم تُحمّل. افتح البرنامج باتصال إنترنت، أو استخدم GeoJSON.');
  const zip=await JSZip.loadAsync(file),all=Object.values(zip.files).filter(f=>!f.dir),shp=all.find(f=>/\.shp$/i.test(f.name));if(!shp)throw Error('لم يتم العثور على SHP داخل ZIP');
  const base=shp.name.replace(/\.shp$/i,''),get=ext=>all.find(f=>f.name.toLowerCase()===(base+ext).toLowerCase());
  const prj=get('.prj'),dbf=get('.dbf'),cpg=get('.cpg');const prjTxt=prj?await prj.async('string'):'';
  if(/Ain[_ ]?el[_ ]?Abd|Ain_el_Abd|D_Ain_el_Abd|KSA_1970/i.test(prjTxt))throw Error('مرجع الطبقة ليس WGS84. أعد إسقاطها إلى EPSG:4326 أو WGS84 UTM في ArcGIS Pro.');
  const shapes=parseShp(await shp.async('arraybuffer'));const attrs=dbf?parseDbf(await dbf.async('arraybuffer'),cpg?await cpg.async('string'):''):[];
  let probe=null;for(const s of shapes)if(s?.parts?.[0]?.length){probe=s.parts[0][0];break}
  const epsg=guessCRS(prjTxt,probe);
  if(!epsg)throw Error('ملف PRJ غير موجود أو إسقاط غير معروف. أعد تصدير الطبقة إلى WGS84 / UTM WGS84، مع ملف PRJ.');
  if(/PROJCS|PROJCRS/i.test(prjTxt)&&epsg===4326)throw Error('الإسقاط المعروض في PRJ غير مدعوم. أعد التصدير إلى EPSG:4326.');
  if(kind==='parcel')return shapes.map((s,i)=>{if(!s)return null;if(![5,15,25].includes(s.shape))return null;
    const rings=s.parts.map(part=>cleanRing(part.map(p=>convertCoords(p,epsg)))).filter(p=>p.length>=3),parts=groupShapefileRings(rings),main=parts.slice().sort((a,b)=>Math.abs(signedArea(b.outer))-Math.abs(signedArea(a.outer)))[0];
    return main?{id:String(attrs[i]?.PLOT_NO??attrs[i]?.PARCEL_NO??attrs[i]?.FID??i+1),sourceId:String(attrs[i]?.OBJECTID??attrs[i]?.PARCEL_ID??attrs[i]?.PARCEL_NO??attrs[i]?.PLOT_NO??attrs[i]?.FID??''),props:attrs[i]||{},polygon:main.outer,parts,geometry:{type:'ShapefilePolygon',rings}}:null}).filter(Boolean);
  return shapes.flatMap((s,i)=>s&&[3,13,23].includes(s.shape)?s.parts.filter(c=>c.length>=2).map((c,k)=>({type:'Feature',properties:{...(attrs[i]||{}),__source:i,__part:k},geometry:{type:'LineString',coordinates:c.map(p=>convertCoords(p,epsg))}})):[]);
}
async function importLayer(file,kind){const name=file.name.toLowerCase();return name.endsWith('.zip')?parseZip(file,kind):parseGeoJSON(JSON.parse(await file.text()),kind)}
async function restoreStoredLayers(){if(!window.ParcelStore)return;
  const payload=readPayload(),requestedLayer=payload?.layerId||localStorage.getItem(KEY_PARCEL_LAYER);
  if(requestedLayer){try{const record=await ParcelStore.getLayer('parcels',requestedLayer);if(Array.isArray(record?.data)&&record.data.length){const layer=record.data.map(prepareParcel),sent=payload?state.parcels[0]:null;
      let selected=sent?layer.findIndex(p=>(payload.parcelId&&p.stableId===payload.parcelId)||p.parcelSignature===payload.parcelSignature):-1;
      if(sent&&selected<0){note('parcelStatus',`القطعة المرسلة من المخطط الرئيسي غير موجودة في الطبقة المحفوظة؛ عُرضت القطعة المرسلة فقط · ${sent.id}`,true)}
      else{
        // keep the main planner's ring and edge data for the sent parcel, so edge keys and earlier setbacks stay aligned
        if(sent&&(G.isMultiParts(sent.parts)||!G.isMultiParts(parcelParts(layer[selected])))){const p=layer[selected];p.polygon=sent.polygon;p.parts=sent.parts;p.fromPlanner=sent.fromPlanner;p.mainPart=sent.mainPart;p.edgeData=sent.edgeData||[];p.signature=sent.signature||'';p.parcelSignature=sent.parcelSignature||p.parcelSignature}
        state.parcels=layer;state.parcelLayerId=requestedLayer;buildParcelIndex();
        if(selected<0){const active=await ParcelStore.getRecord('active-parcel');if(active?.layerId===requestedLayer)selected=state.parcels.findIndex(p=>p.stableId===active.parcelId||p.parcelSignature===active.parcelSignature)}
        updateParcelChoices();selectParcel(selected>=0?selected:0);note('parcelStatus',`تم استرجاع ${fmt(state.parcels.length,0)} قطعة من التخزين المحلي.`,true)}}}catch(error){note('parcelStatus',`تعذر استرجاع طبقة القطع: ${error.message}`,false,true)}}
  const requestedRoads=payload?.roadLayerId||localStorage.getItem(KEY_ROAD_LAYER);
  if(requestedRoads){try{const record=await ParcelStore.getLayer('roads',requestedRoads);if(Array.isArray(record?.data)){state.roads=record.data;state.roadLayerId=requestedRoads;rebuildRoadIndex();updateFieldSelectors();note('roadStatus',`تم استرجاع ${fmt(state.roads.length,0)} محور شارع من التخزين المحلي.`,true);
      if(currentParcel()&&!storeEntry())analyze({auto:true});else refresh()}}
    catch(error){note('roadStatus',`تعذر استرجاع طبقة الشوارع: ${error.message}`,false,true)}}}
function pickField(fields,candidates){return fields.find(v=>candidates.some(re=>re.test(v)))||''}
function updateFieldSelectors(){const fields=[...new Set(state.roads.flatMap(f=>Object.keys(f.properties||{})))].filter(f=>!f.startsWith('__'));
  const s=$('streetField'),w=$('widthField');for(const sel of [s,w]){sel.textContent='';const op=document.createElement('option');op.value='';op.textContent=sel===s?'— اختر الحقل —':'غير متوفر';sel.append(op);
    fields.forEach(f=>{const o=document.createElement('option');o.value=f;o.textContent=f;sel.append(o)})}
  s.value=pickField(fields,[/street.?name/i,/road.?name/i,/^name(_ar)?$/i,/اسم.?الشارع/,/اسم.?الطريق/,/الشارع/]);
  w.value=pickField(fields,[/^width(_m)?$/i,/street.?width/i,/road.?width/i,/عرض.?الشارع/,/عرض.?الطريق/,/ROW_WIDTH/i]);
}
function updateParcelChoices(){const select=$('parcelSelect'),search=$('parcelSearch'),query=search?.value.trim().toLocaleLowerCase()||'';select.textContent='';
  let visible=state.parcels.map((p,i)=>({p,i})).filter(({p})=>!query||p.searchText.includes(query));const current=currentParcel();
  if(current&&!visible.some(({p})=>p.stableId===current.stableId))visible=[{p:current,i:state.selected},...visible];
  visible.forEach(({p,i})=>{const o=document.createElement('option');o.value=p.stableId;o.textContent=`${p.id} — قطعة ${i+1}`;select.append(o)});
  if(current)select.value=current.stableId;const multiple=state.parcels.length>1;$('parcel-select-wrap').hidden=!multiple;$('parcel-search-control').hidden=!multiple}
async function handleFile(file,kind){if(!file)return;try{const list=await importLayer(file,kind);if(!list.length)throw Error(kind==='roads'?'الملف لا يحتوي خطوط شوارع صالحة. ارفع Polyline.':'الملف لا يحتوي قطعًا مضلعية.');
    if(state.isDemo){if(kind==='parcel')state.roads=[];else state.parcels=[];state.isDemo=false;}
    if(kind==='parcel'){state.parcels=list.map(p=>prepareParcel({...p,parcelSignature:parcelSignature(p.polygon)}));state.selected=0;state.signature='';state.parcelSignature='';state.edgeData=[];state.matches=[];if($('parcelSearch'))$('parcelSearch').value='';buildParcelIndex();state.parcelLayerId=await persistLayer('parcels',state.parcels,file);updateParcelChoices();note('parcelStatus',`تم تحميل ${fmt(list.length,0)} قطعة من ${file.name}${state.parcelLayerId?' وحُفظت الطبقة كاملة.':'؛ التخزين الدائم غير متاح.'}`,true);selectParcel(0)}
    else{state.roads=list;state.roadLayerId=await persistLayer('roads',state.roads,file);rebuildRoadIndex();updateFieldSelectors();note('roadStatus',`تم تحميل ${fmt(list.length,0)} خط شارع من ${file.name}${state.roadLayerId?' وحُفظت الطبقة كاملة.':'؛ التخزين الدائم غير متاح.'}`,true);
      if(currentParcel())analyze({auto:true});else refresh()}
    toast(kind==='parcel'?'تمت قراءة طبقة القطع. اختر قطعة من القائمة أو من الخريطة.':currentParcel()?'تمت قراءة طبقة الشوارع وتحديث ربط أضلاع القطعة المختارة.':'تمت قراءة طبقة الشوارع.');
  }catch(err){note(kind==='parcel'?'parcelStatus':'roadStatus',err.message,false,true);toast(err.message)}}
function fillDemo(){const f=G.frame(39.8236,21.4255),pts=[[-48,-33],[38,-33],[48,11],[25,40],[-48,35]].map(p=>f.toLL({x:p[0],y:p[1]}));
  state.parcels=[prepareParcel({id:'DEMO-124',polygon:pts,props:{PLOT_NO:'DEMO-124'}})];state.selected=0;buildParcelIndex();
  const roads=[
    {name:'شارع تجريبي ١',w:20,pts:[[-75,-50],[66,-50]]},
    {name:'شارع تجريبي ٢',w:14,pts:[[62,-58],[65,50]]},
    {name:'شارع تجريبي ٣',w:12,pts:[[-65,53],[8,55]]},
    {name:'شارع بعيد',w:30,pts:[[-110,-110],[-80,-98]]}
  ];state.roads=roads.map((r,i)=>({type:'Feature',properties:{STREET_NAME:r.name,WIDTH_M:r.w},geometry:{type:'LineString',coordinates:r.pts.map(p=>f.toLL({x:p[0],y:p[1]}))}}));rebuildRoadIndex();
  state.signature='';state.parcelSignature=parcelSignature(pts);state.edgeData=[];state.isDemo=true;updateParcelChoices();updateFieldSelectors();note('parcelStatus','قطعة نموذجية لأغراض تجربة الواجهة فقط',true);note('roadStatus','٤ محاور شوارع تجريبية، وليست بيانات رسمية',true);state.matches=[];refresh();analyze()}
// Edge identity: the planner's own key when opened from the main page, otherwise the ring's start/end vertices.
// Simple parcels keep their original keys; multipart parcels use parcel#part/ring/edge#lon,lat ids.
// Same edge: identical key, or the same parcel/part/ring/edge id with end points within ≈5 cm (coordinates round-tripped by the planner).
function sameKey(a,b){if(a===b)return true;const x=G.parseEdgeId(a),y=G.parseEdgeId(b);if(!x||!y)return false;
  return x.parcelId===y.parcelId&&x.part===y.part&&x.ring===y.ring&&x.edge===y.edge&&[[x.a,y.a],[x.b,y.b]].every(([p,q])=>Math.abs(p[0]-q[0])<5e-7&&Math.abs(p[1]-q[1])<5e-7)}
function edgeKeyAt(i){if(state.edgeData[i]?.key)return state.edgeData[i].key;const e=edgeAt(i);if(!e)return'';return isMulti()?G.edgeId(currentParcel()?.stableId||'parcel',e.part,e.ring,e.local,e.a,e.b):G.edgeKey(e.pts,e.local)}
function prevSbAt(i){const v=Number(state.edgeData[i]?.sb);return state.edgeData[i]&&Number.isFinite(v)?v:null}
/* ---- Setback rule (user-defined; never a regulatory default) ---- */
function sbSettings(){const max=$('maximum').value.trim();return{method:$('rule').value,ratio:nval('ratio'),min:nval('minimum'),max:max===''?'':Number(max),rounding:$('rounding').value,fixed:nval('fixed'),source:$('ruleSource').value.trim()}}
function calcSb(width){const o=sbSettings(),v=G.computeSetback(width,o);return v===null?null:{sb:v,src:o.method}}
function updateRowSetback(r){if(r.sbSource==='manual')return;const c=calcSb(r.width);
  if(c){r.sb=c.sb;r.sbSource=c.src}else if(Number.isFinite(r.prevSb)){r.sb=r.prevSb;r.sbSource='previous'}else{r.sb=null;r.sbSource=null}}
// A manual width keeps an earlier measurement as reference; GIS or cleared widths drop it.
function setWidth(r,width,src){r.width=width;r.widthSource=width===null?null:src;if(src!=='measured'&&src!=='manual')r.measure=null;r.copiedFrom=null;updateRowSetback(r)}
function ruleSummary(){const o=sbSettings(),out=$('ruleFormula');out.className='formula';
  if(o.method==='manual'){out.textContent='يُدخل الارتداد لكل ضلع في الجدول. القيم السابقة من المخطط الرئيسي تبقى كما هي.';return}
  if(o.method==='fixed'){out.textContent=Number.isFinite(o.fixed)&&o.fixed>=0?`ارتداد ثابت ${fmt(o.fixed,2)} م لكل الأضلاع ما لم يُعدَّل يدويًا.`:'أدخل قيمة الارتداد الثابت.';return}
  const bad=!(o.ratio>=0&&o.ratio<=100)?'النسبة يجب أن تكون بين 0 و100%.':o.min<0?'الحد الأدنى لا يكون سالبًا.':o.max!==''&&!(o.max>0)?'الحد الأقصى يجب أن يكون رقمًا موجبًا أو فارغًا.':o.max!==''&&o.min>o.max?'الحد الأدنى أكبر من الحد الأقصى.':'';
  if(bad){out.textContent=bad;out.className='formula status-bad';return}
  const f=`SB = ${o.max!==''?'min(':''}max(W × ${fmt(o.ratio/100,4)}, ${fmt(o.min,2)})${o.max!==''?`, ${fmt(o.max,2)})`:''}`,ex=G.computeSetback(20,o);
  out.textContent='';const code=document.createElement('code');code.dir='ltr';code.textContent=f;const s=document.createElement('span');
  s.textContent=`مثال توضيحي: عرض 20 م ← ${fmt(ex,2)} م · ${$('rounding').selectedOptions[0]?.textContent||''}${o.source?` · المرجع: ${o.source}`:' · لم يُحدد مرجع القاعدة'}`;out.append(code,s)}
function syncRuleControls(){const m=$('rule').value;$('customRule').hidden=m!=='custom';$('fixedRule').hidden=m!=='fixed';ruleSummary()}
function saveSettings(){try{localStorage.setItem(KEY_SET,JSON.stringify(Object.fromEntries(['rule','ratio','minimum','maximum','rounding','fixed','ruleSource'].map(id=>[id,$(id).value]))))}catch(e){}}
function loadSettings(){let s=null;try{s=JSON.parse(localStorage.getItem(KEY_SET)||'null')}catch(e){}if(!s)return;
  for(const id of ['ratio','minimum','maximum','rounding','fixed','ruleSource'])if(s[id]!==undefined&&$(id))$(id).value=s[id];
  if(['manual','custom','fixed'].includes(s.rule))$('rule').value=s.rule}
function onRuleChange(){syncRuleControls();state.matches.forEach(updateRowSetback);saveSettings();saveStore();renderTable();syncMeasureUI()}
/* ---- Project store: measurements and results survive navigation between the two pages ---- */
function projectKey(){const p=parcelCoordinates();if(!p)return'';if(currentParcel()?.stableId)return'id:'+currentParcel().stableId;if(state.parcelSignature)return'geo:'+state.parcelSignature;if(state.signature)return'sig:'+state.signature;
  const s=p.map(q=>q[0].toFixed(7)+','+q[1].toFixed(7)).join('|');let h=5381;for(let i=0;i<s.length;i++)h=((h*33)^s.charCodeAt(i))>>>0;return'poly:'+p.length+':'+h.toString(36)}
let storeCache=null;
function readLegacyStore(){try{return JSON.parse(localStorage.getItem(KEY_STORE)||'{}')||{}}catch(e){return{}}}
function readStore(){return storeCache||readLegacyStore()}
// Results of every parcel are kept as separate IndexedDB records keyed by the stable parcel id.
async function loadStoreCache(){if(!window.ParcelStore)return;
  try{const rows=await ParcelStore.listRecords(STORE_PREFIX),cache={};rows.forEach(r=>{if(r?.value)cache[String(r.id).slice(STORE_PREFIX.length)]=r.value});
    const legacy=readLegacyStore(),moved=[];
    for(const [k,v] of Object.entries(legacy))if(v&&(!cache[k]||(cache[k].at||0)<(v.at||0))){cache[k]=v;moved.push(ParcelStore.putRecord(STORE_PREFIX+k,v))}
    await Promise.all(moved);if(Object.keys(legacy).length)try{localStorage.removeItem(KEY_STORE)}catch(e){}
    storeCache=cache}catch(error){console.warn('Saved parcel results are read from localStorage only:',error)}}
// returns a promise that settles when the entry is stored (used before leaving the page)
function writeEntry(k,entry){
  if(storeCache){storeCache[k]=entry;return ParcelStore.putRecord(STORE_PREFIX+k,entry).catch(error=>{console.warn('Parcel result was not saved:',error);toast('تعذر حفظ نتائج القطعة في التخزين المحلي.')})}
  const all=readLegacyStore();all[k]=entry;Object.keys(all).sort((a,b)=>(all[b].at||0)-(all[a].at||0)).slice(20).forEach(x=>delete all[x]);
  try{localStorage.setItem(KEY_STORE,JSON.stringify(all))}catch(e){entry.roads=null;try{localStorage.setItem(KEY_STORE,JSON.stringify(all))}catch(e2){}}return Promise.resolve()}
function deleteEntry(k){if(!k)return;if(storeCache){delete storeCache[k];ParcelStore.deleteRecord(STORE_PREFIX+k).catch(error=>console.warn('Parcel result was not deleted:',error))}
  const all=readLegacyStore();if(all[k]){delete all[k];try{localStorage.setItem(KEY_STORE,JSON.stringify(all))}catch(e){}}}
function edgeCount(parcel=currentParcel()){return edgeRings(parcel).reduce((sum,r)=>sum+r.pts.length,0)}
function storeEntry(){const k=projectKey();return k?readStore()[k]||null:null}
const lightCand=c=>({roadIndex:c.roadIndex,street:c.street,width:c.width,avgDistance:c.avgDistance,angle:c.angle,score:c.score});
// Only roads near the parcel are cached, so the map can be redrawn without re-uploading the full layer.
function nearbyRoads(){const p=parcelParts().flatMap(part=>part.outer);if(!p.length||!state.roads.length||state.roadLayerId)return null;const f=mapFrame(),P=p.map(q=>f.toXY(q)),pad=400;
  const x0=Math.min(...P.map(q=>q.x))-pad,x1=Math.max(...P.map(q=>q.x))+pad,y0=Math.min(...P.map(q=>q.y))-pad,y1=Math.max(...P.map(q=>q.y))+pad;
  const near=state.roads.filter(r=>r.geometry.coordinates.some(c=>{const q=f.toXY(c);return q.x>=x0&&q.x<=x1&&q.y>=y0&&q.y<=y1}));
  return JSON.stringify(near).length<1.2e6?near:null}
function saveStore(){if(state.isDemo||!state.matches.length)return;const k=projectKey();if(!k)return;
  const rows=state.matches.map(r=>({key:r.key,edge:r.edge,part:r.part??0,ring:r.ring||0,localEdge:r.localEdge??r.edge,length:r.length,status:r.status,name:r.name,nameManual:!!r.nameManual,width:r.width,widthSource:r.widthSource,measure:r.measure||null,copiedFrom:r.copiedFrom??null,
    sb:r.sb,sbSource:r.sbSource,prevSb:r.prevSb,face:r.face,faceManual:!!r.faceManual,front:r.face==='front',accepted:r.accepted,selected:r.selected?lightCand(r.selected):null,candidates:(r.candidates||[]).map(lightCand)}));
  return writeEntry(k,{at:Date.now(),parcel:currentParcel()?.id||'',parcelId:currentParcel()?.stableId||'',layerId:state.parcelLayerId,parcelSignature:state.parcelSignature,rows,fields:{street:$('streetField').value,width:$('widthField').value},roads:nearbyRoads()})}
function restoreFromStore(){const e=storeEntry(),poly=parcelCoordinates();if(!e?.rows?.length||!poly||e.rows.length!==edgeCount())return false;
  if(e.rows.some((r,i)=>!sameKey(r.key,edgeKeyAt(i))))return false;
  if(Array.isArray(e.roads)&&e.roads.length&&!state.roads.length){state.roads=e.roads;rebuildRoadIndex();updateFieldSelectors();
    for(const [id,v] of [['streetField',e.fields?.street],['widthField',e.fields?.width]])if(v&&[...$(id).options].some(o=>o.value===v))$(id).value=v;
    note('roadStatus',`تم استرجاع ${fmt(e.roads.length,0)} محور شارع محفوظ قرب القطعة. يمكنك رفع الطبقة كاملة مجددًا.`,true)}
  state.matches=e.rows.map((r,i)=>{const candidates=r.candidates||[],at=edgeAt(i);return{...r,key:edgeKeyAt(i),edge:i,part:at?.part??r.part??0,ring:at?.ring??0,localEdge:at?.local??r.localEdge??i,face:FACE[r.face]?r.face:r.front?'front':'side',prevSb:prevSbAt(i)??r.prevSb??null,candidates,
    selected:r.selected?candidates.find(c=>c.roadIndex===r.selected.roadIndex)||r.selected:null}});
  return true}
// Earlier width/setback decisions for an edge: current session → saved project → main planner data.
function priorFor(key,i){const cur=state.matches.find(m=>sameKey(m.key,key));if(cur)return cur;
  const st=storeEntry()?.rows?.find(m=>sameKey(m.key,key));if(st)return st;
  const e=state.edgeData[i];if(e&&(!e.key||sameKey(e.key,key))){const w=G.parseWidth(e.streetW);
    return{width:w,widthSource:w!==null?(e.streetWSrc==='measured'?'measured':'manual'):null,measure:e.streetMeasure||null,sbSource:null,plannerRole:FACE[e.role]&&e.role!=='side'?e.role:null}}return null}
// Only parcels near the selected one can stand between an edge and a street: query the parcel grid, not the whole layer.
function barrierRings(radius){const grid=state.parcelSpatial,others=ids=>ids.filter(i=>i!==state.selected).flatMap(i=>parcelParts(state.parcels[i]).map(part=>part.outer));
  if(!grid)return others(state.parcels.map((_,i)=>i));const pts=parcelParts().flatMap(part=>part.outer).map(p=>grid.frame.toXY(p)),pad=radius*1.5+5;
  return others(parcelCandidates({minX:Math.min(...pts.map(p=>p.x))-pad,maxX:Math.max(...pts.map(p=>p.x))+pad,minY:Math.min(...pts.map(p=>p.y))-pad,maxY:Math.max(...pts.map(p=>p.y))+pad}))}
// auto: run on parcel selection or layer load; quiet, and only saved when the parcel already has saved decisions.
function analyze(opts={}){const auto=!!opts.auto,polygon=parcelCoordinates();if(!polygon){if(!auto)toast('اختر قطعة الأرض أولًا.');refresh();return}
  try{const radius=nval('radius'),angle=nval('angle');if(!radius||radius<1||radius>200||!angle||angle<1||angle>90)throw Error('تحقق من مسافة البحث واختلاف الاتجاه.');
    const parts=parcelParts(),hadStore=!!storeEntry();
    const output=G.match({polygons:parts.map(part=>part.outer),roads:state.roads,radius,angleLimit:angle,streetField:$('streetField').value,widthField:$('widthField').value,roadIndex:state.roadIndex,
      barrierPolygons:barrierRings(radius)});
    let next=output.results.length;const holeRows=edgeRings().filter(r=>r.ring>0).flatMap(r=>r.pts.map((_,i)=>({edge:next++,part:r.part,ring:r.ring,localEdge:i,status:'حدود داخلية',candidates:[],selected:null,manual:false})));
    state.matches=output.results.map(r=>({...r,ring:0})).concat(holeRows).map(r=>{const c=r.selected,key=edgeKeyAt(r.edge)||r.key,p=priorFor(key,r.edge),ring=ringPts(r.part||0,r.ring||0)||polygon,local=r.localEdge??r.edge;
      // real edge length on the WGS84 ellipsoid, independent of the planar frame of the road index
      const length=G.edgeLength(ring[local],ring[(local+1)%ring.length]),face=p?.faceManual&&FACE[p.face]?p.face:p?.plannerRole||(c?'front':'side');
      const row={...r,part:r.part??0,ring:r.ring||0,localEdge:local,length,key,name:p?.nameManual?p.name:c?.street||'',nameManual:!!p?.nameManual,width:c?.width??null,widthSource:c&&c.width!==null?'gis':null,measure:null,copiedFrom:null,sb:null,sbSource:null,prevSb:prevSbAt(r.edge),
        face,faceManual:!!p?.faceManual,accepted:r.status==='مطابقة قوية'};
      row.front=row.face==='front';
      // a decision the user already took (approve or not) stays while the edge keeps the same street name
      if(typeof p?.accepted==='boolean'&&String(row.name).trim()&&String(p.name||'').trim().replace(/\s+/g,' ')===String(row.name).trim().replace(/\s+/g,' '))row.accepted=p.accepted;
      // measured or typed widths win over the GIS field, and a typed setback is never recalculated
      if(p&&p.width>0&&(p.widthSource==='measured'||p.widthSource==='manual')){row.width=p.width;row.widthSource=p.widthSource;row.measure=p.measure||null;row.copiedFrom=p.copiedFrom??null}
      if(p&&p.sbSource==='manual'&&Number.isFinite(p.sb)){row.sb=p.sb;row.sbSource='manual'}else updateRowSetback(row);
      return row});
    state.selection=-1;endMeasure();if(!auto||hadStore)saveStore();refresh();
    if(!auto)toast(state.roads.length?`تم تحليل ${state.matches.length} ضلع. راجع الجدول قبل التطبيق.`:`تم تحديد ${state.matches.length} ضلع وأطوالها. ارفع طبقة الشوارع لربط أسماء الشوارع.`)
  }catch(err){toast(err.message);refresh()}}
function refresh(){const polygon=parcelCoordinates();$('mapEmpty').hidden=!!polygon;
  const count=polygon?edgeCount():0,matched=state.matches.filter(x=>x.selected).length,review=state.matches.filter(x=>x.status==='يحتاج مراجعة'||x.status==='غير مرتبط').length;
  $('totalEdges').textContent=count||'—';$('matchedEdges').textContent=state.matches.length?matched:'—';$('reviewEdges').textContent=state.matches.length?review:'—';$('roadCount').textContent=state.roads.length||'—';
  $('mapTitle').textContent=polygon?`${currentParcel().id} · ${count} أضلاع · ${state.roads.length} شوارع`:'لا توجد قطعة محددة';
  if(state.measure.active&&!state.matches[state.measure.edge])endMeasure();
  renderTable();fitMap(false);renderMap()}
const RULER_SVG='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 15.6 15.6 3.5l4.9 4.9L8.4 20.5z"/><path d="m7.1 12 1.8 1.8M9.6 9.5l2.6 2.6M12.1 7l1.8 1.8M14.6 4.5l2.6 2.6"/></svg>';
function selectEdge(i){state.selection=i;document.querySelectorAll('tr[data-edge]').forEach(el=>el.classList.toggle('sel',Number(el.dataset.edge)===i));
  const M=state.measure;if(M.active&&M.mode!=='share'&&M.edge!==i)retargetMeasure(i);renderMap()}
function widthBadge(r,i){const b=document.createElement(r.measure?.a?'button':'span');b.className='src '+(r.widthSource||'none');
  b.textContent=r.widthSource?SRC_W[r.widthSource]+(r.copiedFrom!=null?` · منسوخ من ض${r.copiedFrom+1}`:''):'بدون عرض';
  if(r.measure?.a){b.type='button';b.title='عرض القياس على الصورة الفضائية';b.addEventListener('click',()=>reviewMeasure(i))}return b}
function renderTable(){const body=$('resultRows');body.textContent='';if(!state.matches.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=9;td.textContent='لا توجد نتائج تحليل بعد. حمّل الطبقات واضغط «تحليل وربط الأضلاع».';td.style='text-align:center;padding:26px;color:#8a9990';tr.append(td);body.append(tr);renderAreaSummary();return}
  state.matches.map((_,i)=>i).sort((a,b)=>dispNo(a)-dispNo(b)).forEach(i=>{const r=state.matches[i];
    const tr=document.createElement('tr');tr.dataset.edge=i;if(i===state.selection)tr.className='sel';
    const cell=(v)=>{const td=document.createElement('td');if(typeof v==='string')td.textContent=v;else td.append(v);tr.append(td);return td};
    const num=document.createElement('span');num.className='edge-num';num.textContent=dispNo(i);const ntd=cell(num),tg=dispInfo()?.tag[i];if(tg){const sm=document.createElement('small');sm.className='edge-part';sm.textContent=tg;ntd.append(sm)}cell(`${fmt(r.length,2)} م`);
    const name=document.createElement('input');name.className='name-input';name.setAttribute('aria-label','اسم شارع الضلع '+dispNo(i));name.value=r.name||'';name.placeholder='غير مرتبط';name.addEventListener('input',()=>{r.name=name.value;r.nameManual=true;r.accepted=false;renderMap()});name.addEventListener('change',()=>{saveStore();syncMeasureUI()});cell(name);
    const opts=document.createElement('select');opts.setAttribute('aria-label','مرشح الضلع '+dispNo(i));if(!r.candidates.length)opts.title='لا يوجد شارع مرشح قريب من هذا الضلع';let o=document.createElement('option');o.value='';o.textContent='— يدوي / بدون —';opts.append(o);
    r.candidates.forEach((c,j)=>{const q=document.createElement('option');q.value=String(j);q.textContent=`${c.street||'شارع بدون اسم'} (${fmt(c.avgDistance,1)}م)`;opts.append(q)});
    opts.value=r.selected?String(r.candidates.findIndex(c=>c.roadIndex===r.selected.roadIndex)):' ';if(!r.selected)opts.value='';
    opts.addEventListener('change',()=>{const c=r.candidates[+opts.value];r.selected=opts.value===''?null:c||null;r.name=c?.street||r.name;r.nameManual=false;if(!r.faceManual){r.face=r.selected?'front':'side';r.front=r.face==='front'}r.accepted=false;r.status=r.selected?'اختيار يدوي':'غير مرتبط';
      // a GIS width never replaces a width the user measured or typed
      if(c&&c.width!==null&&r.widthSource!=='measured'&&r.widthSource!=='manual')setWidth(r,c.width,'gis');else updateRowSetback(r);
      saveStore();renderTable();renderMap()});cell(opts);
    const wbox=document.createElement('div');wbox.className='wcell';
    const width=document.createElement('input');width.type='number';width.min='0';width.step='.01';width.placeholder='—';width.value=r.width??'';width.setAttribute('aria-label','عرض شارع الضلع '+dispNo(i));
    width.addEventListener('change',()=>{const raw=width.value.trim();if(raw===''){setWidth(r,null,null)}else{const v=G.parseWidth(raw);
        if(v===null){toast('عرض الشارع يجب أن يكون رقمًا موجبًا بالمتر (أقل من 300 م).');width.value=r.width??'';return}setWidth(r,Math.round(v*100)/100,'manual')}
      saveStore();renderTable();renderMap()});
    const rb=document.createElement('button');rb.type='button';rb.className='row-ruler';rb.title='قياس عرض الشارع المقابل لهذا الضلع';rb.setAttribute('aria-label','قياس عرض شارع الضلع '+dispNo(i));rb.innerHTML=RULER_SVG;
    rb.addEventListener('click',()=>{selectEdge(i);startMeasure()});
    wbox.append(width,rb);const wtd=cell(wbox);wtd.append(widthBadge(r,i));
    const sb=document.createElement('input');sb.type='number';sb.min='0';sb.step='.01';sb.placeholder='—';sb.value=r.sb??'';sb.setAttribute('aria-label','ارتداد الضلع '+dispNo(i));sb.title='اترك الحقل فارغًا للعودة إلى القاعدة المختارة';
    sb.addEventListener('change',()=>{const raw=sb.value.trim();if(raw===''){r.sbSource=null;updateRowSetback(r)}else{const v=Number(raw);
        if(!Number.isFinite(v)||v<0){toast('الارتداد يجب أن يكون رقمًا موجبًا أو صفرًا.');sb.value=r.sb??'';return}r.sb=Math.round(v*100)/100;r.sbSource='manual'}
      r.accepted=false;saveStore();renderTable()});
    const sbtd=cell(sb),sbb=document.createElement('span');sbb.className='src '+(r.sbSource==='manual'?'manual':r.sbSource?'gis':'none');sbb.textContent=r.sbSource?SRC_SB[r.sbSource]:'غير محدد';sbtd.append(sbb);
    // suggested value of the user's rule, next to the approved value (which may be typed or kept from the planner)
    const sug=calcSb(r.width),hint=document.createElement('small');hint.className='sb-suggested';
    hint.textContent=$('rule').value==='manual'?'المقترح: لا توجد قاعدة':sug?`المقترح: ${fixed2(sug.sb)} م`:'المقترح: — (بدون عرض)';sbtd.append(hint);
    const face=document.createElement('select');face.className='face-select';face.setAttribute('aria-label','نوع واجهة الضلع '+dispNo(i));
    for(const [value,label] of Object.entries(FACE)){const o=document.createElement('option');o.value=value;o.textContent=label;face.append(o)}face.value=FACE[r.face]?r.face:'side';
    face.addEventListener('change',()=>{r.face=face.value;r.front=r.face==='front';r.faceManual=true;r.accepted=false;saveStore();renderTable()});cell(face);
    const approve=document.createElement('input');approve.type='checkbox';approve.checked=!!r.accepted;approve.setAttribute('aria-label','اعتماد مطابقة الضلع '+dispNo(i));approve.addEventListener('change',()=>{if(approve.checked&&!String(r.name||'').trim()){approve.checked=false;toast('اكتب اسم الشارع أولًا ثم اعتمد الربط.');return}r.accepted=approve.checked;saveStore()});cell(approve);
    const conf=document.createElement('span');conf.className='confidence'+(r.status==='غير مرتبط'||r.status==='حدود داخلية'?' no':r.status==='يحتاج مراجعة'?' review':'');conf.textContent=r.status;cell(conf);
    tr.addEventListener('click',e=>{if(['INPUT','SELECT','OPTION','BUTTON'].includes(e.target.tagName)||e.target.closest('button'))return;selectEdge(i)});body.append(tr)
  });renderAreaSummary()}
// Original area, area left after the approved setbacks, and the difference; computed for the selected parcel only.
// Setbacks of one ring from the table rows (approved values; empty = 0).
function ringSetbacks(part,ring,n){const out=new Array(n).fill(0);state.matches.forEach(r=>{if((r.part??0)===part&&(r.ring||0)===ring){const v=Number(r.sb);out[r.localEdge??r.edge]=r.sb!==null&&r.sb!==''&&Number.isFinite(v)?v:0}});return out}
function parcelArea(parcel=currentParcel(),sbsFor=ringSetbacks){const parts=parcelParts(parcel),pts=parts.flatMap(p=>p.outer||[]);if(!pts.length)return null;
  const c=pts.reduce((a,p)=>[a[0]+p[0]/pts.length,a[1]+p[1]/pts.length],[0,0]),fr=G.frame(c[0],c[1]),xy=parts.map(p=>({outer:(p.outer||[]).map(q=>fr.toXY(q)),holes:(p.holes||[]).map(h=>h.map(q=>fr.toXY(q)))}));
  let res=G.buildableClip(xy,(k,r,n)=>sbsFor(k,r,n),window.polygonClipping);
  // without the clipping library a simple polygon is still exact with the validated inset; a multipart one is not computed
  if(!res.valid&&!window.polygonClipping&&!G.isMultiParts(parts)&&!G.validateParts(xy).length){const inset=G.insetPolygon(xy[0].outer,sbsFor(0,0,xy[0].outer.length));
    res=inset?{original:res.original,buildable:inset.area,difference:res.original-inset.area,valid:true,errors:[]}:{...res,errors:['الارتدادات المدخلة تُلغي ضلعًا أو تُنتج مضلعًا متقاطعًا؛ راجع القيم.']}}
  return res}
function geometryErrors(parcel=currentParcel()){const parts=parcelParts(parcel),pts=parts.flatMap(p=>p.outer||[]);if(!pts.length)return['لا توجد هندسة للقطعة.'];
  const c=pts.reduce((a,p)=>[a[0]+p[0]/pts.length,a[1]+p[1]/pts.length],[0,0]),fr=G.frame(c[0],c[1]);return G.validateParts(parts.map(p=>({outer:(p.outer||[]).map(q=>fr.toXY(q)),holes:(p.holes||[]).map(h=>h.map(q=>fr.toXY(q)))})))}
function renderAreaSummary(){const box=$('areaSummary');if(!box)return;const parcel=currentParcel();box.textContent='';if(!parcel){box.hidden=true;return}box.hidden=false;
  const res=parcelArea();if(!res){box.hidden=true;return}
  const missing=state.matches.filter(r=>r.sb===null||r.sb===undefined||r.sb==='').length,add=(label,value,cls='')=>{const d=document.createElement('div');d.className='area-item '+cls;const t=document.createElement('span');t.textContent=label;const b=document.createElement('b');b.textContent=value;d.append(t,b);box.append(d)};
  add('المساحة الأصلية',`${fmt(res.original,2)} م²`);
  add('المساحة القابلة للبناء',res.valid?`${fmt(res.buildable,2)} م²`:'تعذّر الحساب','buildable');
  add('الفرق',res.valid?`${fmt(res.difference,2)} م² · ${fmt(res.original>0?res.difference/res.original*100:0,1)}%`:'—');
  // regulatory figures in their own boxes (zone-item), next to the geometric ones
  const Z=zoningSummary(res,missing),MS=window.ZoningRules?.MISSING||'الاشتراط غير محدد';
  const addZ=(label,value,miss)=>{const d=document.createElement('div');d.className='zone-item'+(miss?' miss':'');const t=document.createElement('span');t.textContent=label;const b=document.createElement('b');b.textContent=value;d.append(t,b);box.append(d)};
  if(Z){addZ('حد نسبة التغطية (نظامي)',Z.covPct===null?MS:`${fmt(Z.covTotal,2)} م² · ${fmt(Z.covPct,Z.covPct%1?1:0)}%`,Z.covPct===null);
    addZ('الحد الأعلى للمسطح الأرضي',Z.footprint!==null?`${fmt(Z.footprint,2)} م²${Z.approved?'':' · غير معتمد'}`:Z.footState==='geo-only'?MS:'غير محدد',Z.footprint===null)}
  const n=document.createElement('p');n.className='area-note';
  n.textContent=[!state.matches.length?'لم تُحلل الأضلاع بعد؛ المساحة القابلة للبناء بدون ارتدادات.':missing?`${missing} من ${state.matches.length} أضلاع بدون ارتداد معتمد وتُحسب بصفر.`:'محسوبة بالارتدادات المعتمدة في الجدول.',
    !res.valid?(res.errors||[]).join(' '):'',isMulti()?`الهندسة كاملة: ${parcelParts().length} أجزاء و${parcelParts().reduce((n,p)=>n+(p.holes||[]).length,0)} فراغ؛ خُصمت الفراغات وطُبقت ارتدادات حدودها.`:'',
    'إزاحة هندسية للأضلاع وليست اعتمادًا نظاميًا.',
    Z?`الحد الأعلى للمسطح الأرضي = الأصغر من المساحة القابلة للبناء أعلاه وحد نسبة التغطية${Z.footprint!==null?` (القيد الأقوى: ${Z.binding==='setback'?'الارتدادات':Z.binding==='coverage'?'نسبة التغطية':'متساويان'})`:''}؛ الاشتراطات تُدار من «الاشتراطات التنظيمية» في الصفحة الرئيسية.`:''].filter(Boolean).join(' ');box.append(n)}
function resultsForExport(){const parcel=currentParcel();return{format:'gis-parcel-street-tools-v2',parcel:parcel?.id||'',polygon:parcel?.polygon,signature:state.signature,parcelSignature:state.parcelSignature,
  entries:state.matches.map(r=>({edge:r.edge,key:r.key,part:r.part??0,ring:r.ring||0,localEdge:r.localEdge??r.edge,street:r.name.trim(),width:r.width,widthSource:r.widthSource,measure:r.measure||null,copiedFrom:r.copiedFrom??null,setback:r.sb,setbackSource:r.sbSource,suggestedSetback:calcSb(r.width)?.sb??null,face:r.face,front:r.face==='front',apply:r.accepted&&!!r.name.trim(),status:r.status,roadDistance:r.selected?.avgDistance??null,angle:r.selected?.angle??null})),
  rule:$('rule').value,setbackRule:sbSettings(),searchRadius:nval('radius'),angleLimit:nval('angle'),area:(({original,buildable,difference,valid,errors})=>({original,buildable,difference,valid,errors}))(parcelArea()||{}),geometry:{multi:isMulti(),parts:parcelParts()},parcelId:parcel?.stableId||'',attrs:parcel?.props||{},demo:state.isDemo}}
function download(name,txt,type){const blob=new Blob([txt],{type}),u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1000)}
function exportCSV(){if(!state.matches.length){toast('لا توجد نتائج للتصدير.');return}const ll=p=>p?`${p[1].toFixed(7)} ${p[0].toFixed(7)}`:'';
  const rows=[['رقم الضلع','معرف الضلع','الطول_م','اسم الشارع','عرض الشارع_م','مصدر العرض','نقطة القياس A (lat lon)','نقطة القياس B (lat lon)','الارتداد المعتمد_م','مصدر الارتداد','الارتداد المقترح_م','نوع الواجهة','اعتماد','حالة المطابقة','المسافة_م','انحراف الاتجاه_درجة']];
  state.matches.forEach(r=>rows.push([dispNo(r.edge),r.key,fmt(r.length,3),r.name,r.width??'',r.widthSource?SRC_W[r.widthSource]:'',ll(r.measure?.a),ll(r.measure?.b),r.sb??'',r.sbSource?SRC_SB[r.sbSource]:'',calcSb(r.width)?.sb??'',FACE[r.face]||'',r.accepted?'نعم':'لا',r.status,fmt(r.selected?.avgDistance,2),fmt(r.selected?.angle,2)]));
  const q=v=>'"'+String(v??'').replace(/"/g,'""')+'"';download('parcel_street_matching.csv','﻿'+rows.map(r=>r.map(q).join(',')).join('\r\n'),'text/csv;charset=utf-8')}
function applyBack(){if(!state.matches.length){toast('قم بتحليل الطبقات أولًا.');return}if(state.isDemo){toast('لا يمكن تطبيق البيانات التجريبية على مشروع حقيقي.');return}
  if(!state.signature&&(!state.parcelLayerId||!currentParcel()?.stableId)){toast('لا يوجد معرّف طبقة وقطعة صالحان للعودة.');return}
  const data=resultsForExport();if(!data.entries.some(r=>r.apply)){toast('لم يتم اختيار أي شارع للتطبيق.');return}
  // a multipart parcel goes back only as a whole: valid geometry and one result row with a stable id for every edge of every ring
  if(isMulti()){const errors=geometryErrors(),n=edgeCount(),ids=state.matches.map(r=>G.parseEdgeId(r.key));
    if(errors.length){alert('لا يمكن تطبيق النتائج على المخطط الرئيسي: هندسة القطعة غير مدعومة بالكامل.\n'+errors.join('\n'));return}
    if(state.matches.length!==n||ids.some((id,i)=>!id||id.parcelId!==(currentParcel()?.stableId||'parcel')||state.matches[i].key!==edgeKeyAt(i))){alert('لا يمكن تطبيق النتائج: لا تغطي النتائج كل أضلاع أجزاء القطعة وفراغاتها. اضغط «تحليل وربط الأضلاع» ثم أعد المحاولة.');return}}
  saveStore();
  const parcel=currentParcel(),result={signature:state.signature,parcelSignature:state.parcelSignature,parcelId:parcel?.stableId||'',layerId:state.parcelLayerId,roadLayerId:state.roadLayerId,
    polygon:parcel?.polygon,geometry:{multi:isMulti(),parts:parcelParts()},attrs:parcel?.props||{},parcel:data.parcel,entries:data.entries};
  const token=globalThis.crypto?.randomUUID?.()||`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  try{sessionStorage.setItem(KEY_OUT,JSON.stringify({token,data:result}))}catch(e){toast('تعذر حفظ النتائج في مخزن الجلسة. لم يتم الرجوع لتجنب فقدان البيانات.');return}
  const url=new URL('index.html',location.href);url.searchParams.set('streetResult',token);location.href=url.href}
function mapFrame(){const points=parcelParts().flatMap(part=>part.outer);if(!points.length)return null;const c=points.reduce((a,p)=>[a[0]+p[0]/points.length,a[1]+p[1]/points.length],[0,0]);return G.frame(...c)}
function fitMap(force){const points=parcelParts().flatMap(part=>part.outer);if(!points.length)return;if(state.view&&!force&&state.center)return;
  const f=mapFrame(),pts=points.map(p=>f.toXY(p)),xs=pts.map(p=>p.x),ys=pts.map(p=>p.y);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  state.frame=f;state.center={x:(minX+maxX)/2,y:(minY+maxY)/2};state.view={scale:Math.max(1,(Math.max(maxX-minX,maxY-minY,25)+95)),offsetX:0,offsetY:0};
  if(state.mode==='satellite'&&state.map){state.map.fitBounds(points.map(p=>[p[1],p[0]]),{padding:[80,80],maxZoom:19})}}
function fitParcelLayer(){const grid=state.parcelSpatial;if(!grid)return;const points=grid.projected.flatMap(parts=>parts.flatMap(part=>part.outer));if(!points.length)return;
  const xs=points.map(p=>p.x),ys=points.map(p=>p.y),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys),canvas=$('vector-map'),w=canvas.clientWidth,h=canvas.clientHeight,short=Math.min(w,h);
  state.frame=grid.frame;state.center={x:(minX+maxX)/2,y:(minY+maxY)/2};state.view={scale:Math.max((maxX-minX+50)*short/Math.max(1,w-48),(maxY-minY+50)*short/Math.max(1,h-48),10),offsetX:0,offsetY:0};
  if(state.mode==='satellite'&&state.map){const bounds=state.parcels.flatMap(p=>parcelParts(p).flatMap(part=>part.outer)).map(p=>[p[1],p[0]]);state.map.fitBounds(bounds,{padding:[50,50],maxZoom:18});state.map._streetFit=true}else renderVector()}
function canvasSize(){const c=$('vector-map'),rc=c.getBoundingClientRect(),d=window.devicePixelRatio||1;c.width=Math.max(1,Math.round(rc.width*d));c.height=Math.max(1,Math.round(rc.height*d));const x=c.getContext('2d');x.setTransform(d,0,0,d,0,0);return{x,w:rc.width,h:rc.height}}
const roadBoxes=new WeakMap();
function roadBounds(road){let b=roadBoxes.get(road);if(!b){b=[Infinity,Infinity,-Infinity,-Infinity];for(const p of road.geometry?.coordinates||[]){b[0]=Math.min(b[0],p[0]);b[1]=Math.min(b[1],p[1]);b[2]=Math.max(b[2],p[0]);b[3]=Math.max(b[3],p[1])}roadBoxes.set(road,b)}return b}
function renderVector(){if(state.mode==='satellite')return;const {x,w,h}=canvasSize();x.clearRect(0,0,w,h);x.fillStyle='#eaf0e9';x.fillRect(0,0,w,h);
  x.strokeStyle='#dbe5d9';x.lineWidth=1;for(let k=-h;k<w+h;k+=70){x.beginPath();x.moveTo(k,0);x.lineTo(k+h*.30,h);x.stroke()}for(let k=0;k<h;k+=80){x.beginPath();x.moveTo(0,k);x.lineTo(w,k);x.stroke()}
  const f=state.frame,view=state.view;if(!f||!view)return;
  const base=Math.min(w,h)/view.scale,scale=base;
  const toPx=q=>{const p=f.toXY(q);return{x:w/2+(p.x-state.center.x)*scale+view.offsetX,y:h/2-(p.y-state.center.y)*scale+view.offsetY}};
  function line(coords,color,weight){const pts=coords.map(toPx);if(pts.length<2)return;x.beginPath();pts.forEach((p,i)=>i?x.lineTo(p.x,p.y):x.moveTo(p.x,p.y));x.strokeStyle=color;x.lineWidth=weight;x.lineJoin='round';x.lineCap='round';x.stroke()}
  const drawArea=(part,fill,stroke,weight)=>{const outer=part.outer.map(toPx);x.beginPath();outer.forEach((p,i)=>i?x.lineTo(p.x,p.y):x.moveTo(p.x,p.y));x.closePath();
    (part.holes||[]).forEach(ring=>{const pts=ring.map(toPx);pts.forEach((p,i)=>i?x.lineTo(p.x,p.y):x.moveTo(p.x,p.y));x.closePath()});x.fillStyle=fill;x.fill('evenodd');x.strokeStyle=stroke;x.lineWidth=weight;x.stroke()};
  parcelsInView(w,h,scale).forEach(index=>{if(index===state.selected)return;parcelParts(state.parcels[index]).forEach(part=>drawArea(part,'rgba(87,128,99,.035)','#9daf9f',1.2))});
  const view_ll=[[0,0],[w,0],[w,h],[0,h]].map(([px,py])=>f.toLL(screenWorld(px,py,w,h,scale))),vb=[Math.min(...view_ll.map(p=>p[0])),Math.min(...view_ll.map(p=>p[1])),Math.max(...view_ll.map(p=>p[0])),Math.max(...view_ll.map(p=>p[1]))];
  state.roads.forEach(road=>{const b=roadBounds(road);if(b[2]<vb[0]||b[0]>vb[2]||b[3]<vb[1]||b[1]>vb[3])return;line(road.geometry.coordinates,'#bba98b',3)});
  const parts=parcelParts();if(!parts.length)return;parts.forEach(part=>drawArea(part,'rgba(51,136,87,.15)','#176346',2.7));
  const matchMap=new Map(state.matches.map(m=>[m.edge,m]));let edgeIndex=0;
  edgeRings().forEach(ringInfo=>{const pts=ringInfo.pts.map(toPx);pts.forEach((p,i)=>{const q=pts[(i+1)%pts.length],mx=(p.x+q.x)/2,my=(p.y+q.y)/2,isSel=edgeIndex===state.selection,m=matchMap.get(edgeIndex);
    x.beginPath();x.moveTo(p.x,p.y);x.lineTo(q.x,q.y);x.strokeStyle=isSel?'#2388c1':(m?.selected?'#1f7d5c':'#b16a44');x.lineWidth=isSel?5.5:3;x.stroke();
    x.beginPath();x.arc(mx,my,12,0,Math.PI*2);x.fillStyle=isSel?'#2388c1':'#fff';x.fill();x.strokeStyle='#abc9b8';x.lineWidth=1;x.stroke();x.fillStyle=isSel?'#fff':'#1b583d';x.textAlign='center';x.textBaseline='middle';x.font='700 11px Arial';x.fillText(String(dispNo(edgeIndex)),mx,my);
    if(m?.name){let vx=q.y-p.y,vy=-(q.x-p.x),l=Math.hypot(vx,vy)||1;const tx=mx+vx/l*32,ty=my+vy/l*32;x.font='600 11px "IBM Plex Sans Arabic",Tahoma';const name=m.name.length>30?m.name.slice(0,30)+'…':m.name;const bw=x.measureText(name).width+16;
      x.fillStyle='rgba(255,255,255,.93)';x.fillRect(tx-bw/2,ty-11,bw,23);x.strokeStyle='#dae5da';x.strokeRect(tx-bw/2,ty-11,bw,23);x.fillStyle='#175a43';x.fillText(name,tx,ty+2)}edgeIndex++})});
  // saved width measurement of the selected edge, for review (it is taken on the satellite view)
  const sm=state.matches[state.selection]?.measure;if(sm?.a&&sm.b){const a=toPx(sm.a),b=toPx(sm.b);x.save();x.lineCap='round';
    x.beginPath();x.moveTo(a.x,a.y);x.lineTo(b.x,b.y);x.strokeStyle='rgba(20,26,23,.55)';x.lineWidth=6;x.stroke();x.setLineDash([7,6]);x.strokeStyle='#ffc93c';x.lineWidth=3;x.stroke();x.setLineDash([]);
    const t=`${fixed2(state.matches[state.selection].measure.distance)} م`;x.font='600 12px "IBM Plex Mono",monospace';const tw=x.measureText(t).width+14,mx=(a.x+b.x)/2,my=(a.y+b.y)/2-18;
    x.fillStyle='#141a17';x.fillRect(mx-tw/2,my-10,tw,20);x.fillStyle='#ffc93c';x.textAlign='center';x.textBaseline='middle';x.fillText(t,mx,my+1);x.restore()}
  // north arrow
  x.save();x.translate(w-35,36);x.fillStyle='#195a42';x.strokeStyle='#195a42';x.lineWidth=2;x.beginPath();x.moveTo(0,-16);x.lineTo(-8,9);x.lineTo(0,5);x.lineTo(8,9);x.closePath();x.fill();x.font='700 11px Arial';x.textAlign='center';x.fillText('N',0,-23);x.restore();
  x.font='11px "IBM Plex Sans Arabic",Tahoma';x.textAlign='left';x.fillStyle='#536a59';x.fillText('مخطط متري · لا يمثل عرض الطرق على الطبيعة',16,h-18);
}
function renderLeaflet(){if(state.mode!=='satellite')return;if(!window.L){toast('العرض الفضائي يحتاج تحميل مكتبة Leaflet من الإنترنت. استخدم «مخطط» بدلاً منها.');state.mode='vector';setViewButtons();renderVector();return}
  if(!state.map){const map=L.map('leaflet-map',{zoomControl:false,preferCanvas:true});state.map=map;L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxNativeZoom:19,maxZoom:21,attribution:'Esri, Maxar, Earthstar Geographics'}).addTo(map);state.baseLayer=L.layerGroup().addTo(map);state.layers=L.layerGroup().addTo(map);
    state.mLayer=L.layerGroup().addTo(map);map.on('click',onMapClick);map.on('mousemove',onMapMove);map.on('zoomend',()=>{if(state.measure.active)syncMeasureUI()})}
  // while measuring, parcel and road layers ignore the mouse so every click lands on the map as a measure point
  const map=state.map,M=state.measure,live=!(M.active&&M.mode==='measure');state.layers.clearLayers();
  if(state.baseParcels!==state.parcels||state.baseRoads!==state.roads){state.baseLayer.clearLayers();state.baseParcels=state.parcels;state.baseRoads=state.roads;
    state.roads.forEach(r=>L.polyline(r.geometry.coordinates.map(p=>[p[1],p[0]]),{color:'#d1a35c',weight:3,opacity:.9,interactive:false}).addTo(state.baseLayer));
    // clicks while measuring belong to the measurement (they bubble to the map), never to parcel selection
    state.parcels.forEach((parcel,index)=>parcelParts(parcel).forEach(part=>{const rings=[part.outer,...(part.holes||[])].map(r=>r.map(p=>[p[1],p[0]]));if(!rings[0]||rings[0].length<3)return;
      L.polygon(rings,{color:'#90a997',weight:1.5,fillColor:'#789b80',fillOpacity:.035}).addTo(state.baseLayer).on('click',()=>{if(state.measure.active)return;if(index!==state.selected)selectParcel(index)})}))}
  if(M.active)map.doubleClickZoom.disable();else map.doubleClickZoom.enable();
  const parts=parcelParts();if(parts.length){parts.forEach(part=>{const rings=[part.outer,...(part.holes||[])].map(r=>r.map(p=>[p[1],p[0]]));if(rings[0]?.length>=3)L.polygon(rings,{color:'#176346',weight:3,fillColor:'#16834d',fillOpacity:.16,interactive:false}).addTo(state.layers)});
    let edgeIndex=0;edgeRings().forEach(ringInfo=>{const ring=ringInfo.pts;ring.forEach((p,i)=>{const at=edgeIndex,q=ring[(i+1)%ring.length],seg=[p,q].map(v=>[v[1],v[0]]),selected=at===state.selection,m=state.matches[at];
      if(selected&&M.active)L.polyline(seg,{color:'#39a8ee',weight:16,opacity:.35,interactive:false}).addTo(state.layers);
      L.polyline(seg,{color:selected?'#39a8ee':m?.selected?'#39a783':'#cb9365',weight:selected?7:4,interactive:live}).addTo(state.layers).on('click',()=>selectEdge(at));
      L.marker([(p[1]+q[1])/2,(p[0]+q[0])/2],{interactive:false,keyboard:false,icon:L.divIcon({html:`<span style="border:1px solid #b4d0be;border-radius:50%;background:white;color:#15513e;display:grid;place-items:center;width:23px;height:23px;font:700 11px Arial">${dispNo(at)}</span>`,iconSize:[23,23],className:''})}).addTo(state.layers);edgeIndex++})})
  }else map.setView([21.4255,39.8236],16);
  renderMeasure();
  setTimeout(()=>{map.invalidateSize();if(parts.length&&!map._streetFit){const points=parts.flatMap(p=>p.outer).map(p=>[p[1],p[0]]);map.fitBounds(points,{padding:[80,80],maxZoom:19});map._streetFit=true}},30)}
function renderMap(){if(state.mode==='satellite')renderLeaflet();else renderVector()}
function setViewButtons(){$('vectorView').classList.toggle('active',state.mode==='vector');$('satelliteView').classList.toggle('active',state.mode==='satellite');$('vector-map').hidden=state.mode!=='vector';$('leaflet-map').hidden=state.mode!=='satellite'}
function setMode(mode){if(mode==='vector'&&state.measure.active&&state.measure.mode==='measure'){endMeasure();toast('أُلغي القياس: قياس عرض الشارع يتم على الصورة الفضائية فقط.')}
  state.mode=mode;setViewButtons();renderMap()}
function zoom(factor){if(state.mode==='satellite'){if(state.map)state.map.setZoom(state.map.getZoom()+(factor>1?1:-1));return}if(!state.view)return;state.view.scale=Math.min(3000,Math.max(10,state.view.scale/factor));renderVector()}
/* ---- Street width measurement: two points on opposite street edges, satellite view only ---- */
// WGS84 ellipsoidal distance: the same model as edge lengths, areas and the main planner. Never planar degrees.
const llDist=(a,b)=>G.distance(a,b);
function fixed2(v){return Number.isFinite(v)?v.toFixed(2):'—'}
function metresPerPixel(){if(!state.map||!state.map._loaded)return null;const c=state.map.getCenter();return 40075016.686*Math.cos(c.lat*Math.PI/180)/Math.pow(2,state.map.getZoom()+8)}
function edgeLatLngs(i){const e=edgeAt(i);if(!e)return[];return[e.a,e.b].map(v=>[v[1],v[0]])}
function measuredDistance(){const M=state.measure;return M.a&&M.b?llDist(M.a,M.b):null}
function currentValue(){const M=state.measure;if(M.mode==='manual')return G.parseWidth($('mpInput').value);return M.override??measuredDistance()}
function requireEdge(){if(!state.matches.length){toast('حلّل الطبقات أولًا، ثم اختر الضلع من جدول «مراجعة ارتباط الأضلاع».');return false}
  if(state.selection<0){toast('اختر ضلع قطعة الأرض من جدول «مراجعة ارتباط الأضلاع» أولًا.');const t=document.querySelector('.results-card');t.classList.remove('pick');void t.offsetWidth;t.classList.add('pick');return false}return true}
function zoomToEdge(i){if(!state.map)return;state.map._streetFit=true;
  setTimeout(()=>{state.map.invalidateSize();const r=state.matches[i],pts=edgeLatLngs(i);if(r?.measure?.a)pts.push([r.measure.a[1],r.measure.a[0]],[r.measure.b[1],r.measure.b[0]]);
    state.map.fitBounds(pts,{padding:[110,110],maxZoom:20})},60)}
function startMeasure(){if(!requireEdge())return;
  if(!window.L){toast('القياس يحتاج الصورة الفضائية (مكتبة Leaflet من الإنترنت). استخدم «إدخال العرض يدويًا».');return}
  const M=state.measure,i=state.selection,r=state.matches[i];
  // editing an approved measurement starts from its saved points, so either end can be dragged
  Object.assign(M,{active:true,mode:'measure',edge:i,a:r.measure?.a?.slice()||null,b:r.measure?.b?.slice()||null,hover:null,override:null,share:null});
  $('mpInput').value='';if(state.mode!=='satellite')setMode('satellite');else renderMap();zoomToEdge(i);syncMeasureUI()}
function startManual(){if(!requireEdge())return;const M=state.measure,i=state.selection,r=state.matches[i];
  Object.assign(M,{active:true,mode:'manual',edge:i,a:null,b:null,hover:null,override:null,share:null});
  $('mpInput').value=r.width??'';renderMap();syncMeasureUI();$('mpInput').focus();$('mpInput').select()}
function retargetMeasure(i){const M=state.measure,r=state.matches[i];M.edge=i;M.override=null;M.hover=null;
  if(M.mode==='measure'){M.a=r.measure?.a?.slice()||null;M.b=r.measure?.b?.slice()||null;$('mpInput').value='';zoomToEdge(i)}else $('mpInput').value=r.width??'';syncMeasureUI()}
function resetMeasure(){const M=state.measure;M.a=M.b=M.hover=null;M.override=null;$('mpInput').value='';renderMeasure();syncMeasureUI()}
function endMeasure(){Object.assign(state.measure,{active:false,mode:'',edge:-1,a:null,b:null,hover:null,override:null,share:null});syncMeasureUI();if(state.map)renderLeaflet()}
function reviewMeasure(i){selectEdge(i);if(!window.L){toast('عرض القياس على الصورة الفضائية يحتاج مكتبة Leaflet من الإنترنت.');return}
  if(state.mode!=='satellite')setMode('satellite');zoomToEdge(i)}
function onMapClick(e){const M=state.measure;if(!M.active||M.mode!=='measure'||(M.a&&M.b))return;const p=[e.latlng.lng,e.latlng.lat];
  if(!M.a)M.a=p;else{M.b=p;M.hover=null}M.override=null;renderMeasure();syncMeasureUI()}
function onMapMove(e){const M=state.measure;if(!M.active||M.mode!=='measure'||!M.a||M.b)return;M.hover=[e.latlng.lng,e.latlng.lat];
  if(state.mParts)updateMeasureLine();else renderMeasure();syncMeasureUI()}
const labelIcon=(d,saved)=>L.divIcon({className:'m-label'+(saved?' saved':''),html:`<span>${fixed2(d)} م</span>`,iconSize:[0,0]});
function drawMeasureLine(a,b,dashed,saved){const ll=[[a[1],a[0]],[b[1],b[0]]];
  const casing=L.polyline(ll,{color:'#141a17',weight:7,opacity:saved?.45:.7,interactive:false,lineCap:'butt'}).addTo(state.mLayer);
  const line=L.polyline(ll,{color:'#ffc93c',weight:3,opacity:1,dashArray:dashed?'7 6':null,interactive:false,lineCap:'butt'}).addTo(state.mLayer);
  const label=L.marker([(a[1]+b[1])/2,(a[0]+b[0])/2],{interactive:false,keyboard:false,icon:labelIcon(llDist(a,b),saved)}).addTo(state.mLayer);state.mParts={casing,line,label}}
function updateMeasureLine(){const M=state.measure,P=state.mParts,end=M.b||M.hover;if(!P||!M.a||!end)return;const ll=[[M.a[1],M.a[0]],[end[1],end[0]]];
  P.casing.setLatLngs(ll);P.line.setLatLngs(ll);P.label.setLatLng([(ll[0][0]+ll[1][0])/2,(ll[0][1]+ll[1][1])/2]);P.label.setIcon(labelIcon(llDist(M.a,end),false))}
function renderMeasure(){if(!state.mLayer)return;state.mLayer.clearLayers();state.mParts=null;const M=state.measure;
  if(M.active&&M.mode==='measure'){const end=M.b||M.hover;if(M.a&&end)drawMeasureLine(M.a,end,!M.b,false);
    [M.a,M.b].forEach((p,k)=>{if(!p)return;const h=L.marker([p[1],p[0]],{draggable:true,keyboard:false,bubblingMouseEvents:false,zIndexOffset:1000,title:'اسحب لتعديل القياس',
        icon:L.divIcon({className:'m-handle',html:`<span>${k?'B':'A'}</span>`,iconSize:[20,20],iconAnchor:[10,10]})}).addTo(state.mLayer);
      h.on('drag',ev=>{const q=ev.target.getLatLng(),pt=[q.lng,q.lat];if(k)M.b=pt;else M.a=pt;M.override=null;if(!state.mParts&&M.a&&(M.b||M.hover))drawMeasureLine(M.a,M.b||M.hover,!M.b,false);updateMeasureLine();syncMeasureUI()})});return}
  const r=state.matches[state.selection];if(r?.measure?.a&&r.measure.b)drawMeasureLine(r.measure.a,r.measure.b,true,true)}
const norm=s=>String(s||'').trim().replace(/\s+/g,' ');
function sameStreetEdges(i){const r=state.matches[i],n=norm(r.name),road=r.selected?.roadIndex;
  return state.matches.map((m,j)=>j).filter(j=>j!==i&&((n&&norm(state.matches[j].name)===n)||(road!=null&&state.matches[j].selected?.roadIndex===road)))}
function approveWidth(){const M=state.measure,i=M.edge,r=state.matches[i];if(!r)return;const d=currentValue();
  if(!(d>0&&d<300)){toast(M.mode==='measure'&&!(M.a&&M.b)?'حدد نقطتي القياس على حافتي الشارع أولًا.':'أدخل عرضًا موجبًا بالمتر (أقل من 300 م).');return}
  const w=Math.round(d*100)/100,measured=M.mode==='measure'&&M.a&&M.b;
  if(measured)r.measure={a:M.a.map(v=>+v.toFixed(8)),b:M.b.map(v=>+v.toFixed(8)),distance:+measuredDistance().toFixed(2),approx:true,source:'satellite',
    zoom:state.map?.getZoom()??null,mpp:metresPerPixel()===null?null:+metresPerPixel().toFixed(3),at:new Date().toISOString()};
  // a value typed over a measurement is a manual width; the measurement stays as reference
  const src=measured&&M.override===null?'measured':'manual';setWidth(r,w,src);saveStore();renderTable();
  const others=sameStreetEdges(i);
  if(others.length){M.share={from:i,width:w,src,edges:others};M.mode='share';M.hover=null;renderMap();syncMeasureUI();return}
  endMeasure();toast(`تم اعتماد عرض ${fixed2(w)} م للضلع ${dispNo(i)}${r.sb!==null?` · الارتداد ${fixed2(r.sb)} م`:''}.`)}
function applyShare(copy){const s=state.measure.share;if(!s)return;const picked=copy?[...document.querySelectorAll('#mpShareList input:checked')].map(cb=>+cb.value):[];
  picked.forEach(j=>{const r=state.matches[j];if(!r)return;setWidth(r,s.width,s.src);r.measure=null;r.copiedFrom=s.from});
  saveStore();renderTable();endMeasure();toast(picked.length?`تم نسخ العرض ${fixed2(s.width)} م إلى الأضلاع: ${picked.map(j=>dispNo(j)).join('، ')}.`:`تم اعتماد العرض للضلع ${dispNo(s.from)} فقط.`)}
function syncMeasureUI(){const M=state.measure,on=M.active,measuring=on&&M.mode==='measure';
  $('map-box').classList.toggle('measuring',measuring);$('measureBtn').classList.toggle('active',measuring);$('measureBtn').setAttribute('aria-pressed',String(measuring));
  $('manualWidthBtn').classList.toggle('active',on&&M.mode==='manual');$('manualWidthBtn').setAttribute('aria-pressed',String(on&&M.mode==='manual'));
  const hint=!measuring?'':!M.a?'انقر النقطة الأولى (A) على حافة الشارع':!M.b?'انقر النقطة الثانية (B) على الحافة المقابلة':'اسحب النقطة A أو النقطة B لضبط القياس، ثم اضغط «اعتماد العرض»';
  $('measureHint').hidden=!hint;$('measureHint').textContent=hint;$('measurePanel').hidden=!on;if(!on)return;
  const r=state.matches[M.edge],share=M.mode==='share',d=share?M.share.width:currentValue(),measured=measuredDistance();
  $('mpTitle').textContent=share?'نسخ العرض لأضلاع الشارع نفسه':M.mode==='measure'?'قياس عرض الشارع':'إدخال العرض يدويًا';
  $('mpEdge').textContent=dispNo(M.edge);$('mpStreet').textContent=norm(r?.name)||'شارع غير مسمى — اكتب الاسم في الجدول';$('mpDist').textContent=fixed2(d);
  $('mpSrc').textContent=share?SRC_W[M.share.src]:M.mode==='manual'?'إدخال يدوي':M.override!==null?`معدّل يدويًا · القياس ${fixed2(measured)} م`:measured!==null?'مقاس من الخريطة':M.a&&M.hover?'معاينة…':'';
  const mpp=metresPerPixel(),ap=$('mpApprox');ap.hidden=M.mode!=='measure';
  ap.classList.toggle('warn',mpp!==null&&mpp>.6);
  $('mpApproxText').textContent=`قياس تقريبي من الصورة الفضائية${mpp!==null?` · دقة العرض ≈ ${fixed2(mpp)} م/بكسل`:''}${mpp!==null&&mpp>.6?' · كبّر الخريطة لدقة أفضل':''}`;
  $('mpEdit').hidden=share;$('mpActions').hidden=share;$('mpShare').hidden=!share;$('mpReset').hidden=M.mode!=='measure';
  $('mpInputLabel').textContent=M.mode==='manual'?'عرض الشارع':'تعديل العرض يدويًا';
  if(M.mode==='measure'&&document.activeElement!==$('mpInput'))$('mpInput').value=M.override!==null?M.override:measured!==null?measured.toFixed(2):'';
  $('mpApprove').disabled=!(d>0&&d<300);
  const c=share?null:calcSb(d),method=$('rule').value;
  $('mpSb').textContent=r?.sbSource==='manual'?`الارتداد مُدخل يدويًا (${fixed2(r.sb)} م) ولن يتغير.`:method==='manual'?'طريقة الارتداد: إدخال يدوي — أدخله في الجدول.':c?`الارتداد المقترح: ${fixed2(c.sb)} م · ${SRC_SB[c.src]}`:share?'':'الارتداد المقترح: —';
  if(share&&!M.share.built){const s=M.share;s.built=true;$('mpShareText').textContent=`الشارع «${norm(r?.name)||'—'}» مرتبط أيضًا بالأضلاع التالية. اختر الأضلاع التي تريد نسخ العرض ${fixed2(s.width)} م إليها:`;
    const list=$('mpShareList');list.textContent='';s.edges.forEach(j=>{const m=state.matches[j],lab=document.createElement('label'),cb=document.createElement('input');cb.type='checkbox';cb.value=j;cb.checked=!(m.width>0);
      const t=document.createElement('span');t.textContent=`الضلع ${dispNo(j)} — ${m.width>0?`العرض الحالي ${fixed2(m.width)} م (${SRC_W[m.widthSource]||'—'})`:'بدون عرض'}`;lab.append(cb,t);list.append(lab)})}}
let dragging=false,start=null,wasDragged=false;
$('vector-map').addEventListener('pointerdown',e=>{if(state.mode!=='vector'||!state.view)return;dragging=true;wasDragged=false;start={x:e.clientX,y:e.clientY,dx:state.view.offsetX,dy:state.view.offsetY};try{$('vector-map').setPointerCapture(e.pointerId)}catch(_){}});
$('vector-map').addEventListener('pointermove',e=>{if(!dragging||!start)return;const dx=e.clientX-start.x,dy=e.clientY-start.y;if(Math.hypot(dx,dy)>3)wasDragged=true;if(!wasDragged)return;state.view.offsetX=start.dx+dx;state.view.offsetY=start.dy+dy;renderVector()});
$('vector-map').addEventListener('pointerup',()=>{dragging=false;start=null});$('vector-map').addEventListener('pointercancel',()=>{dragging=false;start=null;wasDragged=false});
$('vector-map').addEventListener('click',e=>{if(state.mode!=='vector'||wasDragged||!state.view)return;const rect=$('vector-map').getBoundingClientRect(),width=rect.width,height=rect.height,scale=Math.min(width,height)/state.view.scale,index=parcelAtScreen(e.clientX-rect.left,e.clientY-rect.top,width,height,scale);wasDragged=false;if(index>=0&&index!==state.selected)selectParcel(index)});
$('vector-map').addEventListener('wheel',e=>{if(state.mode==='vector'){e.preventDefault();zoom(e.deltaY<0?1.17:1/1.17)}},{passive:false});
$('zoomIn').onclick=()=>zoom(1.2);$('zoomOut').onclick=()=>zoom(1/1.2);$('fitMap').onclick=()=>{fitMap(true);if(state.map)state.map._streetFit=false;renderMap()};$('fitLayer').onclick=fitParcelLayer;
$('vectorView').onclick=()=>setMode('vector');$('satelliteView').onclick=()=>setMode('satellite');
$('parcelSearch').addEventListener('input',updateParcelChoices);
$('parcelSearch').addEventListener('keydown',e=>{if(e.key!=='Enter')return;e.preventDefault();const q=$('parcelSearch').value.trim().toLocaleLowerCase();if(!q)return;
  let at=state.parcels.findIndex(p=>String(p.id).toLocaleLowerCase()===q);if(at<0)at=state.parcels.findIndex(p=>p.searchText.includes(q));
  if(at<0){toast('لا توجد قطعة مطابقة للبحث.');return}if(at!==state.selected)selectParcel(at);else toast(`القطعة ${currentParcel().id} محددة بالفعل.`)});
$('parcelFile').onchange=e=>{const file=e.target.files[0];handleFile(file,'parcel');e.target.value=''};
$('roadFile').onchange=e=>{const file=e.target.files[0];handleFile(file,'roads');e.target.value=''};
$('parcelSelect').onchange=e=>selectParcel(e.target.value);
for(const kind of ['road','parcel']){const label=document.querySelector(`label[for=${kind}File]`);label.addEventListener('dragover',e=>{e.preventDefault();label.classList.add('dragging')});label.addEventListener('dragleave',()=>label.classList.remove('dragging'));label.addEventListener('drop',e=>{e.preventDefault();label.classList.remove('dragging');handleFile(e.dataTransfer.files[0],kind==='road'?'roads':'parcel')})}
$('analyze').onclick=analyze;$('demo').onclick=fillDemo;
$('clear').onclick=()=>{if(state.matches.some(r=>r.widthSource==='measured'||r.widthSource==='manual')&&!confirm('سيتم مسح نتائج الربط والعروض المقاسة أو المدخلة يدويًا لهذه القطعة. هل تريد المتابعة؟'))return;
  deleteEntry(projectKey());
  state.matches=[];state.selection=-1;endMeasure();refresh();toast('تم مسح النتائج والقياسات المحفوظة لهذه القطعة. بقيت الطبقات محملة.')};
$('exportCSV').onclick=exportCSV;$('downloadJSON').onclick=()=>{if(!state.matches.length)return toast('حلل الطبقات أولًا.');download('street_matching.json',JSON.stringify(resultsForExport(),null,2),'application/json;charset=utf-8')};$('sendBack').onclick=applyBack;
// Setback settings only recalculate setbacks; they no longer re-run the analysis and discard measured widths.
for(const id of ['rule','ratio','minimum','maximum','rounding','fixed','ruleSource'])$(id).addEventListener('input',onRuleChange);
$('measureBtn').onclick=()=>{if(state.measure.active&&state.measure.mode==='measure')endMeasure();else startMeasure()};
$('manualWidthBtn').onclick=()=>{if(state.measure.active&&state.measure.mode==='manual')endMeasure();else startManual()};
$('mpReset').onclick=resetMeasure;$('mpApprove').onclick=approveWidth;$('mpShareYes').onclick=()=>applyShare(true);$('mpShareNo').onclick=()=>applyShare(false);
$('mpCancel').onclick=$('mpClose').onclick=()=>{if(state.measure.mode==='share')applyShare(false);else endMeasure()};
$('mpInput').addEventListener('input',()=>{const M=state.measure;if(M.mode==='measure'){const v=G.parseWidth($('mpInput').value),m=measuredDistance();M.override=v!==null&&!(m!==null&&Math.abs(v-m)<.005)?v:null}syncMeasureUI()});
$('mpInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();approveWidth()}});
$('mpChips').addEventListener('click',e=>{const b=e.target.closest('[data-w]');if(!b)return;$('mpInput').value=b.dataset.w;$('mpInput').dispatchEvent(new Event('input'))});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&state.measure.active){e.preventDefault();if(state.measure.mode==='share')applyShare(false);else endMeasure()}});
window.addEventListener('resize',()=>renderMap());
// «العودة للمخطط الرئيسي» keeps what is on screen for the selected parcel (including strong matches approved automatically,
// which the quiet auto-analysis does not store), so the planner's transaction form can read it. Navigation waits for the save (≤ 2 s).
document.querySelector('.top-link')?.addEventListener('click',e=>{if(state.isDemo||!state.matches.length||!currentParcel())return;
  const saving=Promise.resolve(saveStore()).catch(()=>{});if(e.button!==0||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;
  e.preventDefault();const href=e.currentTarget.href;Promise.race([saving,new Promise(r=>setTimeout(r,2000))]).then(()=>{location.href=href})});
loadSettings();syncRuleControls();refresh();
(async()=>{await loadStoreCache();loadPayload();await restoreStoredLayers();if(!state.parcels.length)refresh()})().catch(error=>{console.error('Street Tools start-up:',error);toast('تعذر استرجاع البيانات المحفوظة: '+error.message)});
})();
