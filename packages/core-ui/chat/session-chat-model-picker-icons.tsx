import {
  modelPickerArtwork,
  modelPickerSvgBody,
} from '@/packages/shared/session-chat-presentation/model-picker-artwork';
/**
 * CDXC:SessionChat 2026-09-08 DECISION:
 * User: Luna uses the exact artwork from Downloads/night.svg, recolored to match the picker theme.
 */
export function ModelPickerIcon({ model, standard = false }: { model: string; standard?: boolean }) {
  return (
    <svg
      aria-hidden='true'
      viewBox={!standard && model.includes('luna') ? '0 0 512 512' : '0 0 48 48'}
      fill='none'
      stroke='currentColor'
      strokeWidth='1.6'
      strokeLinecap='round'
      strokeLinejoin='round'
      dangerouslySetInnerHTML={{ __html: modelPickerSvgBody(modelPickerArtwork(model, standard)) }}
    />
  );
}
