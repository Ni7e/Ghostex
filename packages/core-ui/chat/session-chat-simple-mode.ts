import { createContext } from 'react';

export const SessionChatSimpleModeContext = createContext(false);
export const SessionChatSimpleModeChangeContext = createContext<((enabled: boolean) => void) | undefined>(undefined);
export const SessionChatFileChangePreviewContext = createContext(false);

export function sessionChatSimpleEditLabel(count: number): string {
  return `Edited ${count} ${count === 1 ? 'file' : 'files'}`;
}
