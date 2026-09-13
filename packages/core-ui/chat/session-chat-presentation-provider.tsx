import type { ReactNode } from 'react';
import {
  SessionChatFileChangePreviewContext,
  SessionChatSimpleModeChangeContext,
  SessionChatSimpleModeContext,
} from './session-chat-simple-mode';

export function SessionChatPresentationProvider({
  children,
  fileEditPreviews,
  simpleMode,
  onSimpleModeChange,
}: {
  children: ReactNode;
  fileEditPreviews: boolean;
  simpleMode: boolean;
  onSimpleModeChange?: (enabled: boolean) => void;
}) {
  return (
    <SessionChatSimpleModeContext value={simpleMode}>
      <SessionChatSimpleModeChangeContext value={onSimpleModeChange}>
        <SessionChatFileChangePreviewContext value={fileEditPreviews}>{children}</SessionChatFileChangePreviewContext>
      </SessionChatSimpleModeChangeContext>
    </SessionChatSimpleModeContext>
  );
}
