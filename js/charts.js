const NS = 'http://www.w3.org/2000/svg';
const C = { target: '#858b8a', model: '#2878a5', measurement: '#bb683d', fit: '#796b96', model1: '#2f8981', lm: '#538266' };
const f = n => Number(n).toFixed(2);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function base(svg, { width = 1000, height = 300, xMax, yMin, yMax, yTicks = 5 }) {
  const p = { l: 55, r: 22, t: 14, b: 34 }, iw = width - p.l - p.r, ih = height - p.t - p.b;
  const X = x => p.l + x / xMax * iw, Y = y => p.t + (yMax - y) / (yMax - yMin) * ih;
  let html = '';
  for (let i = 0; i <= yTicks; i++) {
    const v = yMin + (yMax - yMin) * i / yTicks, yy = Y(v);
    html += `<line class="grid-line" x1="${p.l}" y1="${yy}" x2="${width - p.r}" y2="${yy}"/><text x="${p.l - 8}" y="${yy + 3}" text-anchor="end">${f(v)}</text>`;
  }
  for (let i = 0; i <= 5; i++) {
    const x = xMax * i / 5, xx = X(x);
    html += `<line class="grid-line" x1="${xx}" y1="${p.t}" x2="${xx}" y2="${height - p.b}"/><text x="${xx}" y="${height - 12}" text-anchor="middle">${f(x)}</text>`;
  }
  html += `<line class="axis-line" x1="${p.l}" y1="${height - p.b}" x2="${width - p.r}" y2="${height - p.b}"/><text x="${width - p.r}" y="${height - 3}" text-anchor="end">x (mm)</text>`;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.innerHTML = html;
  return { X, Y, p, width, height };
}

function path(points, X, Y) { return points.map((p, i) => `${i ? 'L' : 'M'}${X(p.x)},${Y(p.y)}`).join(' '); }
function addPath(svg, points, X, Y, color, width = 2, dash = '') {
  if (points.length < 2) return;
  svg.insertAdjacentHTML('beforeend', `<path d="${path(points, X, Y)}" fill="none" stroke="${color}" stroke-width="${width}" ${dash ? `stroke-dasharray="${dash}"` : ''} vector-effect="non-scaling-stroke"/>`);
}
function extent(values, padding = .09) {
  let min = Math.min(...values), max = Math.max(...values);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [-1, 1];
  const span = Math.max(max - min, 0.4);
  return [min - span * padding, max + span * padding];
}
function circles(svg, rows, X, Y, selectedX, onSelect, onHover, onLeave, radius = 5) {
  for (const row of rows) {
    if (row.x === selectedX) svg.insertAdjacentHTML('beforeend', `<circle cx="${X(row.x)}" cy="${Y(row.y)}" r="${radius + 5}" fill="none" stroke="${C.measurement}" stroke-width="1.5" opacity=".65" vector-effect="non-scaling-stroke"/>`);
    const circle = document.createElementNS(NS, 'circle');
    circle.setAttribute('cx', X(row.x)); circle.setAttribute('cy', Y(row.y));
    circle.setAttribute('r', row.x === selectedX ? radius + 1 : radius);
    circle.setAttribute('fill', C.measurement); circle.setAttribute('stroke', '#fff'); circle.setAttribute('stroke-width', '2');
    circle.setAttribute('class', 'point-hit'); circle.setAttribute('tabindex', '0');
    circle.setAttribute('role', 'button'); circle.setAttribute('aria-label', `Select x ${row.x} millimeters`);
    circle.addEventListener('click', () => onSelect(row.x));
    circle.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(row.x); } });
    circle.addEventListener('mouseenter', e => onHover?.(row.x, e));
    circle.addEventListener('mousemove', e => onHover?.(row.x, e));
    circle.addEventListener('mouseleave', () => onLeave?.());
    svg.append(circle);
  }
}

export function drawMain(svg, { S, E, rows, fit, lm, selectedX, showFit, showModel1, showLm, onSelect, onHover, onLeave }) {
  const fitRange = rows.length ? [rows[0].x / 1000, rows[rows.length - 1].x / 1000] : [0, S.d];
  const values = [...E.wm, ...E.wt, ...rows.flatMap(p => [p.mean - p.sd, p.mean + p.sd])];
  if (fit && showFit) values.push(...fitRange.map(x => fit.a * x + fit.b));
  if (lm && showLm) for (let i = 0; i <= 100; i++) values.push(lm.fn(i * S.d * 1000 / 100));
  const [yMin, yMax] = extent(values);
  const { X, Y } = base(svg, { width: Math.max(320, svg.clientWidth), height: Math.max(240, svg.clientHeight), xMax: S.d * 1000, yMin, yMax });
  const xys = vals => E.wx.map((x, i) => ({ x: x * 1000, y: vals[i] }));
  addPath(svg, xys(E.wt), X, Y, C.target, 1.5, '6 5');
  if (showModel1) addPath(svg, xys(E.wthin), X, Y, C.model1, 1.6, '5 5');
  addPath(svg, xys(E.wm), X, Y, C.model, 2.6);
  if (fit && showFit) addPath(svg, fitRange.map(x => ({ x: x * 1000, y: fit.a * x + fit.b })), X, Y, C.fit, 1.8, '7 4');
  if (lm && showLm) addPath(svg, Array.from({ length: 121 }, (_, i) => ({ x: i * S.d * 1000 / 120, y: lm.fn(i * S.d * 1000 / 120) })), X, Y, C.lm, 2.4, '10 4');
  for (const row of rows) {
    const x = X(row.x), a = Y(row.mean - row.sd), b = Y(row.mean + row.sd);
    svg.insertAdjacentHTML('beforeend', `<path d="M${x},${a}V${b} M${x - 5},${a}H${x + 5} M${x - 5},${b}H${x + 5}" stroke="${C.measurement}" stroke-width="1.7" fill="none" vector-effect="non-scaling-stroke"/>`);
  }
  circles(svg, rows.map(p => ({ x: p.x, y: p.mean })), X, Y, selectedX, onSelect, onHover, onLeave, 5);
}

