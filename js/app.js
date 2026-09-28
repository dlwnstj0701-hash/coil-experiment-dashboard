import { evaluate, setupToState } from './physics.js';
import { FITSPEC, measurementStats, measuredRows, weightedLinearFit, experimentalMetrics, lmFit } from './analysis.js';
import { parseRaw, fileToPositions } from './import.js';
import { drawMain, drawResidual, drawLmOverlay, drawLmResidual, exportSvgPng } from './charts.js';

const $ = id => document.getElementById(id);
const fmt = (v, d = 3) => v == null || !Number.isFinite(v) ? '—' : Number(v).toFixed(d);
const signed = (v, d = 3) => v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(d)}`;
const AUTOSAVE = 'coil-experiment-dashboard:autosave:v1';
const SAVED = 'coil-experiment-dashboard:runs:v1';
const DEFAULT_SETUP = { I: 1, dw: .5, d: 53.6, h1: 25, h2: 10,
  c1: { R: 46.25, m: 40, n: 5, last: 26, dir: 1 },
  c2: { R: 22.25, m: 11, n: 1, last: 11, dir: 1 } };
const DEFAULT_POSITIONS = [0, 4.5, 10, 17.5, 23, 31.2, 41, 53.6];
const fresh = () => ({ version: 1, name: 'New experiment', setup: structuredClone(DEFAULT_SETUP),
  positions: DEFAULT_POSITIONS.map(x => ({ x, readings: [] })), selectedX: 0,
  linearFitSettings: { weighted: true }, lmSettings: { keys: ['k', 'R1'], weighted: true, maxIterations: 80, active: false },
  ui: { showModel1: false, showLm: true, setupChanged: false, residualMode: 'target' } });
let state = loadAutosave() || fresh();
let derived = null, currentRunKey = null, skipNextAutosave = false;

function loadAutosave() {
  try { return normalize(JSON.parse(localStorage.getItem(AUTOSAVE))); } catch (_) { return null; }
}
function normalize(raw) {
  if (!raw || raw.version !== 1 || !raw.setup || !Array.isArray(raw.positions)) return null;
  const next = fresh();
  next.name = String(raw.name || next.name).slice(0, 120);
  for (const key of ['I', 'dw', 'd', 'h1', 'h2']) {
    if (!Number.isFinite(Number(raw.setup[key]))) return null;
    next.setup[key] = Number(raw.setup[key]);
  }
  for (const c of ['c1', 'c2']) {
    if (!raw.setup[c]) return null;
    for (const key of ['R', 'm', 'n', 'last', 'dir']) {
      if (!Number.isFinite(Number(raw.setup[c][key]))) return null;
      next.setup[c][key] = Number(raw.setup[c][key]);
    }
  }
  if (!validSetup(next.setup)) return null;
  next.positions = raw.positions.map(p => ({ x: Number(p.x), readings: Array.isArray(p.readings) ? p.readings.map(Number).filter(Number.isFinite) : [] }))
    .sort((a, b) => a.x - b.x);
  if (next.positions.some((p, i, a) => !Number.isFinite(p.x) || p.x < 0 || p.x > next.setup.d || i > 0 && Math.abs(p.x - a[i - 1].x) < .00005)) return null;
  if (!next.positions.length) next.positions = [{ x: 0, readings: [] }];
  next.selectedX = next.positions.some(p => p.x === raw.selectedX) ? raw.selectedX : next.positions[0].x;
  next.lmSettings = { ...next.lmSettings, ...raw.lmSettings };
  next.lmSettings.keys = FITSPEC.map(f => f.key).filter(k => next.lmSettings.keys?.includes(k));
  next.ui = { ...next.ui, ...raw.ui };
  if (!['target', 'model'].includes(next.ui.residualMode)) next.ui.residualMode = 'target';
  return next;
}
function validSetup(s) {
  if (![s.I, s.dw, s.d, s.h1, s.h2].every(Number.isFinite) || s.I <= 0 || s.dw <= 0 || s.d <= 0 || s.h1 === s.h2) return false;
  return ['c1', 'c2'].every(c => { const q = s[c]; return q && q.R > 0 && Number.isInteger(q.m) && q.m > 0 && Number.isInteger(q.n) && q.n > 0 && Number.isInteger(q.last) && q.last > 0 && q.last <= q.m && [1, -1].includes(q.dir) && q.R - (q.n - 1) * s.dw / 2 > 0; });
}
function persist() {
  try { localStorage.setItem(AUTOSAVE, JSON.stringify(state)); $('saveStatus').textContent = 'Saved locally'; }
  catch (_) { $('saveStatus').textContent = 'Local save unavailable'; }
}
function changed({ rebuildReadings = false } = {}) {
  state.positions.sort((a, b) => a.x - b.x);
  if (!state.positions.some(p => p.x === state.selectedX)) state.selectedX = state.positions[0]?.x ?? null;
  renderAll({ rebuildReadings }); persist();
}
function selected() { return state.positions.find(p => p.x === state.selectedX); }
function setSelection(x, focus = false) {
  state.selectedX = x; changed({ rebuildReadings: true });
  if (focus) $('readingInputs').querySelector('input')?.focus();
}
function derive() {
  const S = setupToState(state.setup), E = evaluate(S), rows = measuredRows(state.positions), fit = weightedLinearFit(rows);
  const target = x => S.h1 + (S.h2 - S.h1) * x / state.setup.d;
  const metrics = experimentalMetrics(rows, x => E.total(x / 1000), target, fit);
  let lm = null, lmError = '';
  if (state.lmSettings.active) {
    try { lm = lmFit(S, rows, state.lmSettings.keys, state.lmSettings.weighted, state.lmSettings.maxIterations); }
    catch (e) { lmError = e.message; }
  }
  return { S, E, rows, fit, target, metrics, lm, lmError };
}
function renderAll({ rebuildReadings = false } = {}) {
  derived = derive();
  renderHeader(); renderTheory(); renderDecision(); renderKpis(); renderPositions(); renderCurrent(rebuildReadings);
  renderCharts(); renderSlope(); renderTable(); renderLm();
}
function renderHeader() {
  const { E } = derived, complete = state.positions.filter(p => p.readings.length >= 3).length;
  $('runName').value = state.name;
  $('setupSummary').textContent = `${fmt(state.setup.I, 2)} A  ·  ${fmt(state.setup.dw, 2)} mm wire  ·  d = ${fmt(state.setup.d, 1)} mm  ·  ${E.N1} + ${E.N2} turns  ·  target ${fmt(state.setup.h1, 1)} → ${fmt(state.setup.h2, 1)} Oe`;
  $('progressCount').textContent = `${complete} / ${state.positions.length}`;
  $('progressBar').style.width = `${100 * complete / Math.max(1, state.positions.length)}%`;
  $('setupChanged').hidden = !state.ui.setupChanged;
  $('genEnd').value = state.setup.d;
}
function metricRow(label, value) { return `<div class="metric-row"><span>${label}</span><strong>${value}</strong></div>`; }
function renderTheory() {
  const { E } = derived;
  $('theoryMax').textContent = fmt(E.maxDev, 3);
  $('theoryMetrics').innerHTML = [
    ['RMS deviation', `${fmt(E.rmsDev)} Oe`], ['Nonlinearity', `${fmt(E.nonlin)} Oe`],
    ['Model slope', `${fmt(E.fit.a / 100)} Oe/cm`], ['Start field', `${fmt(E.hAt0)} Oe`],
    ['End field', `${fmt(E.hAtD)} Oe`], ['Coil 1 alone', `${fmt(E.h1solo)} Oe`]
  ].map(([k, v]) => metricRow(k, v)).join('');
}
function renderDecision() {
  const { metrics } = derived;
  const values = metrics ? [metrics.target.maxAbs, metrics.target.rmse, metrics.model.rmse] : [0, 0, 0];
  const scale = Math.max(1, ...values);
  const items = [
    ['Max |Measured − Target|', values[0], '#e568a5', 'Largest measured target error'],
    ['Target RMSE', values[1], '#55b77c', 'Across measured positions'],
    ['Model RMSE', values[2], '#e8ae2f', 'Measured vs theoretical Model 2']
  ];
  $('decisionMetrics').innerHTML = items.map(([label, value, color, hint]) =>
    `<div class="decision-metric"><div class="line"><span>${label}</span><strong>${metrics ? fmt(value, 3) : '—'} <small>Oe</small></strong></div><div class="decision-track"><i style="width:${metrics ? Math.max(2, value / scale * 100) : 0}%;background:${color}"></i></div><small>${hint}</small></div>`
  ).join('');
  const endpoints = [
    ['Start', 0, state.setup.h1], ['End', state.setup.d, state.setup.h2]
  ];
  $('decisionEndpoints').innerHTML = endpoints.map(([label, x, target]) => {
    const point = state.positions.find(p => Math.abs(p.x - x) < .00005);
    const mean = point?.readings.length ? measurementStats(point.readings).mean : null;
    return `<div class="endpoint"><span>${label} · x = ${fmt(x, 1)} mm</span><strong>${fmt(mean)} <small>Oe</small></strong><small>${mean == null ? `Target ${fmt(target, 2)} Oe` : `Δ ${signed(mean - target)} Oe vs target`}</small></div>`;
  }).join('');
}
function renderKpis() {
  const { fit, metrics, S } = derived;
  const targetSlope = (S.h2 - S.h1) / S.d / 100;
  const slopeDifference = fit ? (fit.a / 100 / targetSlope - 1) * 100 : null;
  const list = [
    ['Measured slope', fit ? signed(fit.a / 100, 3) : '—', 'Oe/cm', slopeDifference == null ? 'Awaiting two positions' : `${signed(slopeDifference, 1)}% vs target`],
    ['Weighted R²', fit ? fmt(fit.r2, 4) : '—', '', 'Measurement linearity'],
    ['Mean STDEV', metrics ? fmt(metrics.meanSd) : '—', 'Oe', 'Repeatability'],
    ['Max STDEV', metrics ? fmt(metrics.maxSd) : '—', 'Oe', 'Largest observed scatter']
  ];
  $('experimentalKpis').innerHTML = list.map(([k, v, unit, sub]) => `<div class="kpi"><span>${k}</span><strong>${v} <small>${unit}</small></strong><small>${sub}</small></div>`).join('');
}
function renderPositions() {
  $('positionRail').innerHTML = state.positions.map(p => `<button type="button" data-x="${p.x}" class="${p.x === state.selectedX ? 'selected' : p.readings.length >= 3 ? 'complete' : ''}" aria-pressed="${p.x === state.selectedX}">${fmt(p.x, 1)}<span>${p.readings.length >= 3 ? 'complete' : p.x === state.selectedX ? 'current' : p.readings.length ? `${p.readings.length} readings` : 'pending'}</span></button>`).join('');
}
function renderCurrent(rebuildReadings) {
  const p = selected(), { E, target, fit } = derived;
  if (!p) return;
  $('currentX').textContent = `${fmt(p.x, 2)} mm`;
  $('currentComparison').innerHTML = [
    ['Target', target(p.x)], ['Model 2', E.total(p.x / 1000)], ['Model 1', E.thin(p.x / 1000)]
  ].map(([k, v]) => `<div class="comparison"><span>${k}</span><strong>${fmt(v)} <small>Oe</small></strong></div>`).join('');
  if (rebuildReadings || !$('readingInputs').children.length || Number($('readingInputs').dataset.x) !== p.x) {
    $('readingInputs').dataset.x = p.x;
    $('readingInputs').innerHTML = Array.from({ length: Math.max(3, p.readings.length) }, (_, i) => `<label>Reading ${i + 1}<input type="number" step="any" inputmode="decimal" data-index="${i}" value="${p.readings[i] ?? ''}" aria-label="Reading ${i + 1} at x ${p.x} mm"></label>`).join('');
  }
  const st = measurementStats(p.readings);
  $('currentStats').innerHTML = `<span>n <strong>${st.n}</strong></span><span>Mean <strong>${fmt(st.mean)}</strong> Oe</span><span>Sample STDEV <strong>${fmt(st.sd)}</strong> Oe</span><span>Δ target <strong>${signed(st.mean == null ? null : st.mean - target(p.x))}</strong> Oe</span><span>Δ model <strong>${signed(st.mean == null ? null : st.mean - E.total(p.x / 1000))}</strong> Oe</span>${fit && st.n ? `<span>Δ fit <strong>${signed(st.mean - (fit.a * p.x / 1000 + fit.b))}</strong> Oe</span>` : ''}`;
}
function tooltip(x, event) {
  const p = derived.rows.find(q => q.x === x); if (!p) return;
  const model = derived.E.total(x / 1000), target = derived.target(x), fit = derived.fit ? derived.fit.a * x / 1000 + derived.fit.b : null;
  const pairs = [['Raw', p.readings.join(', ')], ['Mean', fmt(p.mean)], ['STDEV', fmt(p.sd)], ['Target', fmt(target)], ['Model 2', fmt(model)], ['Weighted fit', fmt(fit)], ['Δ target', signed(p.mean - target)], ['Δ model', signed(p.mean - model)], ['Δ fit', signed(fit == null ? null : p.mean - fit)]];
  const tip = $('chartTooltip'); tip.innerHTML = `<strong>x = ${fmt(x, 2)} mm</strong><dl>${pairs.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
  const rect = $('mainChart').getBoundingClientRect(), host = $('mainChart').parentElement.getBoundingClientRect();
  tip.style.left = `${Math.min(event.clientX - host.left + 15, host.width - 195)}px`;
  tip.style.top = `${Math.max(8, event.clientY - host.top - 115)}px`; tip.hidden = false;
}
function renderCharts() {
  const { S, E, rows, fit, lm, metrics } = derived;
  $('chartTooltip').hidden = true;
  drawMain($('mainChart'), { S, E, rows, fit, lm, selectedX: state.selectedX, showModel1: state.ui.showModel1, showLm: state.ui.showLm, onSelect: setSelection, onHover: tooltip, onLeave: () => $('chartTooltip').hidden = true });
  const common = { xMax: state.setup.d, selectedX: state.selectedX, onSelect: setSelection };
  drawResidual($('targetResidualChart'), { ...common, rows: metrics?.targetResidual || [], summary: metrics?.target });
  drawResidual($('modelResidualChart'), { ...common, rows: metrics?.modelResidual || [], summary: metrics?.model });
  const mode = state.ui.residualMode, active = metrics?.[mode];
  $('residualTarget').setAttribute('aria-pressed', String(mode === 'target'));
  $('residualModel').setAttribute('aria-pressed', String(mode === 'model'));
  document.querySelector('.residual-grid').dataset.mode = mode;
  $('targetResidualChart').setAttribute('aria-hidden', String(mode !== 'target'));
  $('modelResidualChart').setAttribute('aria-hidden', String(mode !== 'model'));
  $('residualTitle').textContent = mode === 'target' ? 'Measured − Target' : 'Measured − Model 2';
  $('residualMax').textContent = active ? `${fmt(active.maxAbs)} Oe at ${fmt(active.at, 1)} mm` : '—';
  $('residualBias').textContent = active ? `${signed(active.bias)} Oe` : '—';
  const residualValues = metrics ? (mode === 'target' ? metrics.targetResidual : metrics.modelResidual).map(p => p.value) : [];
  $('residualInterpretation').textContent = !active ? 'Awaiting readings' : residualValues.length < 2 ? 'Add another position' :
    mode === 'target' && active.maxAbs <= 1 ? 'Within ±1 Oe at measured points' :
    residualValues.some(v => v > 0) && residualValues.some(v => v < 0) ? 'Residual changes sign' :
    active.bias > 0 ? 'Measured field stays above comparison' : 'Measured field stays below comparison';
  const badge = $('trackingBadge');
  badge.textContent = !metrics ? 'Awaiting measurements' : metrics.target.maxAbs <= 1 ? 'Target tracking · within ±1 Oe' : 'Target tracking · review deviation';
  badge.className = `tracking-badge ${!metrics ? '' : metrics.target.maxAbs <= 1 ? 'good' : 'attention'}`;
  $('targetResidualSummary').textContent = metrics ? `RMSE ${fmt(metrics.target.rmse)} · bias ${signed(metrics.target.bias)} Oe` : 'Awaiting measurements';
  $('modelResidualSummary').textContent = metrics ? `RMSE ${fmt(metrics.model.rmse)} · bias ${signed(metrics.model.bias)} Oe` : 'Awaiting measurements';
}
function renderSlope() {
  const { S, E, fit } = derived;
  const slopes = [{ label: 'TARGET', value: (S.h2 - S.h1) / S.d / 100, color: '#7d868b' },
    { label: 'MODEL 2', value: E.fit.a / 100, color: '#2879ab' },
    { label: 'MEASURED', value: fit?.a / 100, color: '#d66531' }];
  const finite = slopes.map(s => s.value).filter(Number.isFinite), lo = Math.min(...finite), hi = Math.max(...finite), span = Math.max(.1, hi - lo);
  $('slopeVisual').innerHTML = slopes.map(s => `<div class="slope-row"><span>${s.label}</span><div class="slope-track">${Number.isFinite(s.value) ? `<i style="--dot:${s.color};left:${15 + 70 * (s.value - lo) / span}%"></i>` : ''}</div><strong>${fmt(s.value)} Oe/cm</strong></div>`).join('');
  const pct = fit ? (fit.a / ((S.h2 - S.h1) / S.d) - 1) * 100 : null;
  $('slopeDelta').textContent = pct == null ? 'Awaiting linear fit' : `Measured vs target ${signed(pct, 1)}%`;
}
function renderTable() {
  const { E, target, fit } = derived;
  $('measurementTable').querySelector('tbody').innerHTML = state.positions.map(p => {
    const st = measurementStats(p.readings), model = E.total(p.x / 1000), t = target(p.x), fv = fit ? fit.a * p.x / 1000 + fit.b : null;
    const status = st.n >= 3 ? 'complete' : st.n ? 'partial' : 'empty';
    const val = q => q == null ? '—' : fmt(q);
    return `<tr data-x="${p.x}" class="${p.x === state.selectedX ? 'selected' : ''}"><td><details class="raw-detail"><summary>${fmt(p.x, 2)}</summary><span>Raw: ${p.readings.length ? p.readings.map(v => fmt(v, 3)).join(', ') : 'No readings'}</span></details></td><td>${st.n}</td><td>${val(st.mean)}</td><td>${val(st.sd)}</td><td>${fmt(t)}</td><td>${fmt(model)}</td><td>${val(fv)}</td><td>${signed(st.mean == null ? null : st.mean - t)}</td><td>${signed(st.mean == null ? null : st.mean - model)}</td><td>${signed(st.mean == null || fv == null ? null : st.mean - fv)}</td><td class="status-${status}">${status}</td></tr>`;
  }).join('');
}
function renderLm() {
  const { S, E, rows, lm, lmError } = derived;
  $('lmResult').hidden = !lm;
  $('lmSummary').textContent = lm ? `RMSE ${fmt(lm.rms)} Oe` : state.lmSettings.active ? 'Fit unavailable' : 'Not fitted';
  $('lmNote').textContent = lmError || (lm ? `${lm.converged ? 'Converged' : 'Max iterations reached'} after ${lm.it + 1} iterations. ${lm.worst && Math.abs(lm.worst.r) > .9 ? 'High parameter correlation; interpret individual estimates cautiously.' : ''}` : 'Fit a physical model after measuring at least three positions.');
  if (!lm) return;
  $('lmMetrics').innerHTML = [['Model RMSE', fmt(lm.rmsBase) + ' Oe'], ['LM RMSE', fmt(lm.rms) + ' Oe'], ['Reduced χ²/ν', fmt(lm.chi2red)], ['Max |ρ|', lm.worst ? fmt(Math.abs(lm.worst.r)) : '—'], ['Improvement', fmt((1 - lm.rms / lm.rmsBase) * 100, 1) + '%']].map(([k, v]) => `<div>${k}<strong>${v}</strong></div>`).join('');
  $('lmTable').querySelector('tbody').innerHTML = FITSPEC.map(f => {
    const j = lm.active.findIndex(a => a.key === f.key);
    return `<tr><td>${f.label}${j < 0 ? ' (fixed)' : ''}</td><td>${fmt(lm.design[f.key], 4)}</td><td>${fmt(lm.P[f.key], 4)}</td><td>${j < 0 ? '—' : fmt(lm.se[j], 4)}</td><td>${f.unit}</td></tr>`;
  }).join('');
  drawLmOverlay($('lmChart'), { S, E, rows, lm }); drawLmResidual($('lmResidualChart'), { S, E, rows, lm });
}

