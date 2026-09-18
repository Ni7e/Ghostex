import './session-chat-model-picker-effort-icons.css';
import {
  modelPickerEffortArtwork,
  modelPickerSvgBody,
} from '@/packages/shared/session-chat-presentation/model-picker-artwork';

/** A growing constellation: spark, orbit, star, nova, reactor, then a solar vortex. */
export function ModelPickerEffortIcon({ effort }: { effort: string }) {
  return (
    <svg
      className='model-picker-effort-icon'
      aria-hidden='true'
      viewBox='0 0 56 56'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.25'
      strokeLinecap='round'
      strokeLinejoin='round'
      dangerouslySetInnerHTML={{ __html: modelPickerSvgBody(modelPickerEffortArtwork(effort)) }}
    />
  );
}
