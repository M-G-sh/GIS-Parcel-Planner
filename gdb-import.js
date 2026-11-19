/* gdb-import.js — «فتح قاعدة .gdb» in «استيراد الأرض»: the parcel layer and the street layer read from an Esri File Geodatabase
   (filegdb.js), in place of a zipped shapefile or GeoJSON.

   · Every polygon and line layer of the database is offered (also those inside feature datasets); the parcel layer (a parcel-number
     field) and the street layer (a street-name or width field) are chosen automatically and can be changed.
   · Scope: the area shown on the map (a municipal layer holds hundreds of thousands of parcels — too many for one browser page)
     or the whole layer when it is small enough. Only rows whose extent meets the area are decoded.
   · Coordinates: geographic, or UTM on WGS 84 / KSA-GRF17 (prjInfo). Parcels keep their layer coordinates and CRS like a
     shapefile (useParcelLayer stores them in WGS 84); streets are converted to WGS 84 like a shapefile (setRoadLayer).
   · Attribute values: text and numbers as they are, dates as YYYY-MM-DD, empty values as '' (as a shapefile gives them).
   Uses the planner's own functions (index.html): useParcelLayer, setRoadLayer, roadConverter, prjInfo, ll2utm, pickLabel, largest,
   drawGisLayers, setView, toast, esc. */
