import { DT, T_MAX } from './motion';

/** Left gutter for the y axis. The time scrubber is indented by the same amount. */
export const GUTTER_LEFT = 56;
export const GUTTER_RIGHT = 16;

export interface PlotTheme {
  grid: string;
  axis: string;
  text: string;
  cursor: string;
  font: string;
}

export interface PlotOptions {
  canvas: HTMLCanvasElement;
  color: string;
  unit: string;
  /** symmetric y range, ±range */
  range: number;
}

function niceStep(range: number, height: number): number {
  // up to five gridlines per half axis, at least 24 px apart
  const raw = range / Math.max(1, Math.min(5, Math.floor(height / 2 / 24)));
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) if (m * p >= raw - 1e-9) return m * p;
  return 10 * p;
}

export function formatNumber(value: number, digits: number): string {
  // German decimal comma and a real minus sign
  const s = Math.abs(value).toFixed(digits).replace('.', ',');
  return (value < 0 && Number(Math.abs(value).toFixed(digits)) !== 0 ? '−' : '') + s;
}

export class Plot {
  readonly canvas: HTMLCanvasElement;
  readonly color: string;
  readonly unit: string;
  range: number;
  showTimeLabels = true;
  private ctx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;

  constructor(o: PlotOptions) {
    this.canvas = o.canvas;
    this.color = o.color;
    this.unit = o.unit;
    this.range = o.range;
    this.ctx = o.canvas.getContext('2d')!;
  }

  /** Match the backing store to the CSS size. Returns false if hidden. */
  resize(): boolean {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.width = rect.width;
    this.height = rect.height;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }

  private get bottom(): number {
    return this.showTimeLabels ? 30 : 10;
  }

  /** Time at a horizontal CSS pixel position inside the canvas. */
  timeAt(px: number): number {
    const w = this.width - GUTTER_LEFT - GUTTER_RIGHT;
    return Math.max(0, Math.min(T_MAX, ((px - GUTTER_LEFT) / w) * T_MAX));
  }

  /** Draw `count` samples of `series`; `cursor` marks the time being looked at. */
  draw(series: Float64Array, count: number, cursor: number | null, theme: PlotTheme): void {
    if (!this.resize()) return;
    const { ctx, width, height } = this;
    const left = GUTTER_LEFT;
    const right = width - GUTTER_RIGHT;
    const top = 10;
    const bottom = height - this.bottom;
    const plotW = right - left;
    const plotH = bottom - top;
    const xOf = (t: number) => left + (t / T_MAX) * plotW;
    const yOf = (v: number) => top + ((this.range - v) / (2 * this.range)) * plotH;

    ctx.clearRect(0, 0, width, height);
    ctx.font = `13px ${theme.font}`;
    ctx.textBaseline = 'middle';

    // Horizontal grid and value labels
    const yStep = niceStep(this.range, plotH);
    const yDigits = yStep < 1 ? 1 : 0;
    ctx.textAlign = 'right';
    for (let v = -this.range; v <= this.range + 1e-9; v += yStep) {
      const y = Math.round(yOf(v)) + 0.5;
      ctx.strokeStyle = Math.abs(v) < 1e-9 ? theme.axis : theme.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
      ctx.fillStyle = theme.text;
      ctx.fillText(formatNumber(v, yDigits), left - 8, y);
    }

    // Vertical grid every 2 s
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let t = 0; t <= T_MAX; t += 2) {
      const x = Math.round(xOf(t)) + 0.5;
      ctx.strokeStyle = t === 0 ? theme.axis : theme.grid;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
      // the last label makes room for the axis name
      if (this.showTimeLabels && t < T_MAX) {
        ctx.fillStyle = theme.text;
        ctx.fillText(String(t), x, bottom + 7);
      }
    }
    if (this.showTimeLabels) {
      ctx.textAlign = 'right';
      ctx.fillText('t in s', right, bottom + 7);
    }

    // Unit label, top left inside the plot
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = theme.text;
    ctx.fillText(this.unit, left + 8, top + 6);

    // Curve, clipped to the plot area. Values beyond the range run off the edge.
    if (count > 1) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(left, top - 1, plotW, plotH + 2);
      ctx.clip();
      ctx.strokeStyle = this.color;
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(xOf(0), yOf(series[0]));
      for (let i = 1; i < count; i++) ctx.lineTo(xOf(i * DT), yOf(series[i]));
      ctx.stroke();
      ctx.restore();
    }

    if (cursor !== null) {
      const x = Math.round(xOf(cursor)) + 0.5;
      ctx.strokeStyle = theme.cursor;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
      if (count > 0) {
        const f = Math.min(count - 1, cursor / DT);
        const i = Math.floor(f);
        const w = f - i;
        const value = i + 1 < count ? series[i] + (series[i + 1] - series[i]) * w : series[i];
        const y = Math.max(top, Math.min(bottom, yOf(value)));
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
