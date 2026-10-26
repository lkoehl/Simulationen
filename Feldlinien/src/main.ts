import './style.css';
import { createSolverCache, Field } from './physics/field';
import { CHARGE_RADIUS, PROBE_RADIUS, REST_METAL, resetProbe, stepProbes, type Motion } from './physics/probes';
import {
  bodiesOf,
  distToShape,
  isConductor,
  newId,
  type ConductorObject,
  type PointCharge,
  type Probe,
  type SceneObject
} from './physics/scene';
import { freeSpot } from './placement';
import { makeProbe, presets } from './presets';
import { draw, formatNumber, readColors, type FieldPicture, type Show, type View } from './render';
import { computeEquipotentials, sampleVectors } from './viz/equipotential';
import { computeFieldLines, surfaceSamples, type Bounds } from './viz/fieldlines';

// Only visible when the page is opened without a web server (see README).
document.getElementById('file-warning')?.remove();
document.getElementById('boot-style')?.remove();

const canvas = document.getElementById('field') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const stage = document.querySelector('.stage') as HTMLElement;
const inspector = document.getElementById('inspector') as HTMLElement;
const toast = document.getElementById('toast') as HTMLElement;
const scenarioSelect = document.getElementById('scenario') as HTMLSelectElement;
const playBtn = document.getElementById('play-btn') as HTMLButtonElement;
const themeBtn = document.getElementById('theme-btn') as HTMLButtonElement;
const densityInput = document.getElementById('density') as HTMLInputElement;
const motionNote = document.getElementById('motion-note') as HTMLElement;
const helpDialog = document.getElementById('help') as HTMLDialogElement;
const narrowLayout = matchMedia('(max-width: 860px)');

// State

let objects: SceneObject[] = [];
let selectedId: number | null = null;
let running = true;
let motion: Motion = 'friction';
let linesPerCharge = 8;
const show: Show = { lines: true, vectors: false, equi: false, induced: true, force: true, trails: true };

const view: View = { width: 0, height: 0, dpr: 1, zoom: 1 };
const solverCache = createSolverCache();
let field = new Field([], []);
const picture: FieldPicture = { lines: [], equi: null, vectors: null, surfaces: [] };
// The field is solved again when objects change; the layers drawn from it are
// recomputed separately, e.g. when only the view or a display switch changes.
let fieldDirty = true;
let linesDirty = true;
let equiDirty = true;
let vectorsDirty = true;
let needsDraw = true;
// While dragging or sliding, equipotentials are computed on a coarser grid.
let interacting = false;
let interactTimer = 0;
let colors = readColors();

function markFieldDirty() {
  fieldDirty = true;
  needsDraw = true;
}

function markLayersDirty() {
  linesDirty = equiDirty = vectorsDirty = true;
  needsDraw = true;
}

function setInteracting(v: boolean) {
  clearTimeout(interactTimer);
  if (v) {
    interacting = true;
    // fallback in case the end of the interaction is never reported
    interactTimer = window.setTimeout(() => setInteracting(false), 250);
  } else if (interacting) {
    interacting = false;
    equiDirty = true;
    needsDraw = true;
  }
}

// View

function viewBounds(margin = 0): Bounds {
  const hw = view.width / 2 / view.zoom + margin;
  const hh = view.height / 2 / view.zoom + margin;
  return { minX: -hw, maxX: hw, minY: -hh, maxY: hh };
}

function resize() {
  const rect = stage.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  view.width = rect.width;
  view.height = rect.height;
  view.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  view.zoom = Math.max(0.5, Math.min(1.6, Math.min(rect.width, rect.height) / 660));
  canvas.width = Math.round(rect.width * view.dpr);
  canvas.height = Math.round(rect.height * view.dpr);
  keepObjectsInView();
  markLayersDirty();
  // repaint right away, the canvas was just cleared
  rebuild();
  render();
  placeInspector();
}

