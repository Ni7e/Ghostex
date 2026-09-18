import artwork from './model-picker-artwork.json';

/** CDXC:SessionChat 2026-09-17 SEE-ALSO: React picker icons and desktop assets.rs consume this artwork together. */
export function modelPickerArtworkKey(model: string, standard = false): keyof typeof artwork {
  if (standard) return 'model-standard';
  if (model.includes('astra')) return 'model-gpt-6-astra';
  if (model.includes('sol')) return 'model-gpt-5.6-sol';
  if (model.includes('terra')) return 'model-gpt-5.6-terra';
  if (model.includes('luna')) return 'model-gpt-5.6-luna';
  if (model === 'fable') return 'model-fable';
  if (model === 'opus[1m]') return 'model-opus[1m]';
  if (model === 'opus') return 'model-opus';
  if (model === 'sonnet') return 'model-sonnet';
  return 'model-haiku';
}

export function modelPickerEffortArtworkKey(effort: string): keyof typeof artwork {
  switch (effort) {
    case 'none':
    case 'minimal':
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
    case 'max':
      return `effort-${effort}`;
    default:
      return 'effort-ultra';
  }
}
export const modelPickerArtwork = (model: string, standard: boolean) => artwork[modelPickerArtworkKey(model, standard)];
export const modelPickerEffortArtwork = (effort: string) => artwork[modelPickerEffortArtworkKey(effort)];

export const modelPickerSvgBody = (svg: string) => svg.slice(svg.indexOf('>') + 1, svg.lastIndexOf('</svg>'));
