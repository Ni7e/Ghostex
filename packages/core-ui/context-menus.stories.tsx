import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { IconCopy, IconFolder, IconPlus, IconTrash } from '@tabler/icons-react';
import { AppMenuPanel, AppMenuThemeProvider } from '@/packages/components/ui/app-menu-panel';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
  ContextMenuSeparator,
} from '@/packages/components/ui/context-menu';
import { useAppScrollbars } from '@/packages/components/ui/app-scrollbars';
import { ManageFileContextMenu } from '@/apps/desktop/views/manage/file-tree-ui';

function ContextMenusPreview() {
  useAppScrollbars();
  const [selected, setSelected] = useState('No action selected');
  const [docsMenu, setDocsMenu] = useState<{ x: number; y: number }>();
  const selectDocsAction = (label: string) => {
    setSelected(label);
    setDocsMenu(undefined);
  };
  return (
    <main style={{ padding: 24, minHeight: '100%', color: 'var(--app-foreground)' }}>
      <h1>Shared app menus</h1>
      <p>Right-click each target. Click Spaces to open its submenu, then move across other rows.</p>
      <p role='status'>{selected}</p>
      <AppMenuThemeProvider theme='light'>
        <button type='button' onClick={(event) => setDocsMenu({ x: event.clientX, y: event.clientY })}>
          Open Docs file menu
        </button>
        {docsMenu ? (
          <ManageFileContextMenu
            canAddToSessionContext
            canCreateHere
            canDelete
            canDuplicate
            canRename
            confirmingDelete={false}
            isCreatingFolder={false}
            position={docsMenu}
            onAddToSessionContext={() => selectDocsAction('Add to Session Context')}
            onCopyFullPath={() => selectDocsAction('Copy Full Path')}
            onCopyPath={() => selectDocsAction('Copy Path')}
            onCreateFileHere={(kind) => selectDocsAction(`Create ${kind}`)}
            onCreateFolderHere={() => selectDocsAction('Create folder')}
            onDuplicate={() => selectDocsAction('Duplicate')}
            onDelete={() => selectDocsAction('Delete')}
            onDismiss={() => setDocsMenu(undefined)}
            onRename={() => selectDocsAction('Rename')}
            onRevealInFinder={() => selectDocsAction('Open File/Folder Location')}
          />
        ) : null}
      </AppMenuThemeProvider>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24 }}>
        {(['light', 'dark'] as const).map((theme) => (
          <AppMenuThemeProvider theme={theme} key={theme}>
            <section style={{ minWidth: 0, width: 260 }}>
              <h2>{theme} menus</h2>
              <ContextMenu>
                <ContextMenuTrigger render={<button type='button' style={{ padding: 16, width: '100%' }} />}>
                  Right-click {theme} target
                </ContextMenuTrigger>
                <ContextMenuContent style={{ width: 240 }}>
                  <ContextMenuItem onClick={() => setSelected('Copied path')}>
                    <IconCopy />
                    Copy Path
                  </ContextMenuItem>
                  <ContextMenuItem>
                    <IconFolder />
                    Open File/Folder Location
                  </ContextMenuItem>
                  <ContextMenuSub>
                    <ContextMenuSubTrigger>
                      <IconPlus />
                      Spaces
                    </ContextMenuSubTrigger>
                    <ContextMenuSubContent>
                      <ContextMenuItem onClick={() => setSelected('Selected Work space')}>Work</ContextMenuItem>
                      <ContextMenuItem onClick={() => setSelected('Selected Personal space')}>Personal</ContextMenuItem>
                    </ContextMenuSubContent>
                  </ContextMenuSub>
                  <ContextMenuSeparator />
                  <ContextMenuItem variant='destructive'>
                    <IconTrash />
                    Close Project
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
              <h3>Sidebar panel with a long label</h3>
              <AppMenuPanel aria-label={`${theme} sidebar menu`} style={{ width: 220 }}>
                <button role='menuitem' type='button'>
                  <IconCopy />
                  Copy Path
                </button>
                <button role='menuitem' type='button'>
                  <IconFolder />
                  Open File/Folder Location
                </button>
                <button role='menuitem' type='button'>
                  A_long_project_name_that_must_fit_inside_this_menu_without_horizontal_scrolling
                </button>
              </AppMenuPanel>
              <h3>Long menu</h3>
              <AppMenuPanel aria-label={`${theme} scrollable menu`} style={{ maxHeight: 220 }}>
                {Array.from({ length: 24 }, (_, index) => (
                  <button
                    key={index}
                    role='menuitem'
                    type='button'
                    onClick={() => setSelected(`Selected action ${index + 1}`)}
                  >
                    Action {index + 1}
                  </button>
                ))}
              </AppMenuPanel>
            </section>
          </AppMenuThemeProvider>
        ))}
      </div>
      <footer style={{ paddingBlock: 24 }}>End of menu preview</footer>
    </main>
  );
}

export default {
  title: 'Components/Context Menus',
  component: ContextMenusPreview,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ContextMenusPreview>;
type Story = StoryObj<typeof ContextMenusPreview>;
export const SharedMenus: Story = {};