(function () {
  'use strict';
  const q = s => document.querySelector(s);
  const MAX_ROWS = 20000;                  // parcels or street segments imported at once
  let G = null;                            // {src, tables} of the open database

  const parcelScore = t => (t.fields.some(f => /^(PARCEL_?(NUMBER|NUM|NO)|ParcelNo|رقم_?القطعة)$/i.test(f.name)) ? 4 : 0) + (/parcel|قطع|أراض/i.test(t.name) ? 2 : 0);
  const roadScore = t => (t.fields.some(f => /RoadcenterlineAName|street_?name|اسم_?الشارع/i.test(f.name)) ? 3 : 0) + (t.fields.some(f => /^width$|عرض/i.test(f.name)) ? 2 : 0) + (/road|street|شارع|طرق/i.test(t.name) ? 2 : 0);
  const fmtN = n => Number(n).toLocaleString('en-US');

  // a value as the planner expects it from a shapefile
  function plain(v) {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return isNaN(v) ? '' : v.toISOString().slice(0, 10);
    if (typeof v === 'object') return undefined;                 // geometry or a binary field: not an attribute
    return v;
  }
  function attrsOf(t, row) { const out = {}; for (const f of t.fields) { if (f === t.geo) continue; const v = plain(row[f.name]); if (v !== undefined) out[f.name] = v } return out }

  // the area shown on the map, in the coordinates of a layer (null: the layer's system cannot be matched)
  function viewBox(t) {
    if (typeof map === 'undefined' || !map) return null;
    const b = map.getBounds().pad(0.15), p = prjInfo(t.geo.wkt);
    const ll = [[b.getSouth(), b.getWest()], [b.getSouth(), b.getEast()], [b.getNorth(), b.getWest()], [b.getNorth(), b.getEast()]];
    let pts;
    if (p?.kind === 'geo') pts = ll.map(([la, lo]) => ({ x: lo, y: la }));
    else if (p?.kind === 'utm' && p.datum === 'WGS84') pts = ll.map(([la, lo]) => ll2utm(la, lo, p.zone));
    else return null;
    const xs = pts.map(v => v.x), ys = pts.map(v => v.y);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }

  function fillDialog() {
    const polys = G.tables.filter(t => t.kind === 'polygon' && t.validRows > 0), lines = G.tables.filter(t => t.kind === 'line' && t.validRows > 0);
    const opt = t => `<option value="${esc(t.file)}">${esc(t.name)} — ${fmtN(t.validRows)}</option>`;
    q('#gdbParcels').innerHTML = polys.length ? polys.map(opt).join('') : '<option value="">لا توجد طبقة مضلعات</option>';
    q('#gdbRoads').innerHTML = '<option value="">بدون</option>' + lines.map(opt).join('');
    const bestP = polys.slice().sort((a, b) => parcelScore(b) - parcelScore(a))[0], bestR = lines.slice().sort((a, b) => roadScore(b) - roadScore(a))[0];
    if (bestP) q('#gdbParcels').value = bestP.file;
    if (bestR && roadScore(bestR) > 0) q('#gdbRoads').value = bestR.file;
    hint();
  }
  const tableOf = sel => G.tables.find(t => t.file === q(sel).value) || null;
  function hint() {
    const P = tableOf('#gdbParcels'), R = tableOf('#gdbRoads'), all = q('#gdbScope').value === 'all';
    const sys = t => { const p = prjInfo(t.geo.wkt); return p?.kind === 'geo' ? 'إحداثيات جغرافية' : p?.kind === 'utm' ? `UTM ${p.zone} شمال${p.datum === 'WGS84' ? '' : ' — مرجع غير مدعوم'}` : 'إسقاط غير مدعوم' };
    const big = [P, R].filter(t => t && t.validRows > MAX_ROWS);
    q('#gdbHint').textContent = (P ? `القطع: ${P.name} (${sys(P)}). ` : '') + (R ? `الشوارع: ${R.name} (${sys(R)}). ` : '') +
      (all && big.length ? `«${big.map(t => t.name).join('، ')}» أكبر من ${fmtN(MAX_ROWS)} عنصر: اختر «منطقة الخريطة» بعد تقريب الخريطة على المنطقة.` :
        !all ? 'تُقرأ القطع والشوارع الواقعة في الخريطة الظاهرة الآن فقط؛ قرّب الخريطة على المخطط أو الحي المطلوب قبل الاستيراد.' : '');
  }

  async function readLayer(t, scope, label) {
    const box = scope === 'view' ? viewBox(t) : null;
    if (scope === 'view' && !box) throw new Error(`لا يمكن مطابقة إسقاط «${t.name}» مع الخريطة`);
    if (scope === 'all' && t.validRows > MAX_ROWS) throw new Error(`«${t.name}» فيها ${fmtN(t.validRows)} عنصر؛ اختر «منطقة الخريطة»`);
    const rows = await FileGDB.readRows(G.src, t, { box, limit: MAX_ROWS,
      progress: async (i, n) => { q('#gdbStatus').textContent = `جارٍ قراءة ${label}… ${Math.round(100 * i / n)}٪`; await new Promise(r => setTimeout(r, 0)) } });
    if (rows.truncated) throw new Error(`المنطقة فيها أكثر من ${fmtN(MAX_ROWS)} من ${label}؛ قرّب الخريطة أكثر`);
    return rows;
  }

  async function importNow() {
    const P = tableOf('#gdbParcels'), R = tableOf('#gdbRoads'), scope = q('#gdbScope').value;
    if (!P) { toast('اختر طبقة القطع.'); return }
    const go = q('#gdbGo'); go.disabled = true;
    try {
      // parcels: kept in their own coordinates with their CRS, like a shapefile
      const prj = prjInfo(P.geo.wkt), rows = await readLayer(P, scope, 'القطع'), list = [];
      rows.forEach(r => { const g = r[P.geo.name]; if (!g || g.type !== 'polygon') return;
        const rings = g.parts.map(part => part.map(p => ({ x: p.x, y: p.y }))), ring = largest(rings); if (!ring) return;
        const attrs = attrsOf(P, r);
        list.push({ label: pickLabel(attrs, list.length), ring, rings, geometry: { type: 'Polygon', coordinates: rings.map(x => x.map(p => [p.x, p.y])) }, sourceId: attrs.OBJECTID ?? '', prj, attrs }) });
      if (!list.length) throw new Error(scope === 'view' ? 'لا توجد قطع في منطقة الخريطة الظاهرة' : 'لا توجد قطع في الطبقة');
      // streets: WGS 84 lines, each part a feature, like a shapefile
      let roadNote = '';
      if (R) {
        const rr = await readLayer(R, scope, 'الشوارع'), cv = roadConverter(prjInfo(R.geo.wkt)), feats = [];
        rr.forEach((r, i) => { const g = r[R.geo.name]; if (!g || g.type !== 'line') return; const attrs = attrsOf(R, r);
          g.parts.forEach((part, k) => { if (part.length >= 2) feats.push({ type: 'Feature', properties: { ...attrs, __source: i, __part: k }, geometry: { type: 'LineString', coordinates: part.map(cv) } }) }) });
        roadNote = feats.length ? await setRoadLayer(feats, `${G.src.name} / ${R.name}`) : ' · لا توجد شوارع في المنطقة.';
      }
      closeDialog();
      const info = `من ‎${G.src.name}‎ › ${P.name}${scope === 'view' ? ' (منطقة الخريطة)' : ''} · ` +
        (prj?.kind === 'utm' ? `الإسقاط: UTM نطاق ${prj.zone} شمال` : prj?.kind === 'geo' ? 'الإسقاط: إحداثيات جغرافية' : 'إسقاط غير معروف');
      await useParcelLayer(list, `${G.src.name} / ${P.name}`, info, roadNote);
    } catch (e) { q('#gdbStatus').textContent = ''; toast('تعذّر الاستيراد: ' + (e.message || e)) }
    finally { go.disabled = false }
  }

  function closeDialog() { q('#gdbModal').hidden = true; q('#gdbStatus').textContent = ''; q('#gdbBtn')?.focus() }

  q('#gdbBtn').onclick = () => q('#gdbIn').click();
  q('#gdbIn').onchange = async e => {
    const files = e.target.files; if (!files.length) return;
    try { const src = FileGDB.folderSource(files); toast('جارٍ قراءة قاعدة البيانات…'); G = await FileGDB.openGdb(src); G.src = src }
    catch (err) { toast('تعذّر قراءة القاعدة: ' + (err.message || err)); e.target.value = ''; return }
    e.target.value = '';
    if (!G.tables.some(t => t.kind === 'polygon' && t.validRows > 0)) { toast('لا توجد في القاعدة طبقة قطع (مضلعات). لنقاط الصور استخدم «فتح قاعدة .gdb» في التوثيق الفوتوغرافي.'); return }
    q('#gdbHead').textContent = `استيراد من ‎${G.src.name}`; fillDialog();
    // the map is left where the user placed it: its visible area is the import scope
    q('#gdbModal').hidden = false; q('#gdbParcels').focus();
  };
  ['#gdbParcels', '#gdbRoads', '#gdbScope'].forEach(s => q(s).addEventListener('change', hint));
  q('#gdbGo').onclick = importNow;
  q('#gdbCancel').onclick = closeDialog; q('#gdbClose').onclick = closeDialog;
  q('#gdbModal').addEventListener('keydown', e => { if (e.key === 'Escape') closeDialog() });
})();