const SETUP_GROUPS = [
  { title: 'Common & target', fields: [
    ['I', 'Current I (A)', .01], ['dw', 'Wire diameter (mm)', .01], ['d', 'Coil separation d (mm)', .1],
    ['h1', 'Target start h1 (Oe)', .1], ['h2', 'Target end h2 (Oe)', .1]
  ] },
  { title: 'Coil 1', fields: [
    ['c1.R', 'Mean radius R1 (mm)', .01], ['c1.m', 'Turns per layer', 1], ['c1.n', 'Layers', 1],
    ['c1.last', 'Turns in last layer', 1], ['c1.dir', 'Winding direction', 0]
  ] },
  { title: 'Coil 2', fields: [
    ['c2.R', 'Mean radius R2 (mm)', .01], ['c2.m', 'Turns per layer', 1], ['c2.n', 'Layers', 1],
    ['c2.last', 'Turns in last layer', 1], ['c2.dir', 'Winding direction', 0]
  ] }
];
function pathValue(o, path) { return path.split('.').reduce((q, k) => q[k], o); }
function assignPath(o, path, value) { const parts = path.split('.'); const q = parts.length === 2 ? o[parts[0]] : o; q[parts.at(-1)] = value; }
function renderSetupFields() {
  $('setupFields').innerHTML = SETUP_GROUPS.map(g => `<div class="setup-group"><h3>${g.title}</h3><div class="setup-grid">${g.fields.map(([path, label, step]) => `<label>${label}${step ? `<input data-path="${path}" type="number" step="${step}" value="${pathValue(state.setup, path)}">` : `<select data-path="${path}"><option value="1" ${pathValue(state.setup, path) === 1 ? 'selected' : ''}>Forward +</option><option value="-1" ${pathValue(state.setup, path) === -1 ? 'selected' : ''}>Reverse −</option></select>`}</label>`).join('')}</div></div>`).join('');
}
function mutateSetup(input) {
  const path = input.dataset.path, value = Number(input.value);
  if (input.value === '' || !Number.isFinite(value)) return;
  const next = structuredClone(state.setup); assignPath(next, path, value);
  if (!validSetup(next)) { $('setupError').textContent = 'Check positive dimensions, integer turns/layers, last layer ≤ turns, and different target endpoints.'; return; }
  if (state.positions.some(p => p.x > next.d)) { $('setupError').textContent = 'Remove positions beyond the new separation before reducing d.'; return; }
  $('setupError').textContent = '';
  state.setup = next;
  if (state.positions.some(p => p.readings.length)) state.ui.setupChanged = true;
  changed();
}
function addPosition(x, focus = true) {
  x = +Number(x).toFixed(4);
  if (!Number.isFinite(x) || x < 0 || x > state.setup.d) { $('positionNote').textContent = `Position must be within 0–${fmt(state.setup.d, 2)} mm.`; return false; }
  if (state.positions.some(p => Math.abs(p.x - x) < .00005)) { $('positionNote').textContent = 'That position already exists.'; return false; }
  state.positions.push({ x, readings: [] }); $('positionNote').textContent = '';
  state.selectedX = x; changed({ rebuildReadings: true });
  if (focus) $('readingInputs').querySelector('input')?.focus();
  return true;
}
function readInputs() {
  const p = selected(); if (!p) return;
  p.readings = [...$('readingInputs').querySelectorAll('input')].map(i => i.value.trim()).filter(Boolean).map(Number).filter(Number.isFinite);
  changed();
}
function saveRun() {
  const runs = JSON.parse(localStorage.getItem(SAVED) || '{}');
  currentRunKey ||= String(Date.now());
  runs[currentRunKey] = { savedAt: new Date().toISOString(), data: state };
  localStorage.setItem(SAVED, JSON.stringify(runs)); $('saveStatus').textContent = 'Run saved';
}
function showRuns() {
  let runs; try { runs = JSON.parse(localStorage.getItem(SAVED) || '{}'); } catch (_) { runs = {}; }
  const host = $('savedRuns'); host.replaceChildren();
  if (!Object.keys(runs).length) host.textContent = 'No saved runs yet.';
  for (const [key, item] of Object.entries(runs).sort((a, b) => b[1].savedAt.localeCompare(a[1].savedAt))) {
    const row = document.createElement('div'), label = document.createElement('span'), actions = document.createElement('span');
    label.textContent = item.data.name; const date = document.createElement('small'); date.textContent = ` · ${new Date(item.savedAt).toLocaleString()}`; label.append(date);
    const load = document.createElement('button'); load.textContent = 'Load'; load.onclick = () => { const clean = normalize(item.data); if (!clean) return; state = clean; currentRunKey = key; $('loadDialog').close(); syncSettingsControls(); changed({ rebuildReadings: true }); renderSetupFields(); };
    const remove = document.createElement('button'); remove.textContent = 'Delete'; remove.onclick = () => { delete runs[key]; localStorage.setItem(SAVED, JSON.stringify(runs)); showRuns(); };
    actions.append(load, remove); row.append(label, actions); host.append(row);
  }
  $('loadDialog').showModal();
}
function download(name, content, type) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function exportCsv() {
  const nmax = Math.max(3, ...state.positions.map(p => p.readings.length));
  const head = ['x_mm', ...Array.from({ length: nmax }, (_, i) => `reading_${i + 1}`), 'n', 'mean_Oe', 'stdev_Oe', 'target_Oe', 'model1_Oe', 'model2_Oe', 'weighted_fit_Oe', 'delta_target_Oe', 'delta_model_Oe', 'delta_fit_Oe'];
  const lines = state.positions.map(p => {
    const st = measurementStats(p.readings), target = derived.target(p.x), model1 = derived.E.thin(p.x / 1000), model2 = derived.E.total(p.x / 1000), fv = derived.fit ? derived.fit.a * p.x / 1000 + derived.fit.b : null;
    return [p.x, ...Array.from({ length: nmax }, (_, i) => p.readings[i] ?? ''), st.n, st.mean ?? '', st.sd ?? '', target, model1, model2, fv ?? '', st.n ? st.mean - target : '', st.n ? st.mean - model2 : '', st.n && fv != null ? st.mean - fv : ''].join(',');
  });
  download('coil-experiment-measurements.csv', [head.join(','), ...lines].join('\r\n'), 'text/csv;charset=utf-8');
}
function copyTable() {
  const rows = [...$('measurementTable').querySelectorAll('tr')].map(tr => [...tr.children].map(td => td.textContent.trim()).join('\t'));
  navigator.clipboard.writeText(rows.join('\n')).then(() => $('saveStatus').textContent = 'Table copied').catch(() => $('saveStatus').textContent = 'Clipboard unavailable');
}
async function importDataFile(file) {
  if (!file) return;
  try {
    const result = await fileToPositions(file);
    const inWindow = result.positions.filter(p => p.x >= 0 && p.x <= state.setup.d);
    if (!inWindow.length) throw new Error('No measurement positions inside [0, d].');
    for (const p of inWindow) {
      const existing = state.positions.find(q => q.x === p.x);
      if (existing) existing.readings.push(...p.readings);
      else state.positions.push(p);
    }
    state.selectedX = inWindow[0].x;
    $('importNote').textContent = `${file.name}: ${inWindow.length} positions imported. ${result.mapping}; ${result.positions.length - inWindow.length} outside window skipped.`;
    changed({ rebuildReadings: true });
  } catch (e) { $('importNote').textContent = `Import failed: ${e.message}`; }
}
async function importRunJson(file) {
  if (!file) return;
  try {
    const parsed = normalize(JSON.parse(await file.text()));
    if (!parsed) throw new Error('Invalid run JSON');
    state = parsed; currentRunKey = null; syncSettingsControls(); changed({ rebuildReadings: true }); renderSetupFields();
    $('importNote').textContent = `${file.name} loaded.`;
  } catch (e) { $('importNote').textContent = `Import failed: ${e.message}`; }
}

