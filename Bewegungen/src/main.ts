import './style.css';
import {
  DT,
  Recording,
  SETTLING,
  SETTLING_V,
  X_MAX,
  clampX,
  step,
  type Driver,
  type LiveState,
  type Sample,
  type Snapshot
} from './motion';
import { Plot, formatNumber, type PlotTheme } from './plot';

document.getElementById('boot-style')?.remove();

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const lane = $('lane');
const man = $('man');
const ruler = $('ruler');
const walls = [...document.querySelectorAll<HTMLElement>('.wall')];
const vectors = document.getElementById('vectors') as unknown as SVGSVGElement;
const vecV = vectors.querySelector<SVGGElement>('#vec-v')!;
const vecA = vectors.querySelector<SVGGElement>('#vec-a')!;
const clockOut = $<HTMLOutputElement>('clock');
const statusEl = $('status');
const recordBtn = $<HTMLButtonElement>('record-btn');
const clearBtn = $<HTMLButtonElement>('clear-btn');
const playBtn = $<HTMLButtonElement>('play-btn');
const scrub = $<HTMLInputElement>('scrub');
const speedSel = $<HTMLSelectElement>('speed');
const toast = $('toast');
const showV = $<HTMLInputElement>('show-v');
const showA = $<HTMLInputElement>('show-a');
const showArrows = $<HTMLInputElement>('show-arrows');

type Quantity = 's' | 'v' | 'a';
const QUANTITIES: Quantity[] = ['s', 'v', 'a'];

const rows = Object.fromEntries(
  QUANTITIES.map((q) => [q, document.querySelector<HTMLElement>(`.row[data-q="${q}"]`)!])
) as Record<Quantity, HTMLElement>;
const fields = Object.fromEntries(QUANTITIES.map((q) => [q, $<HTMLInputElement>(`val-${q}`)])) as Record<
  Quantity,
  HTMLInputElement
>;
const sliders = Object.fromEntries(QUANTITIES.map((q) => [q, $<HTMLInputElement>(`sl-${q}`)])) as Record<
  Quantity,
  HTMLInputElement
>;

const css = getComputedStyle(document.documentElement);
const cssVar = (name: string) => css.getPropertyValue(name).trim();
const theme: PlotTheme = {
  grid: cssVar('--grid'),
  axis: cssVar('--axis'),
  text: cssVar('--text-soft'),
  cursor: cssVar('--text'),
  font: getComputedStyle(document.body).fontFamily
};

const ZOOM_STEPS: Record<Quantity, number[]> = {
  s: [10],
  v: [2, 5, 10, 20, 50],
  a: [2, 5, 10, 20, 50, 100]
};
const plots: Record<Quantity, Plot> = {
  s: new Plot({ canvas: $<HTMLCanvasElement>('plot-s'), color: cssVar('--q-s'), unit: 's in m', range: 10 }),
  v: new Plot({ canvas: $<HTMLCanvasElement>('plot-v'), color: cssVar('--q-v'), unit: 'v in m/s', range: 10 }),
  a: new Plot({ canvas: $<HTMLCanvasElement>('plot-a'), color: cssVar('--q-a'), unit: 'a in m/s²', range: 10 })
};

// --- State -----------------------------------------------------------------

const rec = new Recording();
const live: LiveState = { driver: 'position', x: 0, target: 0, v: 0, a: 0 };
/** what the controls were set to when the recording began; "Neu" goes back there */
let startState: LiveState = { ...live };

type Clock = 'idle' | 'recording' | 'playing';
let clock: Clock = 'idle';
/** the time shown in the diagrams and on the track */
let cursor = 0;
let speed = 1;
let accumulator = 0;
let lastFrame = performance.now();
let dirty = true;
let facing: 'left' | 'right' = 'right';
let activeSlider: Quantity | null = null;
let fullNoticeShown = false;

const reviewing = () => rec.length > 1 && cursor < rec.duration - 1e-9;

