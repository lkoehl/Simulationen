import './style.css';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

const player = document.getElementById('player') as HTMLElement;
const track = document.querySelector('.track') as HTMLElement;
const resetBtn = document.getElementById('reset-btn') as HTMLButtonElement;

let isDragging = false;
let position = 0; // px relative to center
let trackRect = track.getBoundingClientRect();

// Initial Setup
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

// Drag functionality
function updatePosition(clientX: number) {
  trackRect = track.getBoundingClientRect();
  const trackWidth = trackRect.width;
  const center = trackRect.left + trackWidth / 2;

  let offset = clientX - center;
  const maxOffset = trackWidth / 2;
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

const startStopBtn = document.getElementById('start-stop-btn') as HTMLButtonElement;
startStopBtn.addEventListener('click', () => {
  isRunning = !isRunning;
  startStopBtn.textContent = isRunning ? 'Stop' : 'Start';
  if (isRunning) {
    lastTime = performance.now() / 1000;
  }
});

resetBtn.addEventListener('click', () => {
  position = 0;
  player.style.transform = `translate(-50%, -70%)`;
  currentSimTime = 0;
  lastTime = performance.now() / 1000;
  history.length = 0;
  chartS.data.datasets[0].data = [];
  chartV.data.datasets[0].data = [];
  chartA.data.datasets[0].data = [];
  [chartS, chartV, chartA].forEach(c => c.update());
});

window.addEventListener('resize', () => {
  trackRect = track.getBoundingClientRect();
});

// Chart setup
const commonOptions: any = {
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
      y: { ...yConfig, min: -600, max: 600, title: { display: true, text: 's in px', color: '#94a3b8' } }
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
      y: { ...yConfig, min: -500, max: 500, title: { display: true, text: 'v in px/s', color: '#94a3b8' } }
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
      y: { ...yConfig, min: -500, max: 500, title: { display: true, text: 'a in px/s²', color: '#94a3b8' } }
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

function getAverage(arr: number[], window: number): number {
  if (arr.length === 0) return 0;
  const start = Math.max(0, arr.length - window);
  let sum = 0;
  for (let i = start; i < arr.length; i++) {
    sum += arr[i];
  }
  return sum / (arr.length - start);
}

const HISTORY_TICKS = 600; // max elements
const V_WINDOW = 8; // average over n ticks for v
const A_WINDOW = 12; // average over n ticks for a

function physicsLoop() {
  requestAnimationFrame(physicsLoop);

  if (!isRunning) return;

  const timeNow = performance.now() / 1000;
  const dt = timeNow - lastTime;

  // update state optimally 60 times per second
  if (dt < 1 / 60) return;

  currentSimTime += dt;
  lastTime = timeNow;

  const t = currentSimTime;
  const s = position;
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

  // We smooth v by appending this tick, and recalculating the moving average of previous vs
  let currentVWindow = history.slice(-V_WINDOW).map(h => h.v);
  currentVWindow.push(v);
  let smoothedV = getAverage(currentVWindow, V_WINDOW);

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

  let currentAWindow = history.slice(-A_WINDOW).map(h => h.a);
  currentAWindow.push(a);
  let smoothedA = getAverage(currentAWindow, A_WINDOW);

  history.push({ t, s, v: smoothedV, a: smoothedA });

  // Cleanup history array
  if (history.length > HISTORY_TICKS) {
    history.shift();
  }

  // Update charts
  const xMax = Math.max(maxHistoryTime, t);
  const xMin = Math.max(0, xMax - maxHistoryTime);

  [chartS, chartV, chartA].forEach(chart => {
    if (chart.options.scales && chart.options.scales.x) {
      chart.options.scales.x.min = xMin;
      chart.options.scales.x.max = xMax;
    }
  });

  // Update datasets
  chartS.data.datasets[0].data = history.map(h => ({ x: h.t, y: h.s })) as any;
  chartV.data.datasets[0].data = history.map(h => ({ x: h.t, y: h.v })) as any;
  chartA.data.datasets[0].data = history.map(h => ({ x: h.t, y: h.a })) as any;

  chartS.update();
  chartV.update();
  chartA.update();
}

requestAnimationFrame(physicsLoop);