export function drawResidual(svg, { xMax, rows, selectedX, color = C.measurement, onSelect, summary, comparison }) {
  const vals = rows.map(p => p.value);
  const radius = Math.max(.25, ...vals.map(Math.abs)) * 1.24;
  const { X, Y, p, width } = base(svg, { width: Math.max(320, svg.clientWidth), height: Math.max(160, svg.clientHeight), xMax, yMin: -radius, yMax: radius, yTicks: 4 });
  svg.insertAdjacentHTML('beforeend', `<line class="zero-line" x1="${p.l}" y1="${Y(0)}" x2="${width - p.r}" y2="${Y(0)}"/>`);
  if (comparison?.length) addPath(svg, comparison, X, Y, C.lm, 2);
  for (const row of rows) svg.insertAdjacentHTML('beforeend', `<line x1="${X(row.x)}" y1="${Y(0)}" x2="${X(row.x)}" y2="${Y(row.value)}" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/>`);
  circles(svg, rows.map(p => ({ x: p.x, y: p.value })), X, Y, selectedX, onSelect, null, null, 4);
  if (summary && rows.length) {
    const extreme = rows.find(p => p.x === summary.at);
    if (extreme) {
      const nearStart = extreme.x < xMax * .08, nearEnd = extreme.x > xMax * .92;
      const labelX = X(extreme.x) + (nearStart ? 10 : nearEnd ? -10 : 0);
      const anchor = nearStart ? 'start' : nearEnd ? 'end' : 'middle';
      svg.insertAdjacentHTML('beforeend', `<text x="${labelX}" y="${Math.max(11, Y(extreme.value) - 10)}" text-anchor="${anchor}" fill="${color}">max ${f(summary.maxAbs)}</text>`);
    }
  }
}

export function drawLmOverlay(svg, { S, E, rows, lm }) {
  const values = [...E.wm, ...rows.flatMap(p => [p.mean - p.sd, p.mean + p.sd]), ...Array.from({ length: 61 }, (_, i) => lm.fn(i * S.d * 1000 / 60))];
  const [yMin, yMax] = extent(values);
  const { X, Y } = base(svg, { width: Math.max(320, svg.clientWidth), height: Math.max(190, svg.clientHeight), xMax: S.d * 1000, yMin, yMax, yTicks: 4 });
  addPath(svg, E.wx.map((x, i) => ({ x: x * 1000, y: E.wm[i] })), X, Y, C.model, 2);
  addPath(svg, Array.from({ length: 121 }, (_, i) => ({ x: i * S.d * 1000 / 120, y: lm.fn(i * S.d * 1000 / 120) })), X, Y, C.lm, 2.4);
  for (const p of rows) {
    const x = X(p.x), upper = Y(p.mean + p.sd), lower = Y(p.mean - p.sd);
    svg.insertAdjacentHTML('beforeend', `<path d="M${x},${upper}V${lower} M${x - 4},${upper}H${x + 4} M${x - 4},${lower}H${x + 4}" stroke="${C.measurement}" stroke-width="1.4" fill="none" vector-effect="non-scaling-stroke"/><circle cx="${x}" cy="${Y(p.mean)}" r="3.5" fill="${C.measurement}"/>`);
  }
}

export function drawLmResidual(svg, { S, rows, E, lm }) {
  const before = rows.map(p => ({ x: p.x, y: p.mean - E.total(p.x / 1000) }));
  const after = rows.map(p => ({ x: p.x, y: p.mean - lm.fn(p.x) }));
  const radius = Math.max(.2, ...[...before, ...after].map(p => Math.abs(p.y))) * 1.25;
  const { X, Y, p, width } = base(svg, { width: Math.max(320, svg.clientWidth), height: Math.max(190, svg.clientHeight), xMax: S.d * 1000, yMin: -radius, yMax: radius, yTicks: 4 });
  svg.insertAdjacentHTML('beforeend', `<line class="zero-line" x1="${p.l}" y1="${Y(0)}" x2="${width - p.r}" y2="${Y(0)}"/>`);
  addPath(svg, before, X, Y, C.model, 1.7); addPath(svg, after, X, Y, C.lm, 2.2);
  for (const q of before) svg.insertAdjacentHTML('beforeend', `<circle cx="${X(q.x)}" cy="${Y(q.y)}" r="3" fill="${C.model}"/>`);
  for (const q of after) svg.insertAdjacentHTML('beforeend', `<rect x="${X(q.x) - 3}" y="${Y(q.y) - 3}" width="6" height="6" fill="${C.lm}"/>`);
}

export async function exportSvgPng(svg, filename) {
  const clone = svg.cloneNode(true);
  clone.setAttribute('xmlns', NS);
  clone.setAttribute('width', '1400'); clone.setAttribute('height', '500');
  const style = document.createElementNS(NS, 'style');
  style.textContent = 'text{font-family:Arial,sans-serif;fill:#71817e;font-size:10px}.axis-line{stroke:#bfcac5;stroke-width:1}.grid-line{stroke:#edf0f0;stroke-width:1}.zero-line{stroke:#a0aaa7;stroke-width:1.2;stroke-dasharray:4 3}';
  clone.prepend(style);
  const svgText = new XMLSerializer().serializeToString(clone);
  const image = new Image(), url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
    const canvas = document.createElement('canvas'); canvas.width = 1400; canvas.height = 500;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } finally { URL.revokeObjectURL(url); }
}
