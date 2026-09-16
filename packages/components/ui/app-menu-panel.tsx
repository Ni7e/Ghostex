import * as React from 'react';
import { cn } from '../utils';
import { useAppScrollbars } from './app-scrollbars';
import './app-menu-panel.css';

const MenuThemeContext = React.createContext<'light' | 'dark' | undefined>(undefined);

export function AppMenuThemeProvider({ theme, children }: { theme: 'light' | 'dark'; children: React.ReactNode }) {
  return <MenuThemeContext.Provider value={theme}>{children}</MenuThemeContext.Provider>;
}

type AppMenuPanelProps = React.ComponentProps<'div'> & {
  'data-chat-theme'?: 'light' | 'dark';
};

/**
 * CDXC:ContextMenus 2026-09-16 DECISION:
 * User: all React areas use one shared menu component, matching the sidebar's rounded appearance, light and dark palettes, scrolling, and persistent click-open submenus.
 * Keep positioning and action ownership in the callers; every menu and submenu renders this panel, including Base UI popups through their render prop.
 */
export function AppMenuPanel({ className, children, ref, style, ...props }: AppMenuPanelProps) {
  useAppScrollbars();
  const inheritedTheme = React.useContext(MenuThemeContext);
  const theme = props['data-chat-theme'] ?? inheritedTheme;
  const panelRef = React.useRef<HTMLDivElement>(null);
  React.useImperativeHandle(ref, () => panelRef.current!);

  React.useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel || getComputedStyle(panel).position !== 'fixed') return;
    const initialBounds = panel.getBoundingClientRect();
    const left =
      typeof style?.left === 'number'
        ? style.left
        : style?.left?.endsWith('px')
          ? Number.parseFloat(style.left)
          : initialBounds.left;
    const top =
      typeof style?.top === 'number'
        ? style.top
        : style?.top?.endsWith('px')
          ? Number.parseFloat(style.top)
          : initialBounds.top;
    // Measure the rendered menu, including optional rows, before clamping at the document edges.
    const clamp = () => {
      const bounds = panel.getBoundingClientRect();
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panel.style.left = `${Math.max(12, Math.min(left, window.innerWidth - bounds.width - 12))}px`;
      panel.style.top = `${Math.max(12, Math.min(top, window.innerHeight - bounds.height - 12))}px`;
    };
    clamp();
    const observer = new ResizeObserver(clamp);
    observer.observe(panel);
    window.addEventListener('resize', clamp);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', clamp);
    };
  }, [style]);

  return (
    <MenuThemeContext.Provider value={theme}>
      <div
        data-slot='app-menu-panel'
        role='menu'
        {...props}
        ref={panelRef}
        style={style}
        data-menu-theme={theme}
        className={cn('ghostex-menu-panel', className)}
      >
        {children}
      </div>
    </MenuThemeContext.Provider>
  );
}