// After rotating an iPad or shrinking the window, nothing may stay out of reach.
function keepObjectsInView() {
  const b = viewBounds(-25);
  let moved = false;
  const clampX = (v: number) => Math.max(b.minX, Math.min(b.maxX, v));
  const clampY = (v: number) => Math.max(b.minY, Math.min(b.maxY, v));
  const metal = objects.filter(isConductor).flatMap(bodiesOf);
  for (const o of objects) {
    if (o.kind === 'probe') {
      // the start point matters too: 'Probeladungen zurück' goes there
      const sx = clampX(o.startX);
      const sy = clampY(o.startY);
      if (sx !== o.startX || sy !== o.startY) {
        o.startX = sx;
        o.startY = sy;
        needsDraw = true;
      }
    }
    if (o.x >= b.minX && o.x <= b.maxX && o.y >= b.minY && o.y <= b.maxY) continue;
    o.x = clampX(o.x);
    o.y = clampY(o.y);
    if (o.kind === 'probe') {
      // do not leave it lying on metal
      for (let k = 0; k < 40 && metal.some((m) => distToShape(m.shape, o.x, o.y) < REST_METAL + 2); k++) {
        o.x -= Math.sign(o.x) * 5;
        o.y -= Math.sign(o.y) * 5;
      }
      o.startX = o.x;
      o.startY = o.y;
      o.vx = o.vy = 0;
      o.stuck = false;
      o.trail = [o.x, o.y];
    }
    moved = true;
  }
  if (moved) markFieldDirty();
}

new ResizeObserver(resize).observe(stage);

// Moving the window between laptop screen and beamer changes the pixel ratio.
function watchPixelRatio() {
  matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener(
    'change',
    () => {
      resize();
      watchPixelRatio();
    },
    { once: true }
  );
}
watchPixelRatio();

function toWorld(clientX: number, clientY: number) {
  const r = canvas.getBoundingClientRect();
  return {
    x: (clientX - r.left - view.width / 2) / view.zoom,
    y: (clientY - r.top - view.height / 2) / view.zoom
  };
}

function toStage(x: number, y: number) {
  return { x: view.width / 2 + x * view.zoom, y: view.height / 2 + y * view.zoom };
}

function insideCanvas(clientX: number, clientY: number) {
  const r = canvas.getBoundingClientRect();
  return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
}

// Physics and field picture

let lastRebuildMs = 0;

function rebuild() {
  const t0 = performance.now();
  if (fieldDirty) {
    fieldDirty = false;
    const charges = objects.filter((o): o is PointCharge => o.kind === 'charge');
    const bodies = objects.filter(isConductor).flatMap(bodiesOf);
    let next = new Field(charges, bodies, solverCache);
    if (next.ok && keepChargeOnSeparation(field, next)) {
      next = new Field(charges, objects.filter(isConductor).flatMap(bodiesOf), solverCache);
    }
    if (!next.ok) {
      // keep the last good picture instead of drawing garbage
      if (import.meta.env.DEV) console.warn('Field solution rejected');
      return;
    }
    field = next;
    picture.surfaces = surfaceSamples(field);
    linesDirty = equiDirty = vectorsDirty = true;
    // a changed field may set resting probes in motion again
    for (const o of objects) if (o.kind === 'probe') o.stuck = false;
    refreshReadouts();
  }
  if (linesDirty) {
    linesDirty = false;
    picture.lines = show.lines ? computeFieldLines(field, picture.surfaces, linesPerCharge, viewBounds(400)) : [];
  }
  if (equiDirty) {
    equiDirty = false;
    picture.equi = show.equi ? computeEquipotentials(field, viewBounds(10), (interacting ? 14 : 7) / view.zoom) : null;
  }
  if (vectorsDirty) {
    vectorsDirty = false;
    picture.vectors = show.vectors ? sampleVectors(field, viewBounds(), 44 / view.zoom) : null;
  }
  lastRebuildMs = performance.now() - t0;
}

// Conductors that touched and are pulled apart keep the charge they had in
// contact (charging by contact). Returns true if a charge was changed.
function keepChargeOnSeparation(prev: Field, next: Field): boolean {
  const mates = (f: Field, id: number) => {
    const groups = new Set(f.bodies.filter((b) => b.objectId === id).map((b) => b.group));
    return [...new Set(f.bodies.filter((b) => groups.has(b.group)).map((b) => b.objectId))].sort().join(',');
  };
  let changed = false;
  for (const o of objects) {
    if (!isConductor(o) || o.kind === 'capacitor' || o.grounded) continue;
    if (!prev.bodies.some((b) => b.objectId === o.id)) continue;
    const before = mates(prev, o.id);
    if (!before.includes(',') || before === mates(next, o.id)) continue;
    o.q = prev.netCharge(o.id);
    changed = true;
  }
  return changed;
}

