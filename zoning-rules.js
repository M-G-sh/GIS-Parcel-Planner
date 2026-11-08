/* Zoning requirements («الاشتراطات التنظيمية»): pure calculations shared by the main planner and «مزيد».
   Nothing here invents a requirement. A value that is missing or invalid stays null and is shown as «الاشتراط غير محدد»;
   a value without an official reference and the status «معتمد» is never reported as approved.
   Ground footprint, total floor area and FAR are kept apart:
     footprint limit = min(area inside the approved setbacks, land area × coverage % + documented coverage exceptions)
     total floor area = min(footprint × floors, land area × FAR) when both apply (one of them when only it applies)
   Usable in the browser (window.ZoningRules) and in Node (module.exports). */
(function(root){
  'use strict';
  const USES={residential:'سكني',commercial:'تجاري',mixed:'مختلط',mosque:'مسجد',public:'مرافق عامة',other:'أخرى'};
  const STATUS={approved:'معتمد',review:'قيد المراجعة',draft:'مسودة',unverified:'غير متحقق منه'};
  const EXC={cover:'مسطح أرضي مستثنى من نسبة التغطية',gross:'مسطحات لا تُحتسب ضمن مسطحات الأدوار / FAR',note:'استثناء نصي (بدون أثر حسابي)'};
  const EXC_SHORT={cover:'خارج نسبة التغطية',gross:'خارج المسطحات / FAR',note:'نصي فقط'};
  // scope of a saved rule, from the widest to the narrowest; a rule saved at one level holds every wider level too
  const SCOPE_CHAIN=['city','amana','municipality','district','planNo'];
  const SCOPE_LABEL={city:'المدينة',amana:'الأمانة',municipality:'البلدية',district:'الحي',planNo:'المخطط'};
  const MISSING='الاشتراط غير محدد';
  const RULES_KEY='gis-parcel-planner-zoning-rules-v1';
  // fields a rule carries (the parcel's own location and use are never overwritten by a rule)
  const RULE_FIELDS=['ratio','upRatio','floors','height','far','farNA','parkPct','parkTxt','special','zExc','zRef','zRefDate','zStatus'];

  /* ---------- user rules («قواعد المستخدم»): supplied by the user, NOT documented official requirements ----------
     front setback = street width ÷ div, at least min and at most max (default ⅕, 3 … 6 m); no width → null (never a guessed width)
     side / rear   = the parcel's own field (SIDEDEFECT / REARDEFECT); empty or missing → 0, flagged as undocumented;
                     an explicit 0 in the data stays 0 and is documented
     ground floor  = ground % of the land area · each upper floor = upper % of the land area, both inside the buildable zone */
  const USER_RULES={on:true,div:5,min:3,max:6,ground:65,upper:75};
  function userCfg(c){const d=USER_RULES,n=(v,def)=>{const x=num(v);return x===null?def:x};c=c||{};
    return{on:c.on!==false,div:n(c.div,d.div)>0?n(c.div,d.div):d.div,min:Math.max(0,n(c.min,d.min)),max:Math.max(0,n(c.max,d.max)),ground:n(c.ground,d.ground),upper:n(c.upper,d.upper)}}
  function userFront(width,cfg){const c=userCfg(cfg),w=num(width);if(w===null||!(w>0))return null;
    const lo=Math.min(c.min,c.max),hi=Math.max(c.min,c.max);return Math.round(Math.min(hi,Math.max(lo,w/c.div))*100)/100}
  // value of a side / rear field: {sb, documented}; '' / null / not a number → 0 undocumented
  function userEdgeSb(raw){const v=num(raw);return v!==null&&v>=0?{sb:v,documented:true}:{sb:0,documented:false}}

  // number typed in Arabic or Latin digits, with ٫ or ، as decimal mark, , or ٬ as thousands separator and an optional % sign
  // (the same reading as the transaction form's txNumber); anything else → null
  function num(v){if(typeof v==='number')return Number.isFinite(v)?v:null;
    const s=String(v??'').trim().replace(/[٠-٩]/g,c=>'٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/[۰-۹]/g,c=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(c)).replace(/[٫]/g,'.').replace(/،/g,'.').replace(/[,٬]/g,'').replace(/[%٪\s]/g,'');
    if(!s||!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s))return null;const n=Number(s);return Number.isFinite(n)?n:null}
  const txt=v=>String(v??'').trim();
  // text compared for rule matching: letters unified (أ إ آ → ا, ى → ي, ة → ه), diacritics, tatweel and extra spaces dropped
  function norm(s){return String(s??'').normalize('NFKC').replace(/[ً-ٰٟـ]/g,'').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه')
    .replace(/[٠-٩]/g,c=>'٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/\s+/g,' ').trim().toLowerCase()}
  // land-use text (from GIS or typed) → class; unknown text → 'other', empty → ''
  function classifyUse(s){const t=norm(s);if(!t)return'';
    if(/مسجد|جامع|mosque/.test(t))return'mosque';
    if(/مختلط|mixed|سكني\s*[-/،,]?\s*تجاري|تجاري\s*[-/،,]?\s*سكني/.test(t))return'mixed';
    if(/تجار|commercial|retail/.test(t))return'commercial';
    if(/سكن|residential|فلل|فيلا|villa|housing/.test(t))return'residential';
    if(/مرافق|خدمات|حكومي|تعليم|مدرس|صحي|مستشفي|مستوصف|حدائق|حديقه|ملعب|public|facilit|utilit|school|hospital|park/.test(t))return'public';
    return'other'}
  // approval status text (from GIS) → key; «غير معتمد» is checked before «معتمد»
  function classifyStatus(s){const t=norm(s);if(!t)return'';if(STATUS[t])return t;
    if(/غير\s*معتمد|not\s*approved|unapproved|غير\s*متحقق|unverified/.test(t))return'unverified';
    if(/مراجع|review|pending/.test(t))return'review';if(/مسود|draft/.test(t))return'draft';if(/معتمد|approved|official/.test(t))return'approved';return''}

  // regulatory inputs of one parcel (the planner's S.tx fields) with validity flags
  function readRegs(tx){tx=tx||{};const raw=k=>txt(tx[k]),cov=num(tx.ratio),up=num(tx.upRatio),fl=num(tx.floors),h=num(tx.height),far=num(tx.far),pk=num(tx.parkPct);
    const bad=(k,v,ok)=>raw(k)!==''&&(v===null||!ok);
    const upOk=up!==null&&up>0&&up<=100,covOk=cov!==null&&cov>0&&cov<=100,flOk=fl!==null&&Number.isInteger(fl)&&fl>0,hOk=h!==null&&h>0,farOk=far!==null&&far>0,pkOk=pk!==null&&pk>=0&&pk<=100;
    const exc=(Array.isArray(tx.zExc)?tx.zExc:[]).map(e=>({kind:EXC[e?.kind]?e.kind:'note',area:num(e?.area),desc:txt(e?.desc),ref:txt(e?.ref)}))
      .filter(e=>e.desc||e.ref||e.area!==null)
      // a documented exception counts only with its reference (and, for an area, a positive area)
      .map(e=>({...e,counted:!!e.ref&&(e.kind==='note'||(e.area!==null&&e.area>0)),why:!e.ref?'بدون مرجع':e.kind!=='note'&&!(e.area>0)?'بدون مساحة صالحة':''}));
    return{use:USES[tx.zUse]?tx.zUse:'',useTxt:raw('zUseTxt'),
      coverage:covOk?cov:null,coverageBad:bad('ratio',cov,covOk),upper:upOk?up:null,upperBad:bad('upRatio',up,upOk),floors:flOk?fl:null,floorsBad:bad('floors',fl,flOk),height:hOk?h:null,heightBad:bad('height',h,hOk),
      farNA:!!tx.farNA,far:farOk&&!tx.farNA?far:null,farBad:!tx.farNA&&bad('far',far,farOk),parkPct:pkOk?pk:null,parkBad:bad('parkPct',pk,pkOk),
      parkTxt:raw('parkTxt'),extra:raw('special'),exc,ref:raw('zRef'),refDate:raw('zRefDate'),status:STATUS[tx.zStatus]?tx.zStatus:'',
      any:[cov,up,fl,h,far,pk].some(v=>v!==null)||!!tx.farNA||!!raw('parkTxt')||!!raw('special')}}

  // A regulatory figure is «معتمد» only with: a land-use class, an official reference, the status «معتمد», and (when it came
  // from a saved rule) a rule that matches this parcel's location and use. The program cannot verify the document itself.
  function approval(R,ctx={}){const why=[];
    if(!R.use)why.push('تصنيف الاستخدام غير محدد');
    if(!R.ref)why.push('لا يوجد مرجع رسمي');
    if(R.status!=='approved')why.push('حالة الاعتماد: '+(STATUS[R.status]||'غير محددة'));
    if(ctx.rule&&ctx.match&&!ctx.match.ok)why.push('القاعدة المطبقة لا تطابق '+ctx.match.why.join(' و'));
    return{ok:!why.length,reasons:why}}

  const r2=v=>Math.round(v*100)/100;
  /* o = {A, G, gState:'ok'|'partial'|'none'|'invalid', regs, approval, holesArea, roofed (mosque program), sbText}
     A = land area (all parts, holes excluded); G = area inside the approved setbacks */
  function compute(o){const A=+o.A||0,R=o.regs||readRegs({}),ap=o.approval||approval(R),gState=o.gState||'ok';
    const G=gState==='none'||gState==='invalid'||!Number.isFinite(o.G)?null:Math.max(0,+o.G);
    const covEx=R.exc.filter(e=>e.counted&&e.kind==='cover').reduce((t,e)=>t+e.area,0),grossEx=R.exc.filter(e=>e.counted&&e.kind==='gross').reduce((t,e)=>t+e.area,0);
    const covLimit=R.coverage!==null?A*R.coverage/100:null,covTotal=covLimit!==null?covLimit+covEx:null;
    // footprint: the smaller of the two limits; coverage unknown → only the geometric bound is known (no regulatory figure)
    let footprint=null,binding='',footState;
    if(G===null)footState=covTotal===null?'none':'geo-unknown';
    else if(covTotal===null)footState='geo-only';
    else{footprint=Math.min(G,covTotal);binding=Math.abs(G-covTotal)<=0.005?'equal':G<covTotal?'setback':'coverage';footState=gState==='partial'?'partial':'ok'}
    // each upper floor: upper % of the land, never beyond the buildable zone (no projection outside it or over holes is assumed)
    const upLimit=R.upper!==null?A*R.upper/100:null;let upper=null,upBinding='',upState='none';
    if(upLimit!==null){if(G===null)upState='geo-unknown';else{upper=Math.min(G,upLimit);upBinding=Math.abs(G-upLimit)<=0.005?'equal':G<upLimit?'setback':'ratio';upState=gState==='partial'?'partial':'ok'}}
    // total floor area of all floors (never mixed with the footprint): with an upper-floor ratio = ground + upper × (floors − 1),
    // otherwise footprint × floors
    const byFloors=footprint===null||R.floors===null?null:R.upper===null?footprint*R.floors:R.floors===1?footprint:upper!==null?footprint+upper*(R.floors-1):null,byFar=R.far!==null?A*R.far:null;
    let gross=null,grossState='none',grossBind='';
    if(byFloors!==null&&byFar!==null){gross=Math.min(byFloors,byFar);grossState='ok';grossBind=byFar<byFloors-0.005?'far':byFloors<byFar-0.005?'floors':'equal'}
    else if(byFloors!==null){gross=byFloors;grossState=R.farNA?'ok':'far-missing';grossBind='floors'}
    else if(byFar!==null){gross=byFar;grossState=R.floors===null?'floors-missing':'footprint-missing';grossBind='far'}
    if(gross!==null&&footState==='partial'&&grossState==='ok'&&grossBind!=='far')grossState='partial';
    // areas that cannot carry the ground footprint, with the reason of each
    const nb=[];
    if(G!==null&&A-G>0.005)nb.push({k:'setback',area:A-G,reason:'منطقة الارتدادات'+(o.sbText?' — '+o.sbText:'')});
    if(footprint!==null&&G-footprint>0.005)nb.push({k:'coverage',area:G-footprint,reason:'داخل الارتدادات لكن خارج حد نسبة التغطية'});
    if(o.holesArea>0.005)nb.push({k:'holes',area:o.holesArea,reason:'فراغات داخلية — خارج مساحة الأرض أصلًا',outside:true});
    const nbTotal=footprint!==null?A-footprint:G!==null?A-G:null;
    const mosque=Number.isFinite(o.roofed)&&footprint!==null?{roofed:o.roofed,ok:o.roofed<=footprint+0.005,over:Math.max(0,o.roofed-footprint)}:null;
    const certain=ap.ok&&(footState==='ok');
    return{A,G,gState,covPct:R.coverage,covLimit,covEx,covTotal,footprint,binding,footState,upPct:R.upper,upLimit,upper,upBinding,upState,byFloors,byFar,gross,grossState,grossBind,grossEx,nb,nbTotal,mosque,
      approved:ap.ok,reasons:ap.reasons,footApproved:certain,grossApproved:certain&&grossState==='ok',regs:R}}

  // short texts for tables (sheet, form, «مزيد»); f(v,d) formats a number, pct is the percent sign
  function texts(Z,f,pct='٪'){const R=Z.regs,a=v=>f(r2(v),2)+' م²',p=v=>f(v,v%1?1:0)+pct;
    const bind=Z.binding==='setback'?'القيد الأقوى: الارتدادات':Z.binding==='coverage'?'القيد الأقوى: نسبة التغطية':'القيدان متساويان';
    const use=R.use?USES[R.use]+(R.useTxt&&R.use==='other'?' — '+R.useTxt:''):MISSING;
    const geo=Z.G!==null?a(Z.G)+(Z.gState==='partial'?' (مبدئية)':''):Z.gState==='none'?'غير محددة (الارتدادات غير محددة)':'غير مؤكدة (تعذّر حساب الارتدادات)';
    const cov=Z.covPct===null?MISSING:p(Z.covPct)+' × الأرض = '+a(Z.covLimit)+(Z.covEx?' + '+a(Z.covEx)+' مستثناة':'');
    const foot=Z.footprint!==null?a(Z.footprint)+' ('+bind+')'+(Z.footState==='partial'?' — مبدئي':''):Z.footState==='geo-only'?MISSING+' (الحد الهندسي '+a(Z.G)+')':Z.footState==='geo-unknown'?'غير محدد (الارتدادات غير محددة)':MISSING;
    const grossWhy={'far-missing':'FAR غير محدد','floors-missing':'عدد الأدوار غير محدد','footprint-missing':'المسطح الأرضي غير محدد',partial:'مبدئي'}[Z.grossState];
    const byFl=R.upper!==null&&R.floors!==null?(R.floors===1?' (الأرضي فقط — دور واحد)':' (أرضي + علوي × '+f(R.floors-1,0)+')'):' (المسطح × '+f(R.floors??0,0)+' أدوار)';
    const gross=Z.gross===null?MISSING:a(Z.gross)+(Z.grossBind==='far'?' (حسب FAR)':Z.grossBind==='floors'?byFl:'')+(grossWhy?' — '+grossWhy:'');
    const upper=Z.upPct===null?MISSING:Z.upper!==null?a(Z.upper)+' ('+p(Z.upPct)+' × الأرض = '+a(Z.upLimit)+(Z.upBinding==='setback'?'؛ محدود بمنطقة البناء':'')+')'+(Z.upState==='partial'?' — مبدئي':''):'غير محدد (الارتدادات غير محددة)';
    const nbShort=Z.nbTotal===null?'غير محدد':a(Z.nbTotal);
    const nbList=Z.nb.map(x=>x.reason.split(' — ')[0]+' '+a(x.area)).join(' · ')||'لا يوجد';
    const ref=R.ref?R.ref+(R.refDate?' · '+R.refDate:''):'غير محدد';
    const status=Z.approved?'معتمد':'غير معتمد — '+Z.reasons.join('، ');
    const mosque=Z.mosque?a(Z.mosque.roofed)+(Z.mosque.ok?' — ضمن الحد':' — يتجاوز الحد بـ '+a(Z.mosque.over)):'';
    return{use,land:a(Z.A),geo,cov,foot,upper,gross,nbShort,nbList,ref,status,mosque,bind,missing:MISSING}}

  /* ---------- saved rules (by land use and area), each with its documented source ---------- */
  function loadRules(store){try{store=store||root.localStorage;const v=JSON.parse(store.getItem(RULES_KEY)||'[]');return Array.isArray(v)?v.filter(r=>r&&r.id&&r.use):[]}catch(e){return[]}}
  function saveRules(list,store){try{(store||root.localStorage).setItem(RULES_KEY,JSON.stringify(list));return true}catch(e){return false}}
  function scopeOf(site,level){const k=SCOPE_CHAIN.indexOf(level),out={},missing=[];if(k<0)return{scope:null,missing:['level']};
    SCOPE_CHAIN.slice(0,k+1).forEach(f=>{const v=txt(site?.[f]);if(v)out[f]=v;else if(f===level)missing.push(f)});return{scope:out,missing}}
  // rule from the current values; refused without a land-use class, an official reference, a value, or the chosen area field
  function makeRule(tx,site,level,name,now=new Date()){const R=readRegs(tx),err=[];
    if(!R.use)err.push('حدّد تصنيف استخدام الأرض.');
    if(!R.ref)err.push('اكتب المرجع الرسمي للاشتراط (لا تُحفظ قاعدة بدون مصدر).');
    if(!R.any)err.push('لا توجد قيم اشتراطات لحفظها.');
    const sc=scopeOf(site,level);if(!sc.scope)err.push('نطاق القاعدة غير صالح.');else if(sc.missing.length)err.push(`لا يمكن الحفظ على مستوى «${SCOPE_LABEL[level]}» لأن ${SCOPE_LABEL[level]} غير محدد للقطعة.`);
    if(err.length)return{rule:null,errors:err};
    const values={};RULE_FIELDS.forEach(k=>{values[k]=k==='zExc'?(Array.isArray(tx.zExc)?tx.zExc.map(e=>({...e})):[]):k==='farNA'?!!tx.farNA:txt(tx[k])});
    const where=sc.scope[level],auto=`${USES[R.use]} — ${SCOPE_LABEL[level]} ${where}`;
    return{rule:{id:'zr-'+now.getTime().toString(36)+'-'+Math.random().toString(36).slice(2,7),name:txt(name)||auto,use:R.use,useTxt:R.use==='other'?R.useTxt:'',level,scope:sc.scope,values,savedAt:now.toISOString()},errors:[]}}
  // does a rule apply to this parcel? the same land use, and every area field of the rule equal to the parcel's
  function matchRule(rule,site,use,useTxt){const why=[];if(!rule)return{ok:false,why:['القاعدة'],score:0};
    if(rule.use!==use||(rule.use==='other'&&norm(rule.useTxt)!==norm(useTxt)))why.push('الاستخدام');
    Object.entries(rule.scope||{}).forEach(([f,v])=>{if(norm(site?.[f])!==norm(v))why.push(SCOPE_LABEL[f]||f)});
    return{ok:!why.length,why,score:Object.keys(rule.scope||{}).length}}
  // matching rules, the most specific first
  function bestRules(rules,site,use,useTxt){return(rules||[]).map(r=>({rule:r,m:matchRule(r,site,use,useTxt)})).filter(x=>x.m.ok).sort((a,b)=>b.m.score-a.m.score)}
  // the single best match (a tie between equally specific rules is left to the user)
  function autoRule(rules,site,use,useTxt){const b=bestRules(rules,site,use,useTxt);return b.length&&(b.length===1||b[0].m.score>b[1].m.score)?b[0].rule:null}
  function applyRule(rule,tx){RULE_FIELDS.forEach(k=>{const v=rule.values?.[k];tx[k]=k==='zExc'?(Array.isArray(v)?v.map(e=>({...e})):[]):k==='farNA'?!!v:txt(v);if(tx.zSrc&&k in tx.zSrc)tx.zSrc[k]=txt(v)||k==='farNA'?'rule':''});tx.zRule=rule.id;return tx}
  function ruleLabel(rule){return`${rule.name} · ${USES[rule.use]||rule.use} · ${Object.entries(rule.scope||{}).map(([f,v])=>SCOPE_LABEL[f]+' '+v).join('، ')}`}

  const api={USES,STATUS,EXC,EXC_SHORT,SCOPE_CHAIN,SCOPE_LABEL,MISSING,RULES_KEY,RULE_FIELDS,USER_RULES,userCfg,userFront,userEdgeSb,num,norm,classifyUse,classifyStatus,readRegs,approval,compute,texts,
    loadRules,saveRules,makeRule,matchRule,bestRules,autoRule,applyRule,ruleLabel};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.ZoningRules=api;
})(typeof globalThis!=='undefined'?globalThis:this);
