import { createContext, useContext, useEffect, type ReactNode } from 'react';

export const ModalStoryTheme = createContext('dark');

type ModalStorySurfaceProps = {
  children: ReactNode;
  theme?: 'dark-1' | 'dark-2' | 'light-orange' | 'plain-light';
};

/**
 * Matches the app-modal host contract for portalled content while keeping the
 * Storybook canvas large enough to inspect the dialog as an overlay.
 */
export function ModalStorySurface({ children, theme: requestedTheme = 'dark-2' }: ModalStorySurfaceProps) {
  const appearance = useContext(ModalStoryTheme);
  const theme = appearance === 'light' ? 'plain-light' : requestedTheme;
  useEffect(() => {
    const previousTheme = document.body.dataset.sidebarTheme;
    document.body.classList.add('app-modal-host-body');
    document.body.dataset.sidebarTheme = theme;

    return () => {
      document.body.classList.remove('app-modal-host-body');
      if (previousTheme === undefined) {
        delete document.body.dataset.sidebarTheme;
      } else {
        document.body.dataset.sidebarTheme = previousTheme;
      }
    };
  }, [theme]);

  return (
    <div
      className='ghostex-root min-h-screen'
      style={{ background: theme === 'plain-light' ? '#f3f3f3' : '#050505' }}
      data-sidebar-theme={theme}
    >
      {children}
    </div>
  );
}

export const modalStoryParameters = {
  layout: 'fullscreen' as const,
};