function render() {
  draw(ctx, view, { objects, field, picture, show, selectedId, removingId: dragging?.outside ? dragging.id : null }, colors);
  needsDraw = false;
}

let lastTime = performance.now();
let dragging: Drag | null = null;

function frame(now: number) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  if (fieldDirty || linesDirty || equiDirty || vectorsDirty) rebuild();

  if (running && view.width > 0 && view.height > 0) {
    const probes = objects.filter((o): o is Probe => o.kind === 'probe' && !(dragging && dragging.id === o.id));
    if (probes.some((p) => !p.stuck) && stepProbes(probes, field, motion, dt, viewBounds(-PROBE_RADIUS))) needsDraw = true;
  }

  if (needsDraw) render();
  requestAnimationFrame(frame);
}

// Objects

function findObject(id: number | null) {
  return objects.find((o) => o.id === id) ?? null;
}

function hitTest(x: number, y: number): SceneObject | null {
  const tol = 10 / view.zoom;
  // exact hits first: what is drawn on top wins
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i];
    if (o.kind === 'probe' && Math.hypot(o.x - x, o.y - y) < PROBE_RADIUS) return o;
  }
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i];
    if (o.kind === 'charge' && Math.hypot(o.x - x, o.y - y) < CHARGE_RADIUS) return o;
  }
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i];
    if (o.kind === 'probe' && Math.hypot(o.x - x, o.y - y) < PROBE_RADIUS + tol) return o;
  }
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i];
    if (o.kind === 'charge' && Math.hypot(o.x - x, o.y - y) < CHARGE_RADIUS + tol * 0.6) return o;
  }
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i];
    if (!isConductor(o)) continue;
    for (const b of bodiesOf(o)) if (distToShape(b.shape, x, y) < 6 + tol) return o;
  }
  return null;
}

function addObject(o: SceneObject) {
  objects.push(o);
  if (o.kind === 'probe') needsDraw = true;
  else markFieldDirty();
  select(o.id);
  userChanged();
}

function removeObject(id: number) {
  const o = findObject(id);
  if (!o) return;
  userChanged();
  remember(`${titleOf(o)} entfernt`);
  objects = objects.filter((x) => x.id !== id);
  if (selectedId === id) select(null);
  if (o.kind === 'probe') needsDraw = true;
  else markFieldDirty();
}

function createFromTool(tool: string, x: number, y: number): SceneObject {
  switch (tool) {
    case 'charge+':
      return { kind: 'charge', id: newId(), x, y, q: 2 };
    case 'charge-':
      return { kind: 'charge', id: newId(), x, y, q: -2 };
    case 'probe+':
      return makeProbe(x, y, 1);
    case 'probe-':
      return makeProbe(x, y, -1);
    case 'plate':
      return { kind: 'plate', id: newId(), x, y, length: 260, angle: 90, q: 0, grounded: false };
    case 'capacitor':
      return { kind: 'capacitor', id: newId(), x, y, length: 320, gap: 220, angle: 90, q: 3 };
    case 'ring':
      return { kind: 'ring', id: newId(), x, y, radius: 90, opening: 0, angle: 0, q: 0, grounded: false };
    default:
      return { kind: 'box', id: newId(), x, y, width: 180, height: 130, angle: 0, q: 0, grounded: false };
  }
}

function addFromTool(tool: string) {
  const p = freeSpot(objects, viewBounds(-60), (x, y) => createFromTool(tool, x, y));
  addObject(createFromTool(tool, p.x, p.y));
}

// Undo: one step back after removing objects, clearing or switching scenario

interface Snapshot {
  objects: SceneObject[];
  scenario: string;
  search: string;
}

let undoSnapshot: Snapshot | null = null;
let scenarioId = '';
let toastTimer = 0;

function remember(message: string) {
  undoSnapshot = {
    objects: JSON.parse(JSON.stringify(objects)),
    scenario: scenarioId,
    search: location.search
  };
  toast.querySelector('span')!.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(forgetUndo, 6000);
}

// Undo only takes back the last removal, and only until something else changes.
function forgetUndo() {
  undoSnapshot = null;
  clearTimeout(toastTimer);
  toast.hidden = true;
}

function undo() {
  if (!undoSnapshot) return;
  objects = undoSnapshot.objects;
  scenarioId = scenarioSelect.value = undoSnapshot.scenario;
  keepObjectsInView();
  try {
    history.replaceState(null, '', undoSnapshot.search || location.pathname);
  } catch {
    /* file:// or sandboxed */
  }
  forgetUndo();
  select(null);
  markFieldDirty();
}

