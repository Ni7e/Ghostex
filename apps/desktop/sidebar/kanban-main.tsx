import { installKanbanCefBridge } from './project-workarea-cef-bridge';
import { installWorkareaTheme } from '../views/workarea-theme';
import '@/packages/core-ui/styles/shadcn.generated.css';

installKanbanCefBridge();
installWorkareaTheme();

await import('../views/tasks-placeholder');
