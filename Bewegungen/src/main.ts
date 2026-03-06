import './style.css';
import { Chart, registerables, type ChartOptions } from 'chart.js';

Chart.register(...registerables);

const player = document.getElementById('player') as HTMLElement;
const track = document.querySelector('.track') as HTMLElement;
const resetBtn = document.getElementById('reset-btn') as HTMLButtonElement;

let isDragging = false;
let position = 0; // px relative to center
let trackRect = track.getBoundingClientRect();

// Initial Setup
const PIXELS_PER_METER = 50;
const maxHistoryTime = 10; // show last 10 seconds of data in chart
let currentSimTime = 0;
let lastTime = performance.now() / 1000;
let isRunning = true;

interface State {
  t: number;
  s: number;
  v: number;
  a: number;
}
const history: State[] = [];

// Smoothing ring buffers
const vWindowBuf: number[] = [];
let vSum = 0;

const aWindowBuf: number[] = [];
let aSum = 0;

// Drag functionality
function updatePosition(clientX: number) {
  trackRect = track.getBoundingClientRect();
  const trackWidth = trackRect.width;
  const center = trackRect.left + trackWidth / 2;

  let offset = clientX - center;
  const measuredPlayerWidth = player.getBoundingClientRect().width;
  const playerWidth = measuredPlayerWidth || 40;
  const maxOffset = (trackWidth - playerWidth) / 2;
  offset = Math.max(-maxOffset, Math.min(offset, maxOffset));

  position = offset;
  player.style.transform = `translate(calc(-50% + ${position}px), -70%)`;
}

player.addEventListener('mousedown', () => isDragging = true);
window.addEventListener('mousemove', (e) => {
  if (isDragging) updatePosition(e.clientX);
});
window.addEventListener('mouseup', () => isDragging = false);

player.addEventListener('touchstart', (e) => {
  isDragging = true;
  updatePosition(e.touches[0].clientX);
}, { passive: true });
window.addEventListener('touchmove', (e) => {
  if (isDragging) updatePosition(e.touches[0].clientX);
}, { passive: true });
window.addEventListener('touchend', () => isDragging = false);
window.addEventListener('touchcancel', () => isDragging = false);
window.addEventListener('blur', () => isDragging = false);

const startStopBtn = document.getElementById('start-stop-btn') as HTMLButtonElement;
startStopBtn.addEventListener('click', () => {
  isRunning = !isRunning;
  startStopBtn.textContent = isRunning ? 'Stop' : 'Start';
  if (isRunning) {
    lastTime = performance.now() / 1000;

    // Prevent spike by saving state when unpaused
    const s = position / PIXELS_PER_METER;
    pushHistoryPoint(currentSimTime, s, 0, 0);

    requestAnimationFrame(physicsLoop);
  }
});

resetBtn.addEventListener('click', () => {
  position = 0;
  player.style.transform = `translate(-50%, -70%)`;
  currentSimTime = 0;
  lastTime = performance.now() / 1000;
  history.length = 0;
  vWindowBuf.length = 0;
  vSum = 0;
  aWindowBuf.length = 0;
  aSum = 0;
  chartS.data.datasets[0].data = [];
  chartV.data.datasets[0].data = [];
  chartA.data.datasets[0].data = [];
  [chartS, chartV, chartA].forEach(c => c.update());
});

window.addEventListener('resize', () => {
  trackRect = track.getBoundingClientRect();
});

// Chart setup
const commonOptions: ChartOptions<'line'> = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  scales: {
    x: {
      type: 'linear',
      display: true,
      min: 0,
      max: 10,
      title: { display: true, text: 'Zeit t in s', color: '#94a3b8' },
      grid: { color: 'rgba(148, 163, 184, 0.1)' },
      ticks: { color: '#94a3b8' }
    },
  },
  plugins: {
    legend: { display: false }
  },
  elements: {
    point: { radius: 0 },
    line: { borderWidth: 2, tension: 0.1 }
  }
};

const yConfig = {
  grid: { color: 'rgba(148, 163, 184, 0.1)' },
  ticks: { color: '#94a3b8' }
};

const ctxS = (document.getElementById('chart-s') as HTMLCanvasElement).getContext('2d')!;
const chartS = new Chart(ctxS, {
  type: 'line',
  data: { datasets: [{ label: 'Position', data: [], borderColor: '#34d399' }] },
  options: {
    ...commonOptions,
    plugins: { title: { display: true, text: 'Position s(t)', color: '#f8fafc' }, legend: { display: false } },
    scales: {
      ...commonOptions.scales,
      y: { ...yConfig, min: -15, max: 15, title: { display: true, text: 's in m', color: '#94a3b8' } }
    }
  }
});

const ctxV = (document.getElementById('chart-v') as HTMLCanvasElement).getContext('2d')!;
const chartV = new Chart(ctxV, {
  type: 'line',
  data: { datasets: [{ label: 'Geschwindigkeit', data: [], borderColor: '#f43f5e' }] },
  options: {
    ...commonOptions,
    plugins: { title: { display: true, text: 'Geschwindigkeit v(t)', color: '#f8fafc' }, legend: { display: false } },
    scales: {
      ...commonOptions.scales,
      y: { ...yConfig, min: -20, max: 20, title: { display: true, text: 'v in m/s', color: '#94a3b8' } }
    }
  }
});

