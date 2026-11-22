export interface Preset {
  id: string;
  name: string;
  background: string;
  text: string;
  accent: string;
  shadow: boolean;
}

/** Built-in looks. Every one keeps light-on-dark or dark-on-light contrast for a projector in a bright hall. */
export const PRESETS: Preset[] = [
  { id: 'royal', name: 'Royal blue', background: 'radial-gradient(120% 90% at 50% 10%, #2448b8 0%, #12266b 55%, #0a1640 100%)', text: '#ffffff', accent: '#f6c34a', shadow: true },
  { id: 'night', name: 'Plain black', background: '#000000', text: '#ffffff', accent: '#f6c34a', shadow: false },
  { id: 'river', name: 'Living water', background: 'linear-gradient(160deg, #0b4f6c 0%, #0f7a8a 45%, #0b3954 100%)', text: '#ffffff', accent: '#bdf0ff', shadow: true },
  { id: 'harvest', name: 'Harvest', background: 'linear-gradient(160deg, #5a1f0b 0%, #9c3d10 50%, #3d1405 100%)', text: '#fff7e6', accent: '#ffd27a', shadow: true },
  { id: 'paper', name: 'White', background: '#ffffff', text: '#0f172a', accent: '#1d3fa6', shadow: false },
];

export const presetById = (id?: string) => PRESETS.find((p) => p.id === id) || PRESETS[0];
