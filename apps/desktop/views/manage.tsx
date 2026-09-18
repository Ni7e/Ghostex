import { retainAppScrollbars } from '@/packages/components/ui/app-scrollbars';
import '@fontsource-variable/inter';
import { createRoot } from 'react-dom/client';
import { TooltipProvider } from '@/packages/core-ui/app-tooltip';
import { ManageApp } from './manage/manage-app';
import { MANAGE_STYLES } from './manage/styles';

const styleElement = document.createElement('style');
styleElement.textContent = MANAGE_STYLES;
document.head.append(styleElement);

createRoot(document.getElementById('root')!).render(
  <TooltipProvider>
    <ManageApp />
  </TooltipProvider>
);

const releaseScrollbars = retainAppScrollbars();
window.addEventListener('pagehide', releaseScrollbars, { once: true });
