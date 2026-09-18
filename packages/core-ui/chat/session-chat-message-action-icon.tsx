import icons from '@/packages/shared/session-chat-presentation/message-action-icons.json';

/** Shared artwork keeps the native and React message actions visually aligned. */
export function SessionChatMessageActionIcon({ name }: { name: keyof typeof icons.paths }) {
  return (
    <svg
      aria-hidden='true'
      data-icon='inline-start'
      viewBox='0 0 24 24'
      width='24'
      height='24'
      fill='none'
      stroke='currentColor'
      strokeWidth={icons.strokeWidth}
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      {icons.paths[name].map((path, index) => (
        <path key={index} d={path} />
      ))}
    </svg>
  );
}
