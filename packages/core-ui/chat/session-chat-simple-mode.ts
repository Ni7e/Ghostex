import { createContext } from 'react';

export const SessionChatSimpleModeContext = createContext(false);
export const SessionChatSimpleModeChangeContext = createContext<((enabled: boolean) => void) | undefined>(undefined);
export const SessionChatFileChangePreviewContext = createContext(false);

export { sessionChatSimpleEditLabel } from '@/packages/shared/session-chat-presentation/simple';
