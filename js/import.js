// File parsing follows the reference Measurements tab; the first XLSX sheet is used.
export function parseRaw(text) {
  const map = new Map(); let bad = 0;
  text.trim().split(/\n+/).forEach(line => {
    const parts = line.trim().split(/[\s,;\t]+/).filter(t => t !== '').map(Number).filter(v => !isNaN(v));
    if (parts.length < 2) { if (line.trim()) bad++; return; }
    const x = +parts[0].toFixed(4);
    if (!map.has(x)) map.set(x, []);
    for (let i = 1; i < parts.length; i++) map.get(x).push(parts[i]);
  });
  return { positions: [...map.keys()].sort((a, b) => a - b).map(x => ({ x, readings: map.get(x) })), bad };
}

export function classifyHeader(headerCells) {
  const EXCLUDE = /평균|편차|표준|오차|모델|이론|번호|전류|온도|비고|메모|mean|avg|average|\bstd\b|stdev|\bsd\b|error|model|\bno\b|#|current|temp|note/i;
  const DIST = /거리|위치|distance|position|\bx\b|mm/i;
  const MEAS = /회|차|측정|reading|meas|\boe\b|gauss|\bh\b/i;
  const n = headerCells.length, role = new Array(n).fill(null);
  for (let j = 0; j < n; j++) if (headerCells[j] && EXCLUDE.test(headerCells[j])) role[j] = 'exclude';
  let distIdx = -1;
  for (let j = 0; j < n; j++) if (!role[j] && DIST.test(headerCells[j])) { distIdx = j; role[j] = 'dist'; break; }
  for (let j = 0; j < n; j++) if (!role[j] && j !== distIdx && MEAS.test(headerCells[j])) role[j] = 'meas';
  let measIdx = role.map((r, j) => r === 'meas' ? j : -1).filter(j => j >= 0), fellBack = false;
  if (distIdx >= 0 && !measIdx.length) {
    measIdx = role.map((r, j) => r === null && j !== distIdx ? j : -1).filter(j => j >= 0);
    fellBack = true;
  }
  const ignored = role.map((r, j) => r === 'exclude' ? j : -1).filter(j => j >= 0);
  return { distIdx, measIdx, ignored, fellBack };
}

export function cellsToLines(rows) {
  const nonBlank = rows.map(r => [...r].map(c => String(c ?? '').trim())).filter(r => r.some(c => c !== ''));
  let headerCells = null;
  for (const r of nonBlank) {
    const first = r.find(c => c !== '');
    if (first !== undefined && isFinite(Number(first))) break;
    headerCells = r;
  }
  const mapping = headerCells ? classifyHeader(headerCells) : null;
  const useHeader = !!headerCells && mapping.distIdx >= 0;
  let skipped = 0;
  const lines = [];
  nonBlank.forEach(r => {
    const first = r.find(c => c !== '');
    if (first === undefined || !isFinite(Number(first))) { skipped++; return; }
    const num = c => c === undefined || c === '' ? NaN : Number(c);
    const dist = num(useHeader ? r[mapping.distIdx] : r[0]);
    const values = (useHeader ? mapping.measIdx.map(j => r[j]) : r.slice(1)).map(num).filter(Number.isFinite);
    if (!Number.isFinite(dist) || !values.length) { skipped++; return; }
    lines.push([dist, ...values].join(', '));
  });
  return { lines, skipped, mapping: useHeader ? `x: column ${mapping.distIdx + 1}; readings: ${mapping.measIdx.map(j => j + 1).join(', ')}` : 'x: first column; readings: remaining columns' };
}

export function splitDelimited(text) {
  const first = text.split(/\r?\n/).find(l => l.trim()) || '';
  const delim = first.includes('\t') ? '\t' : first.includes(';') ? ';' : ',';
  return text.split(/\r?\n/).map(line => line.split(delim).map(c => c.replace(/^"|"$/g, '')));
}

export async function readTextSmart(file) {
  const buf = await file.arrayBuffer();
  let t = new TextDecoder('utf-8').decode(buf);
  if (t.includes('\uFFFD')) { try { t = new TextDecoder('euc-kr').decode(buf); } catch (_) { /* unsupported encoding */ } }
  return t.replace(/^\uFEFF/, '');
}

async function unzipEntries(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Invalid XLSX ZIP file');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = {}, dec = new TextDecoder('utf-8');
  for (let k = 0; k < count; k++) {
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + elen + clen;
    if (!/\.(xml|rels)$/.test(name)) continue;
    const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
    const data = u8.subarray(start, start + csize);
    out[name] = async () => {
      if (method === 0) return dec.decode(data);
      if (method !== 8) throw new Error('Unsupported XLSX compression');
      const ds = new DecompressionStream('deflate-raw');
      return dec.decode(await new Response(new Blob([data]).stream().pipeThrough(ds)).arrayBuffer());
    };
  }
  return out;
}

export async function readXlsxRows(file) {
  const z = await unzipEntries(await file.arrayBuffer());
  const xml = async n => z[n] ? new DOMParser().parseFromString(await z[n](), 'application/xml') : null;
  const byTag = (doc, tag) => doc ? [...doc.getElementsByTagNameNS('*', tag)] : [];
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const wb = await xml('xl/workbook.xml'), rels = await xml('xl/_rels/workbook.xml.rels');
  const firstSheet = byTag(wb, 'sheet')[0];
  if (firstSheet && rels) {
    const rid = firstSheet.getAttribute('r:id') || firstSheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const rel = byTag(rels, 'Relationship').find(r => r.getAttribute('Id') === rid);
    if (rel) { const t = rel.getAttribute('Target'); sheetPath = t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, ''); }
  }
  const shared = byTag(await xml('xl/sharedStrings.xml'), 'si').map(si => byTag(si, 't').map(t => t.textContent).join(''));
  const sheet = await xml(sheetPath);
  if (!sheet) throw new Error('First worksheet not found');
  const colIdx = ref => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  return byTag(sheet, 'row').map(row => {
    const arr = [];
    byTag(row, 'c').forEach((c, i) => {
      const t = c.getAttribute('t'), v = byTag(c, 'v')[0];
      let val = '';
      if (t === 's') val = v ? shared[+v.textContent] ?? '' : '';
      else if (t === 'inlineStr') val = byTag(c, 't').map(x => x.textContent).join('');
      else val = v ? v.textContent : '';
      const r = c.getAttribute('r'); arr[r ? colIdx(r) : i] = val;
    });
    return arr;
  });
}

export async function fileToPositions(file) {
  const rows = /\.xlsx$/i.test(file.name) ? await readXlsxRows(file) : splitDelimited(await readTextSmart(file));
  const result = cellsToLines(rows);
  return { ...result, ...parseRaw(result.lines.join('\n')) };
}
