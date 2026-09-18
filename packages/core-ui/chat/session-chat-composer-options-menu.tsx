import { createContext, useLayoutEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { useContext } from 'react';

export const SessionChatComposerOptionsMenuContext = createContext<ReactNode>(null);
const RegisterOptionsMenuContext = createContext<Dispatch<SetStateAction<ReactNode>> | null>(null);

export function SessionChatComposerOptionsMenuProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<ReactNode>(null);
  return (
    <RegisterOptionsMenuContext.Provider value={setContent}>
      <SessionChatComposerOptionsMenuContext.Provider value={content}>
        {children}
      </SessionChatComposerOptionsMenuContext.Provider>
    </RegisterOptionsMenuContext.Provider>
  );
}

/** Keep dispatch and pending selections owned by the mounted option pills while rendering their rows inside More actions. */
export function SessionChatComposerOptionsMenu({ children }: { children: ReactNode }) {
  const register = useContext(RegisterOptionsMenuContext);
  useLayoutEffect(() => {
    register?.(() => children);
  }, [children, register]);
  useLayoutEffect(() => () => register?.(null), [register]);
  return null;
}