/** values for the moment that is on screen */
function shown(): Sample {
  if (clock === 'playing' || reviewing()) return rec.sampleAt(cursor);
  const last = rec.last();
  switch (live.driver) {
    case 'position':
      return rec.length > 0 ? last : { x: live.x, v: 0, a: 0 };
    case 'velocity':
      return { x: live.x, v: live.v, a: clock === 'recording' ? last.a : 0 };
    case 'acceleration':
      return { x: live.x, v: live.v, a: live.a };
  }
}

// --- Undo ----------------------------------------------------------------

interface UndoEntry {
  rec: Snapshot;
  live: LiveState;
  start: LiveState;
  cursor: number;
}
let undoEntry: UndoEntry | null = null;
let toastTimer = 0;

function showToast(text: string, undo: UndoEntry | null): void {
  undoEntry = undo;
  toast.querySelector('span')!.textContent = text;
  toast.querySelector('button')!.hidden = undo === null;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
    undoEntry = null;
  }, 6000);
}

function snapshot(): UndoEntry {
  return { rec: rec.snapshot(), live: { ...live }, start: { ...startState }, cursor };
}

toast.querySelector('button')!.addEventListener('click', () => {
  if (!undoEntry) return;
  stopClock();
  rec.restore(undoEntry.rec);
  Object.assign(live, undoEntry.live);
  startState = undoEntry.start;
  cursor = undoEntry.cursor;
  undoEntry = null;
  toast.hidden = true;
  fullNoticeShown = false;
  dirty = true;
});

// --- Clock ---------------------------------------------------------------

function stopClock(): void {
  if (clock === 'recording' && live.driver === 'position') live.v = 0;
  clock = 'idle';
  dirty = true;
}

/** Looking back in time and changing something: drop everything after the cursor. */
function cutAtCursor(): void {
  if (!reviewing()) return;
  const undo = snapshot();
  const t = cursor;
  rec.truncate(t);
  const s = rec.last();
  live.x = live.target = s.x;
  live.v = s.v;
  cursor = rec.duration;
  fullNoticeShown = false;
  showToast(`Aufnahme ab ${formatNumber(t, 1)} s verworfen.`, undo);
}

function startRecording(): boolean {
  if (clock === 'playing') stopClock();
  cutAtCursor();
  if (rec.full) {
    showFullNotice();
    return false;
  }
  if (rec.length === 0) {
    startState = { ...live };
    rec.push({
      x: live.x,
      v: live.driver === 'position' ? undefined : live.v,
      a: live.driver === 'acceleration' ? live.a : undefined
    });
  }
  clock = 'recording';
  accumulator = 0;
  dirty = true;
  return true;
}

function showFullNotice(): void {
  showToast('Die 20 s sind voll. „Neu“ startet eine neue Aufnahme.', null);
}

function setDriver(d: Driver): void {
  if (live.driver === d) return;
  if (d === 'acceleration' && live.driver === 'position') {
    // keep walking with the current speed
    live.v = clock === 'recording' ? rec.last().v : 0;
  }
  if (d === 'position') live.target = live.x;
  live.driver = d;
  dirty = true;
}

/** Position changed by dragging, slider, keyboard or typing. */
function setPosition(x: number, startsRecording: boolean): void {
  if (clock === 'playing') stopClock();
  cutAtCursor();
  setDriver('position');
  live.target = clampX(x);
  if (clock !== 'recording') {
    if (startsRecording || rec.length > 0) {
      if (!startRecording()) return;
    } else {
      // before the first recording: just place the man
      live.x = live.target;
    }
  }
  dirty = true;
}

function setVelocity(v: number): void {
  if (clock === 'playing') stopClock();
  cutAtCursor();
  setDriver('velocity');
  live.v = v;
  dirty = true;
}

function setAcceleration(a: number): void {
  if (clock === 'playing') stopClock();
  cutAtCursor();
  setDriver('acceleration');
  live.a = a;
  dirty = true;
}