toast.querySelector('button')!.addEventListener('click', undo);

// Canvas interaction

interface Drag {
  id: number;
  pointerId: number;
  dx: number;
  dy: number;
  sx: number; // client position at pointerdown
  sy: number;
  orig: SceneObject; // copy of the object at pointerdown
  outside: boolean;
  moved: boolean;
}

const MOVE_THRESHOLD_MOUSE = 4;
const MOVE_THRESHOLD_TOUCH = 8;

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('pointerdown', (e) => {
  if (dragging) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const p = toWorld(e.clientX, e.clientY);
  const hit = hitTest(p.x, p.y);
  if (!hit) {
    select(null);
    return;
  }
  select(hit.id);
  dragging = {
    id: hit.id,
    pointerId: e.pointerId,
    dx: hit.x - p.x,
    dy: hit.y - p.y,
    sx: e.clientX,
    sy: e.clientY,
    orig: JSON.parse(JSON.stringify(hit)),
    outside: false,
    moved: false
  };
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    /* pointer already gone */
  }
  canvas.style.cursor = 'grabbing';
});

canvas.addEventListener('pointermove', (e) => {
  if (!dragging) {
    const p = toWorld(e.clientX, e.clientY);
    canvas.style.cursor = hitTest(p.x, p.y) ? 'grab' : 'default';
    return;
  }
  if (e.pointerId !== dragging.pointerId) return;
  // mouse released outside the window without a pointerup
  if (e.pointerType === 'mouse' && e.buttons === 0) {
    cancelDrag();
    return;
  }
  const o = findObject(dragging.id);
  if (!o) return;
  if (!dragging.moved) {
    // a tap with a little jitter is not a drag
    const threshold = e.pointerType === 'mouse' ? MOVE_THRESHOLD_MOUSE : MOVE_THRESHOLD_TOUCH;
    if (Math.hypot(e.clientX - dragging.sx, e.clientY - dragging.sy) < threshold) return;
    dragging.moved = true;
    inspector.hidden = true;
    placeInspector();
    userChanged();
  }
  const p = toWorld(e.clientX, e.clientY);
  o.x = p.x + dragging.dx;
  o.y = p.y + dragging.dy;
  dragging.outside = !insideCanvas(e.clientX, e.clientY);
  stage.classList.toggle('removing', dragging.outside);
  if (o.kind === 'probe') {
    o.startX = o.x;
    o.startY = o.y;
    o.vx = o.vy = 0;
    o.stuck = false;
    o.trail = [o.x, o.y];
    needsDraw = true;
  } else {
    setInteracting(true);
    markFieldDirty();
  }
});

function endDrag(e: PointerEvent) {
  if (!dragging || e.pointerId !== dragging.pointerId) return;
  const d = dragging;
  dragging = null;
  stage.classList.remove('removing');
  canvas.style.cursor = 'grab';
  setInteracting(false);
  if (d.outside) {
    // undo brings it back where and as it was picked up
    const o = findObject(d.id);
    if (o) Object.assign(o, d.orig);
    removeObject(d.id);
  } else if (selectedId !== null) {
    inspector.hidden = false;
    placeInspector();
  }
  needsDraw = true;
}

function cancelDrag() {
  const d = dragging;
  dragging = null;
  // released outside the window: put it back instead of losing it off-screen
  const o = d && findObject(d.id);
  if (d && o && d.outside) {
    Object.assign(o, d.orig);
    if (o.kind !== 'probe') markFieldDirty();
  }
  stage.classList.remove('removing');
  canvas.style.cursor = 'default';
  setInteracting(false);
  if (selectedId !== null) {
    inspector.hidden = false;
    placeInspector();
  }
  needsDraw = true;
}

canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('lostpointercapture', (e) => {
  if (dragging && e.pointerId === dragging.pointerId) cancelDrag();
});

// Toolbox: drag tools onto the field, or tap to place them in the middle

