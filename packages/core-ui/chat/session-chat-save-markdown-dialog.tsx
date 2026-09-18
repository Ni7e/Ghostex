import { localDateDirectory } from '@/packages/shared/session-chat-presentation/save-markdown';
import { SessionChatMarkdownSaveController } from '@/packages/shared/session-chat-controller/save-markdown';
import { IconChevronRight, IconLoader2 } from '@tabler/icons-react';
import { useEffect, useId, useRef, useMemo, useSyncExternalStore, type FormEvent } from 'react';
import { Toaster, toast } from 'sonner';
import { Button } from '@/packages/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/packages/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/packages/components/ui/field';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/packages/components/ui/input-group';
import { cn } from '@/packages/components/utils';
import type { SessionChatTheme } from '@/packages/shared/session-chat';
import { playCopySound } from '../copy-sound';

export type SaveSessionMessageMarkdown = (params: { content: string; path: string }) => Promise<{ path: string }>;
export type ListSessionMessageMarkdownPaths = () => Promise<readonly string[]>;

export function SessionChatSaveMarkdownDialog({
  listExistingPaths,
  markdown,
  onOpenChange,
  open,
  save,
  sessionTitle,
  theme,
}: {
  listExistingPaths: ListSessionMessageMarkdownPaths;
  markdown: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  save: SaveSessionMessageMarkdown;
  sessionTitle: string;
  theme: SessionChatTheme;
}) {
  const fileNameInputId = useId();
  const folderInputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const toasterId = useId();
  const callbacks = useRef({ listExistingPaths, save, onOpenChange });
  callbacks.current = { listExistingPaths, save, onOpenChange };
  const controller = useMemo(
    () =>
      new SessionChatMarkdownSaveController({
        list: () => callbacks.current.listExistingPaths(),
        save: (params) => callbacks.current.save(params),
        saved: async (path) => {
          playCopySound();
          await navigator.clipboard.writeText(path);
          callbacks.current.onOpenChange(false);
          toast.success('Saved to Markdown', { description: `${path} was copied to the clipboard.`, toasterId });
        },
      }),
    [toasterId]
  );
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => {
    if (open) controller.open(sessionTitle, markdown);
    else controller.close();
    return () => controller.close();
  }, [controller, open, sessionTitle, markdown]);
  useEffect(() => {
    if (!open || !state?.suggested) return;
    const frame = requestAnimationFrame(() => {
      if (document.activeElement === inputRef.current) inputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, state?.fileName, state?.suggested]);
  const fileName = state?.fileName ?? '';
  const folderName = state?.folder ?? '';
  const saving = state?.saving ?? false;
  const fileNameError = state?.fileNameError;
  const displayedFolderError = state?.folderError ?? state?.listingError;
  const canSave = !!state && !state.loading && !state.listingError;
  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    await controller.submit();
  };

  return (
    <>
      <Dialog
        onOpenChange={(nextOpen) => {
          if (!saving || nextOpen) {
            onOpenChange(nextOpen);
          }
        }}
        open={open}
      >
        <DialogContent
          className={cn(
            'ghostex-session-chat-popup flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col rounded-xl font-sans [--radius:0.625rem]',
            theme === 'dark' && 'dark'
          )}
        >
          <form className='flex min-h-0 flex-col gap-6' onSubmit={(event) => void submit(event)}>
            <DialogHeader className='shrink-0'>
              <DialogTitle>Save to Markdown</DialogTitle>
              <DialogDescription>
                Save this final response in the project Docs folder. Its full path will be copied after saving.
              </DialogDescription>
            </DialogHeader>
            <FieldGroup className='-mx-1 min-h-0 w-auto overflow-y-auto px-1'>
              <Field data-invalid={displayedFolderError !== undefined}>
                <FieldLabel htmlFor={folderInputId}>Folder</FieldLabel>
                <InputGroup>
                  <InputGroupAddon align='inline-start'>…/docs/</InputGroupAddon>
                  <InputGroupInput
                    aria-invalid={displayedFolderError !== undefined}
                    autoCapitalize='none'
                    autoComplete='off'
                    disabled={saving}
                    id={folderInputId}
                    onChange={(event) => {
                      controller.folder(event.currentTarget.value);
                    }}
                    placeholder={localDateDirectory()}
                    spellCheck={false}
                    value={folderName}
                  />
                </InputGroup>
                <FieldDescription>Use / to create nested folders.</FieldDescription>
                <FieldError>{displayedFolderError}</FieldError>
              </Field>
              <Field data-invalid={fileNameError !== undefined}>
                <FieldLabel htmlFor={fileNameInputId}>File name</FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    aria-invalid={fileNameError !== undefined}
                    autoCapitalize='none'
                    autoComplete='off'
                    autoFocus
                    disabled={saving}
                    id={fileNameInputId}
                    onChange={(event) => {
                      controller.fileName(event.currentTarget.value);
                    }}
                    onFocus={(event) => {
                      if (state?.suggested) {
                        event.currentTarget.select();
                      }
                    }}
                    placeholder='response-name'
                    ref={inputRef}
                    spellCheck={false}
                    value={fileName}
                  />
                  <InputGroupAddon align='inline-end'>.md</InputGroupAddon>
                </InputGroup>
                <FieldError>{fileNameError}</FieldError>
              </Field>
            </FieldGroup>
            <DialogFooter className='shrink-0'>
              <Button disabled={saving} onClick={() => onOpenChange(false)} type='button' variant='outline'>
                Cancel
              </Button>
              <Button disabled={saving || !canSave} type='submit' variant='outline'>
                {saving || !canSave ? <IconLoader2 className='animate-spin' data-icon='inline-start' /> : null}
                Save to md
                <IconChevronRight aria-hidden='true' data-icon='inline-end' />
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Toaster
        id={toasterId}
        position='bottom-center'
        richColors
        theme={theme}
        toastOptions={{
          style: {
            background: 'var(--popover)',
            border: '1px solid var(--border)',
            color: 'var(--popover-foreground)',
          },
        }}
      />
    </>
  );
}