function flashWall(x: number): void {
  const wall = walls[x < 0 ? 0 : 1];
  wall.animate([{ filter: 'brightness(1.8)' }, { filter: 'brightness(1)' }], { duration: 350, easing: 'ease-out' });
}

function frame(now: number): void {
  const elapsed = Math.min(0.25, (now - lastFrame) / 1000);
  lastFrame = now;

  if (clock === 'recording') {
    accumulator += elapsed;
    while (accumulator >= DT) {
      accumulator -= DT;
      // the moment (in event time) this step ends
      if (dragPointer !== null) live.target = trailAt(now - accumulator * 1000 - TRAIL_DELAY);
      const r = step(live);
      rec.push(r);
      if (r.hitWall) flashWall(r.x);
      if (rec.full) {
        stopClock();
        if (!fullNoticeShown) showFullNotice();
        fullNoticeShown = true;
        break;
      }
    }
    cursor = rec.duration;
    dirty = true;
  } else if (clock === 'playing') {
    cursor += elapsed * speed;
    if (cursor >= rec.duration) {
      cursor = rec.duration;
      clock = 'idle';
    }
    dirty = true;
  }

  if (dirty) render();
  requestAnimationFrame(frame);
}

// --- Rendering -------------------------------------------------------------

let laneWidth = 0;
const LANE_PAD = 22;

/** CSS pixel position of x inside the lane */
const pxOf = (x: number) => LANE_PAD + ((x + X_MAX) / (2 * X_MAX)) * (laneWidth - 2 * LANE_PAD);
const xOfPx = (px: number) => ((px - LANE_PAD) / (laneWidth - 2 * LANE_PAD)) * 2 * X_MAX - X_MAX;
const pxPerMeter = () => (laneWidth - 2 * LANE_PAD) / (2 * X_MAX);

function buildRuler(): void {
  laneWidth = lane.clientWidth;
  const inner = laneWidth - 2 * LANE_PAD;
  const labelEvery = inner / (2 * X_MAX) < 22 ? 5 : 2;
  const parts: string[] = [];
  for (let m = -X_MAX; m <= X_MAX; m++) {
    const left = ((m + X_MAX) / (2 * X_MAX)) * inner;
    const major = m % labelEvery === 0;
    parts.push(`<span class="tick${major ? ' major' : ''}" style="left:${left}px"></span>`);
    if (major) parts.push(`<span class="tick-label" style="left:${left}px">${formatNumber(m, 0)}</span>`);
  }
  parts.push(`<span class="tick-label unit" style="left:${inner}px">m</span>`);
  ruler.innerHTML = parts.join('');
  dirty = true;
}

function setArrow(g: SVGGElement, x0: number, length: number, y: number): void {
  if (Math.abs(length) < 4) {
    g.setAttribute('visibility', 'hidden');
    return;
  }
  g.setAttribute('visibility', 'visible');
  const dir = Math.sign(length);
  // the marker adds ~8 px at the tip
  const x1 = x0 + length - dir * 8;
  const line = g.querySelector('line')!;
  line.setAttribute('x1', String(x0));
  line.setAttribute('x2', String(x1));
  line.setAttribute('y1', String(y));
  line.setAttribute('y2', String(y));
  const text = g.querySelector('text')!;
  text.setAttribute('x', String(x0 + length + dir * 6));
  text.setAttribute('y', String(y));
  text.setAttribute('text-anchor', dir > 0 ? 'start' : 'end');
}

function recordLabel(): string {
  if (clock === 'recording') return 'Pause';
  if (reviewing()) return 'Ab hier aufnehmen';
  return rec.length > 1 ? 'Weiter' : 'Start';
}

function statusText(): string {
  if (clock === 'recording') return 'Aufnahme';
  if (clock === 'playing') return speed === 1 ? 'Wiedergabe' : `Wiedergabe in Zeitlupe (${speedSel.selectedOptions[0].text})`;
  if (rec.length <= 1) return 'Ziehe den Mann oder gib v oder a vor und drücke Start.';
  if (reviewing()) return 'Rückblick';
  if (rec.full) return 'Aufnahme voll (20 s)';
  return 'Pause';
}