for (const tool of document.querySelectorAll<HTMLButtonElement>('.tool')) {
  tool.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    try {
      tool.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already gone */
    }
    const startX = e.clientX;
    const startY = e.clientY;
    let ghost: HTMLElement | null = null;

    const move = (ev: PointerEvent) => {
      const threshold = ev.pointerType === 'mouse' ? MOVE_THRESHOLD_MOUSE : MOVE_THRESHOLD_TOUCH;
      if (!ghost && Math.hypot(ev.clientX - startX, ev.clientY - startY) > threshold) {
        ghost = document.createElement('div');
        ghost.className = 'drag-ghost';
        ghost.innerHTML = tool.querySelector('svg')!.outerHTML;
        document.body.appendChild(ghost);
      }
      if (ghost) ghost.style.transform = `translate(${ev.clientX}px, ${ev.clientY}px)`;
    };
    const up = (ev: PointerEvent) => {
      tool.removeEventListener('pointermove', move);
      tool.removeEventListener('pointerup', up);
      tool.removeEventListener('pointercancel', up);
      const kind = tool.dataset.tool!;
      if (ghost) {
        ghost.remove();
        if (ev.type === 'pointerup' && insideCanvas(ev.clientX, ev.clientY)) {
          const p = toWorld(ev.clientX, ev.clientY);
          addObject(createFromTool(kind, p.x, p.y));
        }
      } else if (ev.type === 'pointerup') {
        addFromTool(kind);
      }
    };
    tool.addEventListener('pointermove', move);
    tool.addEventListener('pointerup', up);
    tool.addEventListener('pointercancel', up);
  });
  // keyboard users
  tool.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      addFromTool(tool.dataset.tool!);
    }
  });
}

// Inspector

const titles: Record<SceneObject['kind'], string> = {
  charge: 'Ladung',
  probe: 'Probeladung',
  plate: 'Metallplatte',
  capacitor: 'Plattenkondensator',
  ring: 'Metallring',
  box: 'Metallkasten'
};

function titleOf(o: SceneObject) {
  if (o.kind === 'charge') return o.q > 0 ? 'Positive Ladung' : 'Negative Ladung';
  return titles[o.kind];
}

let readouts: (() => void)[] = [];

function select(id: number | null) {
  if (selectedId === id) return;
  selectedId = id;
  needsDraw = true;
  buildInspector();
}

// Keeps the panel away from the selected object.
function placeInspector() {
  stage.style.setProperty('--inspector-h', `${inspector.hidden ? 0 : inspector.offsetHeight}px`);
  const o = findObject(selectedId);
  if (!o || inspector.hidden) return;
  const p = toStage(o.x, o.y);
  if (narrowLayout.matches) {
    inspector.classList.remove('at-left');
    inspector.classList.toggle('at-top', p.y > view.height / 2);
  } else {
    inspector.classList.remove('at-top');
    const w = inspector.offsetWidth + 40;
    const h = inspector.offsetHeight + 40;
    inspector.classList.toggle('at-left', p.x > view.width - w && p.y > view.height - h);
  }
}