const ctxA = (document.getElementById('chart-a') as HTMLCanvasElement).getContext('2d')!;
const chartA = new Chart(ctxA, {
  type: 'line',
  data: { datasets: [{ label: 'Beschleunigung', data: [], borderColor: '#fbbf24' }] },
  options: {
    ...commonOptions,
    plugins: { title: { display: true, text: 'Beschleunigung a(t)', color: '#f8fafc' }, legend: { display: false } },
    scales: {
      ...commonOptions.scales,
      y: { ...yConfig, min: -50, max: 50, title: { display: true, text: 'a in m/s²', color: '#94a3b8' } }
    }
  }
});

const toggleV = document.getElementById('toggle-v') as HTMLInputElement;
const toggleA = document.getElementById('toggle-a') as HTMLInputElement;

const chartContainerV = document.getElementById('chart-v')!.closest('.chart-container') as HTMLElement;
const chartContainerA = document.getElementById('chart-a')!.closest('.chart-container') as HTMLElement;

toggleV.addEventListener('change', () => {
  chartContainerV.classList.toggle('hidden', !toggleV.checked);
});

toggleA.addEventListener('change', () => {
  chartContainerA.classList.toggle('hidden', !toggleA.checked);
});

// Init state (hidden by default)
toggleV.checked = false;
toggleA.checked = false;
chartContainerV.classList.add('hidden');
chartContainerA.classList.add('hidden');

const HISTORY_TICKS = 600; // max elements
const V_WINDOW = 8; // average over n ticks for v
const A_WINDOW = 12; // average over n ticks for a

function pushHistoryPoint(t: number, s: number, v: number, a: number) {
  history.push({ t, s, v, a });

  const dataS = chartS.data.datasets[0].data as { x: number, y: number }[];
  const dataV = chartV.data.datasets[0].data as { x: number, y: number }[];
  const dataA = chartA.data.datasets[0].data as { x: number, y: number }[];

  dataS.push({ x: t, y: s });
  dataV.push({ x: t, y: v });
  dataA.push({ x: t, y: a });

  // Cleanup history array periodically to prevent O(n) shift per frame
  if (history.length > Math.floor(HISTORY_TICKS * 1.5)) {
    const removeCount = history.length - HISTORY_TICKS;
    history.splice(0, removeCount);
    dataS.splice(0, removeCount);
    dataV.splice(0, removeCount);
    dataA.splice(0, removeCount);
  }
}

// Maximum allowed timestep; frames exceeding this (e.g. after tab backgrounding
// or machine sleep) are skipped so that currentSimTime never jumps forward.
const MAX_DT = 0.25;

function physicsLoop() {
  if (!isRunning) return;
  requestAnimationFrame(physicsLoop);

  const timeNow = performance.now() / 1000;
  const dt = timeNow - lastTime;

  // If dt is too large the tab was likely backgrounded – reset the clock and
  // skip this frame to avoid a discontinuity in the charts.
  if (dt > MAX_DT) {
    lastTime = timeNow;
    return;
  }

  // update state optimally 60 times per second
  if (dt < 1 / 60) return;

  currentSimTime += dt;
  lastTime = timeNow;

  const t = currentSimTime;
  const s = position / PIXELS_PER_METER;
  let v = 0;
  let a = 0;

  if (history.length > 0) {
    // Calculate raw v
    // Compare with a frame slightly in the past for stability
    const lookBackV = Math.max(0, history.length - 3);
    const oldStateV = history[lookBackV];
    const dtV = t - oldStateV.t;
    if (dtV > 0) {
      const rawV = (s - oldStateV.s) / dtV;
      v = rawV;
    }
  }

  // We smooth v using a rolling sum
  vWindowBuf.push(v);
  vSum += v;
  if (vWindowBuf.length > V_WINDOW) {
    vSum -= vWindowBuf.shift()!;
  }
  let smoothedV = vSum / vWindowBuf.length;

  if (history.length > 0) {
    // Calculate raw a
    const lookBackA = Math.max(0, history.length - 3);
    const oldStateA = history[lookBackA];
    const dtA = t - oldStateA.t;
    if (dtA > 0) {
      const rawA = (smoothedV - oldStateA.v) / dtA;
      a = rawA;
    }
  }

  // Smooth a using a rolling sum
  aWindowBuf.push(a);
  aSum += a;
  if (aWindowBuf.length > A_WINDOW) {
    aSum -= aWindowBuf.shift()!;
  }
  let smoothedA = aSum / aWindowBuf.length;

  pushHistoryPoint(t, s, smoothedV, smoothedA);

  // Update charts
  const xMax = Math.max(maxHistoryTime, t);
  const xMin = Math.max(0, xMax - maxHistoryTime);

  [chartS, chartV, chartA].forEach(chart => {
    if (chart.options.scales && chart.options.scales.x) {
      chart.options.scales.x.min = xMin;
      chart.options.scales.x.max = xMax;
    }

    // Only trigger a Chart.js update if the canvas is currently visible.
    const canvas = chart.canvas as HTMLCanvasElement | null;
    if (canvas && canvas.offsetParent !== null) {
      chart.update();
    }
  });
}

requestAnimationFrame(physicsLoop);