function render(): void {
  dirty = false;
  const s = shown();
  const ppm = pxPerMeter();

  // the man
  const px = pxOf(s.x);
  man.style.transform = `translateX(${px}px)`;
  if (s.v > 0.05) facing = 'right';
  else if (s.v < -0.05) facing = 'left';
  man.dataset.facing = facing;
  man.dataset.pose = Math.abs(s.v) < 0.05 ? 'front' : Math.floor(s.x / 0.45) % 2 === 0 ? 'stride' : 'step';
  man.classList.toggle('is-ghost', clock === 'playing' || reviewing());
  man.setAttribute('aria-valuenow', s.x.toFixed(2));
  man.setAttribute('aria-valuetext', `${formatNumber(s.x, 2)} m`);

  // arrows: 1 m/s and 1 m/s² are drawn 0.3 m long, at most to the edge of the scene
  if (showArrows.checked) {
    const clampLen = (l: number) => Math.max(-px - 60, Math.min(laneWidth + 60 - px, l));
    setArrow(vecV, px, clampLen(s.v * 0.3 * ppm), 12);
    setArrow(vecA, px, clampLen(s.a * 0.3 * ppm), 34);
  }

  // time
  clockOut.value = formatNumber(cursor, 2);
  statusEl.textContent = statusText();
  statusEl.classList.toggle('is-recording', clock === 'recording');

  // buttons
  recordBtn.classList.toggle('is-running', clock === 'recording');
  recordBtn.querySelector('span')!.textContent = recordLabel();
  recordBtn.disabled = clock !== 'recording' && rec.full && !reviewing();
  playBtn.classList.toggle('is-running', clock === 'playing');
  playBtn.querySelector('span')!.textContent = clock === 'playing' ? 'Anhalten' : 'Abspielen';
  playBtn.disabled = rec.length < 2;
  clearBtn.disabled = rec.length === 0;
  scrub.disabled = rec.length < 2;
  if (document.activeElement !== scrub || clock !== 'idle') scrub.value = String(cursor);

  // panels
  const values: Record<Quantity, number> = { s: s.x, v: s.v, a: s.a };
  const driving: Quantity = live.driver === 'position' ? 's' : live.driver === 'velocity' ? 'v' : 'a';
  // only worth pointing out when there is more than one quantity to choose from
  const markDriver = (!rows.v.hidden || !rows.a.hidden) && !reviewing() && clock !== 'playing';
  for (const q of QUANTITIES) {
    rows[q].classList.toggle('is-driving', markDriver && q === driving);
    if (document.activeElement !== fields[q]) fields[q].value = formatNumber(values[q], 2);
    if (activeSlider !== q) sliders[q].value = String(values[q]);
  }

  // diagrams
  const visible = QUANTITIES.filter((q) => !rows[q].hidden);
  const showCursor = clock !== 'recording' && rec.length > 1;
  for (const q of visible) {
    const plot = plots[q];
    plot.showTimeLabels = q === visible[visible.length - 1];
    const series = q === 's' ? rec.x : q === 'v' ? rec.v : rec.a;
    // while recording, v and a of the last moments are still being worked out
    const settling = clock !== 'recording' ? 0 : q === 'v' ? SETTLING_V : q === 'a' ? SETTLING : 0;
    plot.draw(series, Math.max(0, rec.length - settling), showCursor ? cursor : null, theme);
  }
}

// --- Input -------------------------------------------------------------------

// Dragging the man. The grab offset keeps him from jumping to the pointer.
let grabOffset = 0;
let dragPointer: number | null = null;