function buildInspector() {
  const o = findObject(selectedId);
  inspector.replaceChildren();
  readouts = [];
  if (!o) {
    inspector.hidden = true;
    placeInspector();
    return;
  }
  inspector.hidden = false;

  const head = document.createElement('header');
  const h = document.createElement('h2');
  h.textContent = titleOf(o);
  const close = document.createElement('button');
  close.className = 'close';
  close.type = 'button';
  close.setAttribute('aria-label', 'Einstellungen schließen');
  close.textContent = '×';
  close.addEventListener('click', () => select(null));
  head.append(h, close);
  inspector.append(head);

  const changed = () => {
    markFieldDirty();
    userChanged();
  };
  const sign = (v: number) => {
    const r = Math.round(v * 10) / 10 || 0;
    return (r > 0 ? '+' : r < 0 ? '−' : '') + formatNumber(Math.abs(r));
  };
  const deg = (v: number) => `${Math.round(v)}°`;

  switch (o.kind) {
    case 'charge': {
      segmented('Vorzeichen', [['+', 1], ['−', -1]], Math.sign(o.q), (v) => {
        o.q = v * Math.abs(o.q);
        h.textContent = titleOf(o);
        changed();
      });
      slider('Betrag der Ladung', 0.5, 5, 0.5, Math.abs(o.q), (v) => formatNumber(v), (v) => {
        o.q = Math.sign(o.q) * v;
        changed();
      });
      break;
    }
    case 'probe': {
      segmented('Vorzeichen', [['+', 1], ['−', -1]], o.sign, (v) => {
        o.sign = v as 1 | -1;
        // a probe resting on a charge may now be repelled
        o.stuck = false;
        needsDraw = true;
        userChanged();
      });
      note('Eine Probeladung spürt das Feld, verändert es aber nicht.');
      actions([['Zurück zum Start', () => { resetProbe(o); needsDraw = true; }]]);
      break;
    }
    case 'plate': {
      conductorCharge(o, sign, changed);
      slider('Länge', 60, 600, 10, o.length, (v) => `${v}`, (v) => { o.length = v; changed(); });
      slider('Drehung', 0, 180, 5, o.angle, deg, (v) => { o.angle = v; changed(); });
      groundSwitch(o, changed);
      break;
    }
    case 'capacitor': {
      slider('Ladung der Platten ±Q', -6, 6, 0.5, o.q, sign, (v) => { o.q = v; changed(); });
      slider('Plattenlänge', 80, 600, 10, o.length, (v) => `${v}`, (v) => { o.length = v; changed(); });
      slider('Plattenabstand', 40, 520, 10, o.gap, (v) => `${v}`, (v) => { o.gap = v; changed(); });
      slider('Drehung', 0, 180, 5, o.angle, deg, (v) => { o.angle = v; changed(); });
      break;
    }
    case 'ring': {
      conductorCharge(o, sign, changed);
      slider('Radius', 30, 260, 5, o.radius, (v) => `${v}`, (v) => { o.radius = v; changed(); });
      slider('Öffnung', 0, 180, 5, o.opening, (v) => (v === 0 ? 'geschlossen' : deg(v)), (v) => { o.opening = v; changed(); });
      slider('Richtung der Öffnung', 0, 355, 5, o.angle, deg, (v) => { o.angle = v; changed(); });
      groundSwitch(o, changed);
      break;
    }
    case 'box': {
      conductorCharge(o, sign, changed);
      slider('Breite', 40, 600, 10, o.width, (v) => `${v}`, (v) => { o.width = v; changed(); });
      slider('Höhe', 40, 600, 10, o.height, (v) => `${v}`, (v) => { o.height = v; changed(); });
      slider('Drehung', 0, 180, 5, o.angle, deg, (v) => { o.angle = v; changed(); });
      groundSwitch(o, changed);
      break;
    }
  }

  const del = actions([['Entfernen', () => removeObject(o.id)]]);
  del.querySelector('button')!.classList.add('btn-danger');
  placeInspector();
}

function row(label: string) {
  const r = document.createElement('div');
  r.className = 'field-row';
  const l = document.createElement('label');
  l.className = 'label';
  const span = document.createElement('span');
  span.textContent = label;
  const out = document.createElement('output');
  l.append(span, out);
  r.append(l);
  inspector.append(r);
  return { r, l, out };
}

function slider(
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  format: (v: number) => string,
  onInput: (v: number) => void
) {
  const { r, l, out } = row(label);
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  out.textContent = format(value);
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = format(v);
    setInteracting(true);
    onInput(v);
  });
  input.addEventListener('change', () => setInteracting(false));
  l.htmlFor = input.id = `insp-${label.replace(/\W+/g, '-')}`;
  r.append(input);
  return { input, out };
}

function segmented(label: string, options: [string, number][], value: number, onChange: (v: number) => void) {
  const { r } = row(label);
  const group = document.createElement('div');
  group.className = 'segmented';
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', label);
  for (const [text, v] of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.textContent = text;
    b.setAttribute('aria-checked', String(v === value));
    b.addEventListener('click', () => {
      for (const x of group.children) x.setAttribute('aria-checked', 'false');
      b.setAttribute('aria-checked', 'true');
      onChange(v);
    });
    group.append(b);
  }
  r.append(group);
}

function note(text: string) {
  const p = document.createElement('p');
  p.className = 'note';
  p.textContent = text;
  inspector.append(p);
}

function actions(list: [string, () => void][]) {
  const box = document.createElement('div');
  box.className = 'actions';
  for (const [label, fn] of list) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn';
    b.textContent = label;
    b.addEventListener('click', fn);
    box.append(b);
  }
  inspector.append(box);
  return box;
}

type Groundable = Exclude<ConductorObject, { kind: 'capacitor' }>;

