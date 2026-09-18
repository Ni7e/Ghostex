import {
  localDateDirectory,
  normalizedMarkdownStem,
  normalizedFolderPath,
  folderPathError,
  suggestedMarkdownStem,
  markdownStemError,
} from '../session-chat-presentation/save-markdown';

export type SaveMarkdownState = {
  folder: string;
  fileName: string;
  suggested: boolean;
  loading: boolean;
  saving: boolean;
  folderError?: string;
  fileNameError?: string;
  listingError?: string;
};
export type SaveMarkdownServices = {
  list: () => Promise<readonly string[]>;
  save: (params: { content: string; path: string }) => Promise<{ path: string }>;
  saved: (path: string) => void | Promise<void>;
};

/** Shared dialog lifecycle prevents stale listings from replacing a typed name or a later dialog. */
export class SessionChatMarkdownSaveController {
  private state: SaveMarkdownState | null = null;
  private listeners = new Set<() => void>();
  private paths: readonly string[] | null = null;
  private generation = 0;
  private title = '';
  private markdown = '';
  constructor(private services: SaveMarkdownServices) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private emit() {
    for (const listener of this.listeners) listener();
  }
  private update(patch: Partial<SaveMarkdownState>) {
    if (!this.state) return;
    this.state = { ...this.state, ...patch };
    this.emit();
  }
  open(title: string, markdown: string) {
    if (this.state?.saving) return;
    const generation = ++this.generation;
    this.title = title;
    this.markdown = markdown;
    this.paths = null;
    const folder = localDateDirectory();
    this.state = {
      folder,
      fileName: suggestedMarkdownStem(title, folder, []),
      suggested: true,
      loading: true,
      saving: false,
    };
    this.emit();
    void this.services
      .list()
      .then((paths) => {
        if (generation !== this.generation || !this.state) return;
        this.paths = paths;
        this.update({
          loading: false,
          ...(this.state.suggested ? { fileName: suggestedMarkdownStem(title, this.state.folder, paths) } : {}),
        });
      })
      .catch((error) => {
        if (generation !== this.generation) return;
        this.update({
          loading: false,
          listingError: error instanceof Error ? error.message : 'Could not read the project Docs files.',
        });
      });
  }
  close() {
    if (this.state?.saving) return;
    this.generation++;
    this.state = null;
    this.emit();
  }
  folder(value: string) {
    if (!this.state || this.state.saving) return;
    this.update({
      folder: value,
      folderError: undefined,
      ...(this.state.suggested && this.paths !== null
        ? { fileName: suggestedMarkdownStem(this.title, value, this.paths) }
        : {}),
    });
  }
  fileName(value: string) {
    if (!this.state || this.state.saving) return;
    this.update({ fileName: value.replace(/\.md$/iu, ''), fileNameError: undefined, suggested: false });
  }
  async submit() {
    if (!this.state || this.state.saving) return;
    const folderError = folderPathError(this.state.folder);
    const fileNameError = markdownStemError(this.state.fileName);
    this.update({ folderError, fileNameError });
    if (folderError || fileNameError || this.paths === null) return;
    const path = `docs/${normalizedFolderPath(this.state.folder)}/${normalizedMarkdownStem(this.state.fileName)}.md`;
    this.update({ saving: true, fileNameError: undefined });
    try {
      const result = await this.services.save({ content: this.markdown, path });
      await this.services.saved(result.path);
      this.update({ saving: false });
      this.close();
    } catch (error) {
      this.update({
        saving: false,
        fileNameError: error instanceof Error ? error.message : 'Could not save the Markdown file.',
      });
    }
  }
}
