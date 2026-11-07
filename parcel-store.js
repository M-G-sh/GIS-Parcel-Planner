/* IndexedDB persistence for parcel layers and per-parcel analysis snapshots. */
(function(root){
  'use strict';
  const DB_NAME='gis-parcel-planner-final',DB_VERSION=1,LAYER_STORE='layers',RECORD_STORE='records';
  let opening=null;
  function open(){
    if(!root.indexedDB)return Promise.reject(new Error('IndexedDB غير متاح في هذا المتصفح.'));
    if(opening)return opening;
    opening=new Promise((resolve,reject)=>{
      const request=root.indexedDB.open(DB_NAME,DB_VERSION);
      request.onupgradeneeded=()=>{
        const db=request.result;
        if(!db.objectStoreNames.contains(LAYER_STORE)){
          const layers=db.createObjectStore(LAYER_STORE,{keyPath:'id'});
          layers.createIndex('kind','kind',{unique:false});
        }
        if(!db.objectStoreNames.contains(RECORD_STORE))db.createObjectStore(RECORD_STORE,{keyPath:'id'});
      };
      request.onsuccess=()=>{
        const db=request.result;
        db.onversionchange=()=>{db.close();opening=null};
        resolve(db);
      };
      request.onerror=()=>{opening=null;reject(request.error||new Error('تعذر فتح قاعدة البيانات.'))};
      request.onblocked=()=>{opening=null;reject(new Error('قاعدة بيانات المشروع مشغولة في علامة تبويب أخرى.'))};
    });
    return opening;
  }
  async function transact(storeName,mode,action){
    const db=await open();
    return new Promise((resolve,reject)=>{
      let result;
      let failed=false;
      const tx=db.transaction(storeName,mode),store=tx.objectStore(storeName);
      try{
        const request=action(store);
        if(request){request.onsuccess=()=>{result=request.result};request.onerror=()=>{failed=true;reject(request.error||new Error('فشل طلب قاعدة البيانات.'))}}
      }catch(error){failed=true;tx.abort();reject(error);return}
      tx.oncomplete=()=>{if(!failed)resolve(result)};
      tx.onerror=()=>{if(!failed){failed=true;reject(tx.error||new Error('فشلت معاملة قاعدة البيانات.'))}};
      tx.onabort=()=>{if(!failed)reject(tx.error||new Error('أُلغيت معاملة قاعدة البيانات.'))};
    });
  }
  function layerId(kind,id){return`${kind}:${id}`}
  const api={
    async putLayer(kind,id,data,metadata={}){
      if(!['parcels','roads'].includes(kind))throw new Error('نوع طبقة غير معروف.');
      if(!id)throw new Error('معرّف الطبقة مطلوب.');
      const record={id:layerId(kind,id),kind,layerId:String(id),updatedAt:Date.now(),metadata,data};
      await transact(LAYER_STORE,'readwrite',store=>store.put(record));
      return record;
    },
    getLayer(kind,id){return transact(LAYER_STORE,'readonly',store=>store.get(layerId(kind,id)))},
    listLayers(kind){return transact(LAYER_STORE,'readonly',store=>store.index('kind').getAll(kind))},
    deleteLayer(kind,id){return transact(LAYER_STORE,'readwrite',store=>store.delete(layerId(kind,id)))},
    async putRecord(id,value){await transact(RECORD_STORE,'readwrite',store=>store.put({id:String(id),updatedAt:Date.now(),value}));return true},
    async getRecord(id){const row=await transact(RECORD_STORE,'readonly',store=>store.get(String(id)));return row?.value??null},
    deleteRecord(id){return transact(RECORD_STORE,'readwrite',store=>store.delete(String(id)))},
    // All records whose id starts with prefix, as [{id,updatedAt,value}].
    listRecords(prefix=''){const p=String(prefix);return transact(RECORD_STORE,'readonly',store=>p&&root.IDBKeyRange?store.getAll(root.IDBKeyRange.bound(p,p+'￿')):store.getAll()).then(rows=>(rows||[]).filter(r=>String(r.id).startsWith(p)))},
    async estimate(){return root.navigator?.storage?.estimate?root.navigator.storage.estimate():null}
  };
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.ParcelStore=api;
})(typeof window!=='undefined'?window:globalThis);