man.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  man.focus({ preventScroll: true });
  if (rec.full && !reviewing() && clock !== 'playing') {
    showFullNotice();
    return;
  }
  const s = shown();
  const rect = lane.getBoundingClientRect();
  grabOffset = s.x - xOfPx(e.clientX - rect.left);
  dragPointer = e.pointerId;
  trail.length = 0;
  addTrail(e);
  if (e.isTrusted) man.setPointerCapture(e.pointerId);
  lane.classList.add('is-dragging');
  setPosition(s.x, true);
});

// Pointer events come in unevenly and not in step with the frames. Keeping
// their time stamps lets each simulation step read the hand position at
// exactly its own time, which keeps v and a much less noisy.
const TRAIL_DELAY = 25; // ms, so there is usually an event after the step time
const trail: { t: number; x: number }[] = [];

function trailAt(t: number): number {
  const n = trail.length;
  if (n === 0) return live.target;
  if (t >= trail[n - 1].t) return trail[n - 1].x;
  if (t <= trail[0].t) return trail[0].x;
  let i = n - 1;
  while (trail[i - 1].t > t) i--;
  const p = trail[i - 1];
  const q = trail[i];
  return p.x + ((q.x - p.x) * (t - p.t)) / (q.t - p.t || 1);
}

function addTrail(e: PointerEvent): void {
  const rect = lane.getBoundingClientRect();
  const x = clampX(xOfPx(e.clientX - rect.left) + grabOffset);
  const last = trail[trail.length - 1];
  if (last && e.timeStamp <= last.t) last.x = x;
  else trail.push({ t: e.timeStamp, x });
  while (trail.length > 2 && trail[1].t < e.timeStamp - 500) trail.shift();
}

man.addEventListener('pointermove', (e) => {
  if (e.pointerId !== dragPointer) return;
  const events = e.getCoalescedEvents?.() ?? [];
  for (const ev of events.length > 0 ? events : [e]) addTrail(ev);
});

function endDrag(e: PointerEvent): void {
  if (e.pointerId !== dragPointer) return;
  if (trail.length > 0) live.target = trail[trail.length - 1].x;
  dragPointer = null;
  lane.classList.remove('is-dragging');
}
man.addEventListener('pointerup', endDrag);
man.addEventListener('pointercancel', endDrag);
man.addEventListener('lostpointercapture', endDrag);

man.addEventListener('keydown', (e) => {
  const stepSize = e.shiftKey ? 1 : 0.1;
  let x: number | null = null;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') x = shown().x - stepSize;
  else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') x = shown().x + stepSize;
  else if (e.key === 'Home') x = -X_MAX;
  else if (e.key === 'End') x = X_MAX;
  if (x === null) return;
  e.preventDefault();
  setPosition(x, false);
});

function parseNumber(text: string): number {
  return Number.parseFloat(text.replace(/\s/g, '').replace('−', '-').replace(',', '.'));
}

const setters: Record<Quantity, (value: number) => void> = {
  s: (x) => setPosition(x, false),
  v: (v) => setVelocity(Math.max(-50, Math.min(50, v))),
  a: (a) => setAcceleration(Math.max(-100, Math.min(100, a)))
};

for (const q of QUANTITIES) {
  const slider = sliders[q];
  const field = fields[q];
  slider.addEventListener('pointerdown', () => (activeSlider = q));
  slider.addEventListener('pointerup', () => (activeSlider = null));
  slider.addEventListener('pointercancel', () => (activeSlider = null));
  slider.addEventListener('input', () => setters[q](Number(slider.value)));

  field.addEventListener('change', () => {
    const value = parseNumber(field.value);
    if (Number.isFinite(value)) setters[q](value);
    dirty = true;
  });
  field.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') field.blur();
    if (e.key === 'Escape') {
      dirty = true;
      field.blur();
    }
  });
  field.addEventListener('focus', () => field.select());
  field.addEventListener('blur', () => (dirty = true));
}

recordBtn.addEventListener('click', () => {
  if (clock === 'recording') stopClock();
  else startRecording();
});