$('setupOpen').onclick = () => { renderSetupFields(); $('setupDialog').showModal(); };
$('setupFields').addEventListener('input', e => { if (e.target.dataset.path) mutateSetup(e.target); });
$('setupFields').addEventListener('change', e => { if (e.target.dataset.path) mutateSetup(e.target); });
$('applyModel').onclick = () => { state.ui.setupChanged = false; changed(); };
$('freshMeasurements').onclick = () => { state.positions.forEach(p => p.readings = []); state.ui.setupChanged = false; state.lmSettings.active = false; changed({ rebuildReadings: true }); };
$('runName').addEventListener('change', e => { state.name = e.target.value.trim() || 'New experiment'; changed(); });
$('positionRail').onclick = e => { const b = e.target.closest('button[data-x]'); if (b) setSelection(Number(b.dataset.x), true); };
$('addPosition').onclick = () => { if (addPosition($('newPosition').value)) $('newPosition').value = ''; };
$('newPosition').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('addPosition').click(); } });
$('editPosition').onclick = () => {
  const p = selected(); if (!p) return;
  const raw = prompt('Position x (mm)', p.x); if (raw == null) return;
  const x = +Number(raw).toFixed(4);
  if (!Number.isFinite(x) || x < 0 || x > state.setup.d || state.positions.some(q => q !== p && q.x === x)) { $('positionNote').textContent = 'Enter a unique position within [0, d].'; return; }
  p.x = x; state.selectedX = x; changed({ rebuildReadings: true });
};
$('deletePosition').onclick = () => {
  if (state.positions.length === 1) { $('positionNote').textContent = 'Keep at least one position.'; return; }
  const p = selected(); if (p.readings.length && !confirm(`Delete ${p.x} mm and its readings?`)) return;
  const i = state.positions.indexOf(p); state.positions.splice(i, 1); state.selectedX = state.positions[Math.min(i, state.positions.length - 1)].x; changed({ rebuildReadings: true });
};
$('generatePositions').onclick = () => {
  const start = Number($('genStart').value), end = Number($('genEnd').value), step = Number($('genStep').value);
  if (![start, end, step].every(Number.isFinite) || start < 0 || end > state.setup.d || end < start || step <= 0 || (end - start) / step > 500) { $('positionNote').textContent = 'Check start, end, and positive step (max 500 positions).'; return; }
  let added = 0;
  for (let i = 0; i <= Math.floor((end - start) / step + 1e-9); i++) {
    const x = +Math.min(end, start + i * step).toFixed(4);
    if (!state.positions.some(p => Math.abs(p.x - x) < .00005)) { state.positions.push({ x, readings: [] }); added++; }
  }
  $('positionNote').textContent = `${added} positions added.`; changed({ rebuildReadings: true });
};
$('readingInputs').addEventListener('input', e => { if (e.target.matches('input')) readInputs(); });
$('readingInputs').addEventListener('keydown', e => {
  if (e.key !== 'Enter' || !e.target.matches('input')) return;
  e.preventDefault();
  const inputs = [...$('readingInputs').querySelectorAll('input')], i = inputs.indexOf(e.target);
  if (i < inputs.length - 1) inputs[i + 1].focus(); else $('saveNext').focus();
});
$('addReading').onclick = () => {
  const p = selected(), inputs = $('readingInputs');
  const index = inputs.querySelectorAll('input').length;
  inputs.insertAdjacentHTML('beforeend', `<label>Reading ${index + 1}<input type="number" step="any" inputmode="decimal" data-index="${index}" aria-label="Reading ${index + 1} at x ${p.x} mm"></label>`);
  inputs.lastElementChild.querySelector('input').focus();
};
$('saveNext').onclick = () => {
  readInputs(); const i = state.positions.findIndex(p => p.x === state.selectedX);
  if (i >= 0 && i < state.positions.length - 1) setSelection(state.positions[i + 1].x, true);
  else { $('saveStatus').textContent = 'End of positions'; $('saveNext').focus(); }
};
$('measurementTable').addEventListener('click', e => { if (e.target.closest('details')) return; const tr = e.target.closest('tr[data-x]'); if (tr) setSelection(Number(tr.dataset.x), true); });
$('showModel1').onchange = e => { state.ui.showModel1 = e.target.checked; changed(); };
$('showLm').onchange = e => { state.ui.showLm = e.target.checked; changed(); };
$('residualTarget').onclick = () => { state.ui.residualMode = 'target'; changed(); };
$('residualModel').onclick = () => { state.ui.residualMode = 'model'; changed(); };
$('fitParameters').innerHTML = FITSPEC.map(f => `<label><input type="checkbox" data-key="${f.key}" ${state.lmSettings.keys.includes(f.key) ? 'checked' : ''}>${f.label}</label>`).join('');
function syncSettingsControls() {
  for (const input of $('fitParameters').querySelectorAll('input')) input.checked = state.lmSettings.keys.includes(input.dataset.key);
  $('fitWeight').value = state.lmSettings.weighted ? '1' : '0';
  $('fitIterations').value = state.lmSettings.maxIterations;
  $('showModel1').checked = state.ui.showModel1; $('showLm').checked = state.ui.showLm;
}
$('fitParameters').onchange = () => { state.lmSettings.keys = [...$('fitParameters').querySelectorAll('input:checked')].map(i => i.dataset.key); changed(); };
$('fitWeight').value = state.lmSettings.weighted ? '1' : '0';
$('fitWeight').onchange = e => { state.lmSettings.weighted = e.target.value === '1'; changed(); };
$('fitIterations').value = state.lmSettings.maxIterations;
$('fitIterations').onchange = e => { state.lmSettings.maxIterations = Math.max(5, Number(e.target.value) || 80); changed(); };
$('runLm').onclick = () => { state.lmSettings.active = true; changed(); };
$('clearLm').onclick = () => { state.lmSettings.active = false; changed(); };
$('saveRun').onclick = saveRun; $('loadRun').onclick = showRuns; $('closeLoad').onclick = () => $('loadDialog').close();
$('newRun').onclick = () => { if (state.positions.some(p => p.readings.length) && !confirm('Start a new run? Unsaved readings will be replaced.')) return; state = fresh(); currentRunKey = null; syncSettingsControls(); changed({ rebuildReadings: true }); renderSetupFields(); };
$('resetRun').onclick = () => { if (state.positions.some(p => p.readings.length) && !confirm('Reset the current run to defaults?')) return; const name = state.name; state = fresh(); state.name = name; syncSettingsControls(); changed({ rebuildReadings: true }); renderSetupFields(); };
$('exportJson').onclick = () => download('coil-experiment-run.json', JSON.stringify(state, null, 2), 'application/json');
$('exportCsv').onclick = exportCsv; $('copyTable').onclick = copyTable;
$('exportMain').onclick = () => exportSvgPng($('mainChart'), 'coil-field-profile.png');
$('exportTargetResidual').onclick = () => exportSvgPng($('targetResidualChart'), 'coil-target-residual.png');
$('exportModelResidual').onclick = () => exportSvgPng($('modelResidualChart'), 'coil-model-residual.png');
$('importRaw').onclick = () => {
  const { positions, bad } = parseRaw($('rawInput').value);
  const accepted = positions.filter(p => p.x >= 0 && p.x <= state.setup.d);
  if (!accepted.length) { $('importNote').textContent = 'No valid positions in [0, d].'; return; }
  for (const p of accepted) { const old = state.positions.find(q => q.x === p.x); if (old) old.readings.push(...p.readings); else state.positions.push(p); }
  state.selectedX = accepted[0].x; $('importNote').textContent = `${accepted.length} positions imported; ${bad} unreadable lines skipped.`; changed({ rebuildReadings: true });
};
$('importFile').onclick = () => $('dataFile').click();
$('dataFile').onchange = e => { importDataFile(e.target.files[0]); e.target.value = ''; };
$('importJson').onclick = () => $('jsonFile').click();
$('jsonFile').onchange = e => { importRunJson(e.target.files[0]); e.target.value = ''; };
$('rawInput').addEventListener('dragover', e => e.preventDefault());
$('rawInput').addEventListener('drop', e => { if (e.dataTransfer.files.length) { e.preventDefault(); importDataFile(e.dataTransfer.files[0]); } });

$('showModel1').checked = state.ui.showModel1;
$('showLm').checked = state.ui.showLm;
document.querySelector('.residual-grid').append(document.querySelector('.measurement-panel'));
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { renderCharts(); if (derived.lm) renderLm(); }, 100); });
renderAll({ rebuildReadings: true });
