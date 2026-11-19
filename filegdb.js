/* filegdb.js — read-only Esri File Geodatabase reader (.gdb folder), no library.

   Reads the catalogue (every table, also those inside feature datasets — a dataset only groups tables), any table's fields and
   rows, point / line / polygon geometry (with or without Z and M; true curves are kept as their vertices), and attachments
   (…__ATTACH) one at a time straight from the file, so a table of several GB is never loaded whole.
   Format: the public description of GDAL's OpenFileGDB driver (files aXXXXXXXX.gdbtable + .gdbtablx).

   Works in the browser (window.FileGDB) and in Node (module.exports). A «source» is any object with
   async read(name, start, end) → Uint8Array, size(name) → bytes and has(name) → boolean
   (a folder of File objects chosen in the browser, or files on disk in the tests). */
(function (root) {
  'use strict';

  const FT = { INT16: 0, INT32: 1, FLOAT32: 2, FLOAT64: 3, STRING: 4, DATETIME: 5, OBJECTID: 6, GEOMETRY: 7, BINARY: 8, RASTER: 9,
    GUID: 10, GLOBALID: 11, XML: 12, INT64: 13, DATE: 14, TIME: 15, DATETIME_OFFSET: 16 };
  const GEOM = { 1: 'point', 2: 'multipoint', 3: 'line', 4: 'polygon', 9: 'multipatch' };
  const SHAPE_POINT = [1, 9, 11, 21], SHAPE_LINE = [3, 10, 13, 23, 50], SHAPE_POLYGON = [5, 15, 19, 25, 51];
  const CHUNK = 32 * 1024 * 1024;    // a table is read in windows of this size
  const tableFile = id => 'a' + id.toString(16).padStart(8, '0');
  const utf16 = (b, off, nChars) => { let s = ''; for (let i = 0; i < nChars; i++) s += String.fromCharCode(b[off + 2 * i] | (b[off + 2 * i + 1] << 8)); return s };
  const utf8 = new TextDecoder('utf-8');
  const DAY0 = Date.UTC(1899, 11, 30);

  // byte cursor over one buffer (little endian; varuint = 7 bits per byte; varint = sign in bit 6 of the first byte)
  function cursor(buf, pos = 0) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const c = {
      pos,
      u8() { return buf[c.pos++] },
      u16() { const v = dv.getUint16(c.pos, true); c.pos += 2; return v },
      i16() { const v = dv.getInt16(c.pos, true); c.pos += 2; return v },
      i32() { const v = dv.getInt32(c.pos, true); c.pos += 4; return v },
      u32() { const v = dv.getUint32(c.pos, true); c.pos += 4; return v },
      f32() { const v = dv.getFloat32(c.pos, true); c.pos += 4; return v },
      f64() { const v = dv.getFloat64(c.pos, true); c.pos += 8; return v },
      i64() { const v = Number(dv.getBigInt64(c.pos, true)); c.pos += 8; return v },
      varuint() { let v = 0, mul = 1, b; do { b = buf[c.pos++]; v += (b & 0x7f) * mul; mul *= 128 } while (b & 0x80); return v },
      varint() { let b = buf[c.pos++], v = b & 0x3f, mul = 64; const neg = b & 0x40; while (b & 0x80) { b = buf[c.pos++]; v += (b & 0x7f) * mul; mul *= 128 } return neg ? -v : v },
      bytes(n) { const v = buf.subarray(c.pos, c.pos + n); c.pos += n; return v },
      skip(n) { c.pos += n }
    };
    return c;
  }

  // field descriptions of a .gdbtable (header + fields section)
  async function readTableHeader(src, file) {
    const name = file + '.gdbtable', hc = cursor(await src.read(name, 0, 40));
    hc.skip(4); const validRows = hc.i32(); hc.skip(24); const fieldsAt = hc.i32() + hc.i32() * 4294967296;
    const len = cursor(await src.read(name, fieldsAt, fieldsAt + 4)).i32();
    const b = await src.read(name, fieldsAt, fieldsAt + 4 + len), c = cursor(b, 4);
    const version = c.i32(), geomType = c.u8(); c.skip(3); const nFields = c.i16();
    const fields = [];
    for (let i = 0; i < nFields; i++) {
      const name = utf16(b, c.pos + 1, b[c.pos]); c.skip(1 + 2 * b[c.pos]);
      const alias = utf16(b, c.pos + 1, b[c.pos]); c.skip(1 + 2 * b[c.pos]);
      const type = c.u8(), f = { name, alias: alias || name, type, nullable: false };
      if (type === FT.OBJECTID) c.skip(2);
      else if (type === FT.GEOMETRY) {
        c.skip(1); f.nullable = !!(c.u8() & 1);
        const wktLen = c.u16(); f.wkt = utf16(b, c.pos, wktLen / 2); c.skip(wktLen);
        const gf = c.u8(), hasM = !!(gf & 2), hasZ = !!(gf & 4);
        f.xOrigin = c.f64(); f.yOrigin = c.f64(); f.xyScale = c.f64();
        if (hasM) c.skip(16); if (hasZ) c.skip(16);
        c.skip(8); if (hasM) c.skip(8); if (hasZ) c.skip(8);
        f.extent = [c.f64(), c.f64(), c.f64(), c.f64()];              // xmin ymin xmax ymax of the layer
        // optional z/m extents, then «0, n (1…3), 0, 0, 0» starts the spatial-index grid sizes (as GDAL detects it)
        let k = 0; while (k < 4 && !(b[c.pos] === 0 && b[c.pos + 1] >= 1 && b[c.pos + 1] <= 3 && !b[c.pos + 2] && !b[c.pos + 3] && !b[c.pos + 4])) { c.skip(8); k++ }
        c.skip(1); const grids = c.u32(); c.skip(grids * 8);
        f.hasZ = hasZ; f.hasM = hasM;
      }
      else if (type === FT.STRING) { c.skip(4); f.nullable = !!(c.u8() & 1); c.skip(c.varuint()) }
      else if (type === FT.BINARY || type === FT.GUID || type === FT.GLOBALID || type === FT.XML) { c.skip(1); f.nullable = !!(c.u8() & 1) }
      else if (type === FT.RASTER) throw new Error('جداول الصور النقطية (Raster) غير مدعومة');
      else { c.skip(1); f.nullable = !!(c.u8() & 1); c.skip(c.u8()) }          // numbers and dates: width, flag, default value
      fields.push(f);
    }
    const geo = fields.find(f => f.type === FT.GEOMETRY) || null;
    return { file, version, geomType, kind: GEOM[geomType] || (geomType ? 'other' : 'table'), validRows, fields, geo };
  }

  // row offsets (.gdbtablx); OBJECTID = index + 1, offset 0 = deleted row
  async function readOffsets(src, file) {
    const name = file + '.gdbtablx', h = cursor(await src.read(name, 0, 16));
    h.skip(4); const blocks = h.i32(), nRows = h.i32(), size = h.i32();
    const raw = await src.read(name, 16, 16 + blocks * 1024 * size);
    const at = i => { let v = 0; for (let k = size - 1; k >= 0; k--) v = v * 256 + raw[i * size + k]; return v };
    const present = blocks * 1024;
    // sparse tables keep a bitmap of the 1024-row blocks present after the offsets
    let blockOf = null;
    if (present < nRows) {
      const tr = cursor(await src.read(name, 16 + present * size, 16 + present * size + 16)), words = tr.i32(); tr.skip(12);
      const bm = await src.read(name, 16 + present * size + 16, 16 + present * size + 16 + words * 4);
      blockOf = []; let n = 0; for (let i = 0; i < words * 32; i++) blockOf.push((bm[i >> 3] >> (i & 7)) & 1 ? n++ : -1);
    }
    const out = [];
    for (let id = 1; id <= nRows; id++) {
      const blk = Math.floor((id - 1) / 1024), pb = blockOf ? blockOf[blk] : blk;
      if (pb === undefined || pb < 0) continue;
      const off = at(pb * 1024 + (id - 1) % 1024); if (off) out.push({ id, off });
    }
    return out;
  }

  /* geometry blob → {type:'point', x, y} | {type:'line'|'polygon', parts:[[{x,y}…]…], box:[xmin,ymin,xmax,ymax]} | null.
     box (optional, in the layer's coordinates): a line or polygon whose extent misses it is returned as {skip:true}
     before its vertices are decoded. */
  function shapeOf(f, blob, box) {
    const c = cursor(blob), gt = c.varuint(), t = gt % 256, s = f.xyScale;
    if (SHAPE_POINT.includes(t)) {
      const x = c.varuint(), y = c.varuint(); if (!x && !y) return null;          // empty point
      return { type: 'point', x: (x - 1) / s + f.xOrigin, y: (y - 1) / s + f.yOrigin };
    }
    const isLine = SHAPE_LINE.includes(t); if (!isLine && !SHAPE_POLYGON.includes(t)) return null;
    const nPts = c.varuint(); if (!nPts) return null;
    const nParts = c.varuint(); if (gt >= 0x20000000 && Math.floor(gt / 0x20000000) % 2) c.varuint();   // curves count
    const x0 = c.varuint() / s + f.xOrigin, y0 = c.varuint() / s + f.yOrigin, x1 = c.varuint() / s + x0, y1 = c.varuint() / s + y0;
    if (box && (x1 < box[0] || x0 > box[2] || y1 < box[1] || y0 > box[3])) return { skip: true };
    const sizes = []; let used = 0; for (let i = 0; i < nParts - 1; i++) { const n = c.varuint(); sizes.push(n); used += n } sizes.push(nPts - used);
    const parts = []; let dx = 0, dy = 0;
    for (const n of sizes) { const part = []; for (let i = 0; i < n; i++) { dx += c.varint(); dy += c.varint(); part.push({ x: dx / s + f.xOrigin, y: dy / s + f.yOrigin }) } parts.push(part) }
    return { type: isLine ? 'line' : 'polygon', parts, box: [x0, y0, x1, y1] };
  }

  // one row's values (blob fields given as {at, size} into the file instead of their bytes); null when its shape misses opts.box
  function parseRow(t, buf, base, id, box) {
    const c = cursor(buf), size = c.i32(), nNull = t.nNull ?? (t.nNull = t.fields.filter(f => f.nullable).length), flags = c.bytes(Math.ceil(nNull / 8));
    const row = {}; let ni = 0;
    for (const f of t.fields) {
      if (f.type === FT.OBJECTID) { row[f.name] = id; continue }
      if (f.nullable) { const isNull = (flags[ni >> 3] >> (ni & 7)) & 1; ni++; if (isNull) { row[f.name] = null; continue } }
      if (c.pos > size + 4) throw new Error('صف تالف في ' + t.file);
      switch (f.type) {
        case FT.INT16: row[f.name] = c.i16(); break;
        case FT.INT32: row[f.name] = c.i32(); break;
        case FT.FLOAT32: row[f.name] = c.f32(); break;
        case FT.FLOAT64: row[f.name] = c.f64(); break;
        case FT.INT64: row[f.name] = c.i64(); break;
        case FT.STRING: case FT.XML: { const n = c.varuint(); row[f.name] = utf8.decode(c.bytes(n)); break }
        case FT.DATETIME: case FT.DATE: row[f.name] = new Date(DAY0 + c.f64() * 864e5); break;
        case FT.TIME: row[f.name] = c.f64(); break;
        case FT.DATETIME_OFFSET: row[f.name] = new Date(DAY0 + c.f64() * 864e5); c.skip(2); break;
        case FT.GUID: case FT.GLOBALID: { const g = c.bytes(16), h = [...g].map(x => x.toString(16).padStart(2, '0'));
          row[f.name] = `{${h.slice(0, 4).reverse().join('')}-${h.slice(4, 6).reverse().join('')}-${h.slice(6, 8).reverse().join('')}-${h.slice(8, 10).join('')}-${h.slice(10).join('')}}`.toUpperCase(); break }
        case FT.GEOMETRY: { const n = c.varuint(), g = shapeOf(f, c.bytes(n), box); if (g && g.skip) return null; row[f.name] = g; break }
        case FT.BINARY: { const n = c.varuint(); row[f.name] = { at: base + c.pos, size: n }; c.skip(n); break }
        default: throw new Error('نوع حقل غير مدعوم ' + f.type);
      }
    }
    return row;
  }

  /* rows of a table in OBJECTID order, read in windows of CHUNK bytes (any table size).
     opts.box: only shapes whose extent meets it (layer coordinates); opts.limit: stop after so many rows (the result then has
     .truncated = true); opts.progress(done, total): awaited every few thousand rows (lets the page repaint). */
  async function readRows(src, t, opts = {}) {
    const name = t.file + '.gdbtable', size = src.size(name), offs = (await readOffsets(src, t.file)).sort((a, b) => a.off - b.off), out = [];
    let buf = null, at = 0, truncated = false;
    for (let i = 0; i < offs.length; i++) {
      const { id, off } = offs[i];
      if (!buf || off + 4 > at + buf.length) { buf = await src.read(name, off, Math.min(size, off + CHUNK)); at = off }
      const len = cursor(buf, off - at).i32(); if (len <= 0) continue;
      if (off + 4 + len > at + buf.length) { buf = await src.read(name, off, Math.min(size, off + Math.max(CHUNK, 4 + len))); at = off }
      const r = parseRow(t, buf.subarray(off - at, off - at + 4 + len), off, id, opts.box);
      if (r) { out.push([id, r]); if (opts.limit && out.length > opts.limit) { truncated = true; break } }
      if (opts.progress && i % 4000 === 3999) await opts.progress(i + 1, offs.length);
    }
    const rows = out.sort((a, b) => a[0] - b[0]).map(x => x[1]); rows.truncated = truncated;
    return rows;
  }

  // the database: every table of its catalogue (system tables GDB_* left out)
  async function openGdb(src) {
    if (!src.has('a00000001.gdbtable')) throw new Error('المجلد ليس قاعدة بيانات File Geodatabase (.gdb)');
    const cat = await readTableHeader(src, tableFile(1)), rows = await readRows(src, cat), tables = [];
    for (const r of rows) {
      const file = tableFile(r.ID ?? r.OBJECTID);
      if (!r.Name || /^GDB_/i.test(r.Name) || !src.has(file + '.gdbtable')) continue;
      try { tables.push({ name: r.Name, ...(await readTableHeader(src, file)) }) } catch (e) { /* a table of an unsupported kind is skipped */ }
    }
    return { src, tables };
  }

  /* ---------- attachments (…__ATTACH): one photo at a time ---------- */

  // the attachment table of a layer: only its row offsets are read now
  async function openAttach(src, att) {
    const f = re => att.fields.find(x => re.test(x.name)), rel = f(/^REL_(OBJECTID|GLOBALID)$/i), dataIdx = att.fields.findIndex(x => x.type === FT.BINARY);
    if (!rel || dataIdx < 0) return null;
    return { file: att.file + '.gdbtable', head: { ...att, fields: att.fields.slice(0, dataIdx + 1) }, offs: new Map((await readOffsets(src, att.file)).map(o => [o.id, o.off])),
      rel: rel.name, byGlobalId: /GLOBALID/i.test(rel.name), data: att.fields[dataIdx].name, nm: f(/^ATT_NAME$/i)?.name, ct: f(/^CONTENT_TYPE$/i)?.name, count: att.validRows, byRel: null, byName: null };
  }
  // the start of one attachment row (its fields up to the bytes, which are given as {at, size} in the file)
  async function readAttachRow(src, A, id) {
    const off = A.offs.get(id); if (!off) return null;
    const b = await src.read(A.file, off, off + 4096), len = cursor(b).i32(); if (len <= 0) return null;
    return parseRow(A.head, b.subarray(0, Math.min(b.length, 4 + len)), off, id);
  }
  const attachOf = (A, r) => r && r[A.data] ? { rel: r[A.rel], name: A.nm ? r[A.nm] : '', type: A.ct ? r[A.ct] : '', blob: r[A.data] } : null;
  const nameKey = s => String(s ?? '').trim().replace(/^.*[\\/]/, '').toLowerCase();
  // the full index (row starts read in parallel batches); built only when the quick search finds nothing
  async function buildAttachIndex(src, A) {
    if (A.byRel) return; const byRel = new Map(), byName = new Map(), ids = [...A.offs.keys()];
    for (let i = 0; i < ids.length; i += 256) {
      const rows = await Promise.all(ids.slice(i, i + 256).map(id => readAttachRow(src, A, id)));
      rows.forEach(r => { const a = attachOf(A, r); if (!a) return; if (!byRel.has(a.rel)) byRel.set(a.rel, a); if (a.name) byName.set(nameKey(a.name), a) });
    }
    A.byRel = byRel; A.byName = byName;
  }
  /* by OBJECTID without reading the whole table: attachments are written in the order of their rows, so REL_OBJECTID grows with
     ATTACHMENTID and a binary search needs about 15 row reads (the match is exact) */
  async function seekAttach(src, A, key) {
    const ids = A.ids || (A.ids = [...A.offs.keys()].sort((a, b) => a - b)); let lo = 0, hi = ids.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1, q = attachOf(A, await readAttachRow(src, A, ids[mid])); if (!q) return null;
      if (q.rel === key) return q; if (q.rel < key) lo = mid + 1; else hi = mid - 1;
    }
    return null;
  }
  // the attachment of a row (by OBJECTID or GlobalID, else by file name) → {bytes, type, name}, or null
  async function readAttachment(src, A, { oid, gid, name }) {
    const key = A.byGlobalId ? gid : oid; let a = null;
    if (!A.byRel && !A.byGlobalId && key != null) a = await seekAttach(src, A, key);
    if (!a) { await buildAttachIndex(src, A); a = (key != null && A.byRel.get(key)) || (name && A.byName.get(nameKey(name))) || null }
    if (!a) return null;
    const bytes = await src.read(A.file, a.blob.at, a.blob.at + a.blob.size);
    return { bytes, type: a.type || 'application/octet-stream', name: a.name || name || '' };
  }

  /* a source over File objects chosen with <input webkitdirectory>: the chosen folder may be the .gdb itself or a folder that
     holds it (the first .gdb found is used) */
  function folderSource(files) {
    const list = [...files], dirOf = f => { const p = (f.webkitRelativePath || f.name).split('/'); p.pop(); return p.join('/') };
    const cat = list.find(f => f.name.toLowerCase() === 'a00000001.gdbtable' && /\.gdb$/i.test(dirOf(f))) || list.find(f => f.name.toLowerCase() === 'a00000001.gdbtable');
    if (!cat) throw new Error('المجلد المختار ليس قاعدة ‎.gdb');
    const dir = dirOf(cat), byName = new Map(list.filter(f => dirOf(f) === dir).map(f => [f.name.toLowerCase(), f])), file = n => byName.get(n.toLowerCase());
    return { name: dir.split('/').pop() || 'قاعدة البيانات', has: n => byName.has(n.toLowerCase()), size: n => file(n).size,
      read: async (n, a, b) => new Uint8Array(await file(n).slice(a, b).arrayBuffer()) };
  }

  const api = { FT, openGdb, readTableHeader, readRows, shapeOf, openAttach, readAttachment, folderSource, nameKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FileGDB = api;
})(typeof window !== 'undefined' ? window : globalThis);