clearBtn.addEventListener('click', () => {
  if (rec.length === 0) return;
  const undo = snapshot();
  stopClock();
  rec.clear();
  Object.assign(live, startState);
  live.target = live.x;
  cursor = 0;
  fullNoticeShown = false;
  showToast('Aufnahme gelöscht.', undo);
});

playBtn.addEventListener('click', () => {
  if (clock === 'playing') {
    clock = 'idle';
  } else {
    if (clock === 'recording') stopClock();
    if (rec.length < 2) return;
    if (cursor >= rec.duration - 1e-9) cursor = 0;
    clock = 'playing';
  }
  dirty = true;
});

speedSel.addEventListener('change', () => {
  speed = Number(speedSel.value);
  dirty = true;
});

function seek(t: number): void {
  if (rec.length < 2) return;
  if (clock !== 'idle') stopClock();
  cursor = Math.max(0, Math.min(rec.duration, t));
  dirty = true;
}

scrub.addEventListener('input', () => seek(Number(scrub.value)));

// Tapping or dragging inside a diagram moves the time cursor there.
for (const q of QUANTITIES) {
  const canvas = plots[q].canvas;
  let pointer: number | null = null;
  const toTime = (e: PointerEvent) => plots[q].timeAt(e.clientX - canvas.getBoundingClientRect().left);
  canvas.addEventListener('pointerdown', (e) => {
    if (rec.length < 2) return;
    pointer = e.pointerId;
    if (e.isTrusted) canvas.setPointerCapture(e.pointerId);
    seek(toTime(e));
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId === pointer) seek(toTime(e));
  });
  const end = () => (pointer = null);
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
}

// Zoom buttons change the value range of the v and a diagrams.
for (const zoom of document.querySelectorAll<HTMLElement>('.zoom')) {
  const q = zoom.dataset.plot as Quantity;
  zoom.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-zoom]');
    if (!btn) return;
    const steps = ZOOM_STEPS[q];
    const i = steps.indexOf(plots[q].range) + Number(btn.dataset.zoom);
    plots[q].range = steps[Math.max(0, Math.min(steps.length - 1, i))];
    updateZoomButtons();
    dirty = true;
  });
}

function updateZoomButtons(): void {
  for (const zoom of document.querySelectorAll<HTMLElement>('.zoom')) {
    const q = zoom.dataset.plot as Quantity;
    const steps = ZOOM_STEPS[q];
    const i = steps.indexOf(plots[q].range);
    zoom.querySelector<HTMLButtonElement>('[data-zoom="1"]')!.disabled = i === steps.length - 1;
    zoom.querySelector<HTMLButtonElement>('[data-zoom="-1"]')!.disabled = i === 0;
  }
}

// Display switches
function applySwitches(): void {
  rows.v.hidden = !showV.checked;
  rows.a.hidden = !showA.checked;
  vectors.toggleAttribute('hidden', !showArrows.checked);
  dirty = true;
}
for (const input of [showV, showA, showArrows]) input.addEventListener('change', applySwitches);

// Help
const help = $<HTMLDialogElement>('help');
$('help-btn').addEventListener('click', () => help.showModal());

// Space starts and pauses, unless a control that uses the key has focus.
window.addEventListener('keydown', (e) => {
  if (e.key !== ' ' || e.repeat || help.open) return;
  const t = e.target as HTMLElement;
  if (t.closest('input, select, textarea, button')) return;
  e.preventDefault();
  recordBtn.click();
});

// Pause when the tab is hidden instead of recording a frozen stretch.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && clock !== 'idle') stopClock();
});

new ResizeObserver(buildRuler).observe(lane);
new ResizeObserver(() => (dirty = true)).observe(document.querySelector('.graphs')!);
window.addEventListener('resize', () => (dirty = true));

// Fonts change the label metrics once they arrive.
document.fonts?.ready.then(() => {
  theme.font = getComputedStyle(document.body).fontFamily;
  dirty = true;
});

applySwitches();
updateZoomButtons();
buildRuler();
requestAnimationFrame(frame);
