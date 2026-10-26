import { newId, type Probe, type SceneObject } from './physics/scene';

export function makeProbe(x: number, y: number, sign: 1 | -1): Probe {
  return { kind: 'probe', id: newId(), x, y, vx: 0, vy: 0, sign, startX: x, startY: y, stuck: false, trail: [x, y] };
}

const charge = (x: number, y: number, q: number): SceneObject => ({ kind: 'charge', id: newId(), x, y, q });

export interface Preset {
  id: string;
  name: string;
  build: () => SceneObject[];
}

export const presets: Preset[] = [
  {
    id: 'leer',
    name: 'Leeres Feld',
    build: () => []
  },
  {
    id: 'einzel',
    name: 'Einzelne Ladung',
    build: () => [charge(0, 0, 2), makeProbe(150, -90, 1), makeProbe(-120, 140, -1)]
  },
  {
    id: 'dipol',
    name: 'Dipol: + und −',
    build: () => [charge(-170, 0, 2), charge(170, 0, -2), makeProbe(-120, -150, 1)]
  },
  {
    id: 'gleich',
    name: 'Zwei gleiche Ladungen',
    build: () => [charge(-150, 0, 2), charge(150, 0, 2), makeProbe(0, -120, 1)]
  },
  {
    id: 'ungleich',
    name: 'Ungleiche Ladungen',
    build: () => [charge(-150, 0, 3), charge(150, 0, -1)]
  },
  {
    id: 'kondensator',
    name: 'Plattenkondensator',
    build: () => [
      { kind: 'capacitor', id: newId(), x: 0, y: 0, length: 380, gap: 260, angle: 90, q: 3 },
      makeProbe(-60, -90, 1),
      makeProbe(60, 90, -1)
    ]
  },
  {
    id: 'kaefig',
    name: 'Faradayscher Käfig im Kondensator',
    build: () => [
      { kind: 'capacitor', id: newId(), x: 0, y: 0, length: 460, gap: 440, angle: 90, q: 4 },
      { kind: 'ring', id: newId(), x: 0, y: 0, radius: 95, opening: 0, angle: 180, q: 0, grounded: false },
      makeProbe(0, 30, 1),
      makeProbe(-140, -150, 1)
    ]
  },
  {
    id: 'kaefig-innen',
    name: 'Ladung im Käfig',
    build: () => [
      { kind: 'ring', id: newId(), x: 0, y: 0, radius: 130, opening: 0, angle: 0, q: 0, grounded: false },
      charge(-30, 20, 2),
      makeProbe(230, -110, -1)
    ]
  },
  {
    id: 'influenz',
    name: 'Influenz an einer Metallplatte',
    build: () => [
      charge(-80, 0, 3),
      { kind: 'plate', id: newId(), x: 60, y: 0, length: 400, angle: 90, q: 0, grounded: false },
      makeProbe(170, -60, 1)
    ]
  },
  {
    id: 'spitze',
    name: 'Geladener Metallkasten',
    build: () => [
      { kind: 'box', id: newId(), x: 0, y: 0, width: 240, height: 150, angle: 0, q: 3, grounded: false },
      makeProbe(-200, -160, 1)
    ]
  }
];
