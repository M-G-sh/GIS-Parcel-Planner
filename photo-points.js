/* photo-points.js — photo points of a field survey, linked to the parcel of the transaction form («التوثيق الفوتوغرافي»).

   1) Photo points from a .gdb (read with filegdb.js), a GeoJSON or a zipped shapefile: position (WGS 84), photo name,
      photo link, and the photo stored inside the .gdb (…__ATTACH) read one at a time when it is needed.
   2) Matching: the photo named in the parcel's own attributes, else the points inside the parcel, else the nearest ones
      (photos are taken from the street in front of it).

   Works in the browser (window.PhotoPoints, after filegdb.js) and in Node (module.exports) for the tests. */
(function (root) {
  'use strict';
  const GDB = (typeof module !== 'undefined' && module.exports) ? require('./filegdb.js') : root.FileGDB;
  const { FT, nameKey } = GDB;

  /* ---------- 1) photo points ---------- */

  const IMG = /\.(jpe?g|png|heic|webp)$/i;
  // «2026-11-04_05-23-52_21.37948_39.78721.jpg» → position written in the photo name (a fallback when a point has no geometry)
  function posFromName(n) { const m = /_(-?\d{1,2}\.\d{3,})_(-?\d{1,3}\.\d{3,})\.\w+$/.exec(String(n || '')); return m ? { lat: +m[1], lon: +m[2] } : null }

  // the photo-name and photo-link columns, found by their values (names and aliases differ from one survey to another)
  function detectFields(rows) {
    const keys = [...new Set(rows.slice(0, 200).flatMap(r => Object.keys(r || {})))], share = (k, re) => {
      let n = 0, hit = 0; for (const r of rows.slice(0, 200)) { const v = r && r[k]; if (typeof v !== 'string' || !v.trim()) continue; n++; if (re.test(v.trim())) hit++ }
      return n ? hit / n : 0 };
    const best = re => keys.map(k => [k, share(k, re)]).filter(([, s]) => s >= 0.6).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    return { name: best(/^[^\\/]*\.(jpe?g|png|heic|webp)$/i), url: best(/^https?:\/\/\S+$/i) };
  }

  function makePoints(rows, pos, fields, L = 0) {
    return rows.map((r, i) => {
      const name = fields.name ? String(r[fields.name] || '').trim() : '', p = pos(r, i) || posFromName(name);
      return p ? { id: i, L, lat: p.lat, lon: p.lon, name, url: fields.url ? String(r[fields.url] || '').trim() : '', oid: r.__oid ?? null, gid: r.__gid ?? null } : null;
    }).filter(Boolean);
  }

  /* a .gdb: every point layer holding photo names or links (in the database itself or inside its feature datasets), each with its
     attachment table when the photos are stored inside. A photo found in several layers (a copy or a spatial join of the same
     survey) is kept once, preferring a stored photo. opts.toWgs(wkt) → (x, y) → {lat, lon} converts a projected layer; without
     it only geographic layers (and positions written in the photo names) are used. */
  async function pointsFromGdb(src, opts = {}) {
    const g = await GDB.openGdb(src);
    const layers = g.tables.filter(t => t.kind === 'point' && !/__ATTACH$/i.test(t.name));
    if (!layers.length) throw new Error('لا توجد طبقة نقاط في قاعدة البيانات');
    const used = [], attaches = [], points = [], seen = new Map(); let noGeo = 0;
    for (const t of layers) {
      const rows = await GDB.readRows(src, t, opts), fields = detectFields(rows);
      if (!fields.name && !fields.url) continue;                                  // a point layer without photos
      const geo = t.geo, gid = t.fields.find(f => f.type === FT.GLOBALID), oid = t.fields.find(f => f.type === FT.OBJECTID);
      rows.forEach(r => { r.__oid = oid ? r[oid.name] : null; r.__gid = gid ? r[gid.name] : null });
      const geographic = !geo || /GEOGCS/i.test(geo.wkt) && !/PROJCS/i.test(geo.wkt), cv = !geographic && opts.toWgs ? opts.toWgs(geo.wkt) : null;
      const pos = r => { const p = geo && r[geo.name]; return !p ? null : geographic ? { lat: p.y, lon: p.x } : cv ? cv(p.x, p.y) : null };
      const att = g.tables.find(x => x.name.toLowerCase() === (t.name + '__ATTACH').toLowerCase()), L = used.length;
      used.push({ name: t.name, fields, rows: rows.length }); attaches.push(att ? await GDB.openAttach(src, att) : null);
      const pts = makePoints(rows, pos, fields, L); noGeo += rows.length - pts.length;
      for (const p of pts) {
        const k = p.name ? nameKey(p.name) : null, prev = k && seen.get(k);
        if (prev) { if (!attaches[prev.L] && attaches[L]) Object.assign(prev, p); continue }
        points.push(p); if (k) seen.set(k, p);
      }
    }
    if (!used.length) throw new Error('لا توجد في القاعدة طبقة نقاط فيها اسم الصورة أو رابطها');
    if (!points.length) throw new Error('طبقات الصور في القاعدة بدون إحداثيات معروفة');
    points.forEach((p, i) => { p.id = i });
    const count = attaches.reduce((n, a) => n + (a ? a.count : 0), 0);
    return { layer: used.map(u => u.name).join(' + '), layers: used, fields: used[0].fields, points, attaches, attach: count ? { count } : null, noGeo, src };
  }

  // GeoJSON features or shapefile rows with point geometry (WGS 84)
  function pointsFromFeatures(feats, layer) {
    const rows = feats.map(f => f.properties || {}), fields = detectFields(rows);
    const pos = (r, i) => { const g = feats[i].geometry; const c = g && (g.type === 'Point' ? g.coordinates : g.type === 'MultiPoint' ? g.coordinates[0] : null);
      return c && Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90 ? { lat: +c[1], lon: +c[0] } : null };
    const points = makePoints(rows, pos, fields);
    if (!points.length) throw new Error('لم أجد نقاطًا بإحداثيات جغرافية (WGS 84) في الملف');
    return { layer, fields, points, attach: null, src: null };
  }

  // a shapefile of points (types 1, 11, 21) with its attribute rows; coordinates must be geographic (WGS 84)
  function pointsFromShp(buf, rows, layer) {
    const dv = new DataView(buf), feats = []; let o = 100, i = 0;
    while (o + 12 <= buf.byteLength) {
      const len = dv.getInt32(o + 4, false) * 2, rs = o + 8; if (len <= 0) break;
      const st = dv.getInt32(rs, true);
      feats.push({ properties: rows[i] || {}, geometry: [1, 11, 21].includes(st) ? { type: 'Point', coordinates: [dv.getFloat64(rs + 4, true), dv.getFloat64(rs + 12, true)] } : null });
      o = rs + len; i++;
    }
    return pointsFromFeatures(feats, layer);
  }

  // the photo stored in the .gdb for a point → {bytes, type, name}, or null (no attachment table, or the .gdb not open now)
  async function attachmentOf(set, pt) {
    const A = set && set.attaches && set.attaches[pt.L || 0]; if (!A || !set.src) return null;
    const a = await GDB.readAttachment(set.src, A, { oid: pt.oid, gid: pt.gid, name: pt.name });
    return a && { ...a, type: /^image\//.test(a.type) ? a.type : 'image/jpeg', name: a.name || pt.name };
  }

  /* ---------- 2) matching to a parcel ---------- */

  const R = 6371008.8, D2R = Math.PI / 180;
  // local metres around a latitude (enough for distances of a few hundred metres)
  const frame = lat0 => { const k = Math.cos(lat0 * D2R) * R * D2R; return (lat, lon) => ({ x: lon * k, y: lat * R * D2R }) };
  function inside(p, ring) { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) c = !c } return c }
  function segDist(p, a, b) { const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)) : 0;
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy) }

  /* candidates for a parcel, best first:
     · a photo named in the parcel's attributes (exact file name) — «linked by name»
     · points inside the parcel (distance 0), then points within maxDist metres of its boundary, nearest first
     rings: [[{lat, lon}…]…] (outer rings and holes; a point in a hole is outside) */
  function matchParcel(set, rings, attrs, opts = {}) {
    const maxDist = opts.maxDist ?? 40, limit = opts.limit ?? 8;
    if (!set || !rings || !rings.length) return [];
    const lat0 = rings[0][0].lat, f = frame(lat0), RR = rings.map(r => r.map(q => f(q.lat, q.lon)));
    const named = new Set(Object.values(attrs || {}).filter(v => typeof v === 'string' && IMG.test(v.trim())).map(nameKey));
    const out = [];
    for (const pt of set.points) {
      const byName = named.size && named.has(nameKey(pt.name));
      if (Math.abs(pt.lat - lat0) > 0.01 && !byName) continue;              // ~1 km: far points skipped early
      const p = f(pt.lat, pt.lon), n = RR.filter(r => inside(p, r)).length;
      let d = 0; if (n % 2 === 0) { d = Infinity; for (const r of RR) for (let i = 0; i < r.length; i++) d = Math.min(d, segDist(p, r[i], r[(i + 1) % r.length])) }
      if (byName || d <= maxDist) out.push({ pt, dist: d, how: byName ? 'name' : d === 0 ? 'inside' : 'near' });
    }
    const rank = { name: 0, inside: 1, near: 2 };
    return out.sort((a, b) => rank[a.how] - rank[b.how] || a.dist - b.dist || String(b.pt.name).localeCompare(String(a.pt.name))).slice(0, limit);
  }

  const api = { pointsFromGdb, pointsFromFeatures, pointsFromShp, attachmentOf, matchParcel, detectFields, posFromName };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PhotoPoints = api;
})(typeof window !== 'undefined' ? window : globalThis);