// Conductors that touch form one electrical group.
function groupOf(objectId: number) {
  const groups = new Set(field.bodies.filter((b) => b.objectId === objectId).map((b) => b.group));
  const members = field.bodies.filter((b) => groups.has(b.group));
  return {
    objectIds: [...new Set(members.map((b) => b.objectId))],
    grounded: members.some((b) => b.grounded),
    total: members.reduce((s, b) => s + bodyCharge(b.first, b.count), 0),
    fixed: members.filter((b) => findObject(b.objectId)?.kind === 'capacitor').reduce((s, b) => s + b.q, 0)
  };
}

function bodyCharge(first: number, count: number) {
  let q = 0;
  for (let j = first; j < first + count; j++) q += field.lambda[j] * field.len[j];
  return q;
}

function conductorCharge(o: Groundable, sign: (v: number) => string, changed: () => void) {
  const s = slider('Ladung', -6, 6, 0.5, o.q, sign, (v) => { o.q = v; changed(); });
  const sync = () => {
    const g = groupOf(o.id);
    const net = field.netCharge(o.id);
    s.input.disabled = g.grounded;
    if (g.grounded) {
      s.out.textContent = `${sign(net)} (durch Erdung)`;
      s.input.value = String(Math.max(-6, Math.min(6, net)));
    } else if (g.objectIds.length > 1) {
      s.out.textContent = `${sign(net)} (über Kontakt)`;
    } else {
      s.out.textContent = sign(o.q);
    }
  };
  sync();
  readouts.push(sync);
}

function groundSwitch(o: Groundable, changed: () => void) {
  const label = document.createElement('label');
  label.className = 'switch';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = o.grounded;
  const span = document.createElement('span');
  span.textContent = 'Geerdet';
  label.append(input, span);
  input.addEventListener('change', () => {
    if (fieldDirty) rebuild();
    if (o.grounded && !input.checked) {
      // Separating from earth keeps the charge that flowed in (charging by influence).
      const g = groupOf(o.id);
      let assigned = g.fixed;
      for (const id of g.objectIds) {
        const m = findObject(id);
        if (m && isConductor(m) && m.kind !== 'capacitor') {
          m.q = field.netCharge(id);
          assigned += m.q;
        }
      }
      o.q += g.total - assigned;
    }
    o.grounded = input.checked;
    changed();
    rebuild();
    buildInspector();
  });
  inspector.append(label);
}

function refreshReadouts() {
  for (const r of readouts) r();
}

// Top bar and settings

{
  const custom = document.createElement('option');
  custom.value = '';
  custom.disabled = true;
  custom.hidden = true;
  custom.textContent = 'Eigener Aufbau';
  scenarioSelect.append(custom);
}
for (const p of presets) {
  const opt = document.createElement('option');
  opt.value = p.id;
  opt.textContent = p.name;
  scenarioSelect.append(opt);
}

function loadPreset(id: string) {
  const p = presets.find((x) => x.id === id) ?? presets[0];
  scenarioId = scenarioSelect.value = p.id;
  objects = p.build();
  keepObjectsInView();
  select(null);
  // Scenes with probes start paused, so predictions can be made first.
  setRunning(!objects.some((o) => o.kind === 'probe'));
  try {
    history.replaceState(null, '', p.id === 'leer' ? location.pathname : `?szenario=${p.id}`);
  } catch {
    /* file:// or sandboxed */
  }
  markFieldDirty();
}

// The scene no longer matches the chosen scenario: choosing it again reloads it.
function userChanged() {
  forgetUndo();
  scenarioId = scenarioSelect.value = '';
}

scenarioSelect.addEventListener('change', () => {
  remember('Szenario gewechselt');
  loadPreset(scenarioSelect.value);
});

function setRunning(v: boolean) {
  running = v;
  playBtn.setAttribute('aria-pressed', String(v));
  playBtn.querySelector('span')!.textContent = v ? 'Pause' : 'Start';
  playBtn.setAttribute('aria-label', v ? 'Pause' : 'Start');
  lastTime = performance.now();
}
playBtn.addEventListener('click', () => setRunning(!running));

document.getElementById('reset-probes-btn')!.addEventListener('click', () => {
  for (const o of objects) if (o.kind === 'probe') resetProbe(o);
  setRunning(false);
  needsDraw = true;
});

document.getElementById('clear-trails-btn')!.addEventListener('click', () => {
  for (const o of objects) if (o.kind === 'probe') o.trail = [o.x, o.y];
  needsDraw = true;
});

document.getElementById('clear-btn')!.addEventListener('click', () => {
  if (objects.length === 0) return;
  remember('Feld geleert');
  loadPreset('leer');
});

document.getElementById('save-btn')!.addEventListener('click', () => {
  if (fieldDirty || linesDirty || equiDirty || vectorsDirty) rebuild();
  render();
  canvas.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'elektrisches-feld.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
});

document.getElementById('help-btn')!.addEventListener('click', () => helpDialog.showModal());

function setTheme(theme: 'paper' | 'board') {
  document.documentElement.dataset.theme = theme;
  themeBtn.textContent = theme === 'paper' ? 'Tafel' : 'Papier';
  colors = readColors();
  document
    .querySelector('meta[name="theme-color"]')!
    .setAttribute('content', getComputedStyle(document.documentElement).getPropertyValue('--app-bg').trim());
  needsDraw = true;
  try {
    localStorage.setItem('feldlinien-theme', theme);
  } catch {
    /* private mode */
  }
}
themeBtn.addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'paper' ? 'board' : 'paper'));

for (const input of document.querySelectorAll<HTMLInputElement>('[data-show]')) {
  input.addEventListener('change', () => {
    const key = input.dataset.show as keyof Show;
    show[key] = input.checked;
    if (key === 'lines') linesDirty = true;
    if (key === 'equi') equiDirty = true;
    if (key === 'vectors') vectorsDirty = true;
    needsDraw = true;
  });
}

densityInput.addEventListener('input', () => {
  linesPerCharge = Number(densityInput.value);
  linesDirty = true;
  needsDraw = true;
});

for (const b of document.querySelectorAll<HTMLButtonElement>('[data-motion]')) {
  b.addEventListener('click', () => {
    motion = b.dataset.motion as Motion;
    for (const x of document.querySelectorAll('[data-motion]')) x.setAttribute('aria-checked', String(x === b));
    motionNote.textContent =
      motion === 'friction'
        ? 'Die Probeladung gleitet genau entlang einer Feldlinie.'
        : 'Die Probeladung ist träge und weicht von den Feldlinien ab.';
    for (const o of objects) {
      if (o.kind === 'probe') {
        o.vx = o.vy = 0;
      }
    }
  });
}

// Keyboard: after a mouse click, Space must not trigger the clicked button
// again (e.g. "Feld leeren"); keyboard users who tabbed there keep it.
let keyboardNav = false;
window.addEventListener('pointerdown', () => (keyboardNav = false), true);

window.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') keyboardNav = true;
  if (helpDialog.open) return;
  const target = e.target instanceof Element ? e.target : document.body;
  const textEntry = target.matches(
    'input:not([type=range]):not([type=checkbox]):not([type=radio]), textarea, [contenteditable]'
  );
  if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey) && !textEntry) {
    e.preventDefault();
    undo();
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId !== null && !textEntry) {
    e.preventDefault();
    removeObject(selectedId);
  } else if (e.key === 'Escape') {
    select(null);
  } else if (e.key === ' ' && !textEntry && !(keyboardNav && target.matches('button, input[type=checkbox], select'))) {
    e.preventDefault();
    if (!e.repeat) setRunning(!running);
  }
});

// Start

let savedTheme: string | null = null;
try {
  savedTheme = localStorage.getItem('feldlinien-theme');
} catch {
  /* private mode */
}
setTheme(savedTheme === 'board' ? 'board' : 'paper');
// Some browsers restore form state on reload: follow what the controls show.
for (const i of document.querySelectorAll<HTMLInputElement>('[data-show]')) show[i.dataset.show as keyof Show] = i.checked;
linesPerCharge = Number(densityInput.value);
resize();
// ?szenario=kaefig opens a scenario directly, e.g. from a link on a worksheet
loadPreset(new URLSearchParams(location.search).get('szenario') ?? 'dipol');
document.fonts?.ready.then(() => (needsDraw = true));
requestAnimationFrame(frame);

// Inspection hook for testing, only on the dev server
if (import.meta.env.DEV) {
  Object.assign(window, {
    __sim: {
      get objects() { return objects; },
      get field() { return field; },
      get picture() { return picture; },
      get view() { return view; },
      get selectedId() { return selectedId; },
      get lastRebuildMs() { return lastRebuildMs; },
      get running() { return running; },
      loadPreset,
      markFieldDirty,
      setRunning,
      select
    }
  });
}
