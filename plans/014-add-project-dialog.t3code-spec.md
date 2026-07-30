# t3code Add-Project Flow — Reference Spec (extracted 2026-07-30)

Reference repo: `/Users/madda/dev/active/t3code` @ `9b9e13e76c` (read-only reference — NEVER edit it).
This is the behavior/UX spec Ghostex's new add-project dialog must mirror. All file:line
references below are into the t3code checkout; implementers should open those files directly
when detail is needed.

---

## 0. ARCHITECTURE OVERVIEW (read this first)

There is **no dedicated "Add project" dialog component**. On web the entire flow is a *mode of the Command Palette*: a Base UI `Dialog` wrapping a Base UI `Autocomplete` ("Command"). The flow is driven by three pieces of React state inside one component, plus a view stack.

| Surface | Implementation |
|---|---|
| Web / Desktop (Electron renderer) | `apps/web/src/components/CommandPalette.tsx` (2094 lines) + `CommandPalette.logic.ts` (380) + `CommandPaletteResults.tsx` (146) |
| Mobile (React Native) | `apps/mobile/src/features/projects/AddProjectScreen.tsx` (838) + 4 thin route wrappers |
| Shared pure logic | `packages/client-runtime/src/operations/projects.ts` (mobile uses it; web has a **duplicated copy inline** in CommandPalette.tsx — see §8 "Divergences") |
| Path helpers | `packages/client-runtime/src/state/projects.ts` (re-exported by `apps/web/src/lib/projectPaths.ts`) |
| Server | `apps/server/src/ws.ts`, `workspace/WorkspaceEntries.ts`, `workspace/WorkspacePaths.ts`, `sourceControl/SourceControlRepositoryService.ts`, `orchestration/decider.ts`, `orchestration/Normalizer.ts` |
| Desktop native picker | `apps/desktop/src/electron/ElectronDialog.ts`, `apps/desktop/src/ipc/methods/window.ts:150-215` |

---

## 1. ENTRY & MODES

### 1.1 Entry points (web)

All entries go through a tiny window-`CustomEvent` bus rather than shared React state:

`apps/web/src/commandPaletteBus.ts:1-30`
```ts
const COMMAND_PALETTE_OPEN_EVENT = "t3code:open-command-palette";
export interface CommandPaletteOpenDetail { readonly open?: "add-project" | "new-thread-in" }
export function openCommandPalette(detail?: CommandPaletteOpenDetail): void
export function onOpenCommandPalette(listener): () => void
export function isCommandPaletteOpen(): boolean   // document.querySelector("[data-command-palette]") !== null
```

Callers that dispatch `{ open: "add-project" }`:

| Entry | File:line | Affordance |
|---|---|---|
| SidebarV2 header icon button | `apps/web/src/components/SidebarV2.tsx:1044-1047` (callback), `:2340-2356` (button) | `SidebarMenuButton size="sm"`, `size-8`, `FolderPlusIcon size-4`, `aria-label="New project"`, tooltip `side="right"` → **"New project"** |
| SidebarV2 empty-thread-list CTA | `apps/web/src/components/SidebarV2.tsx:2540-2546` | text button `<PlusIcon className="size-3" /> Add project`, classes `inline-flex items-center gap-1.5 rounded-md border border-sidebar-border px-2.5 py-1 text-[11px] font-medium text-sidebar-muted-foreground …` |
| Legacy Sidebar header | `apps/web/src/components/Sidebar.tsx:3023-3026`, button at `:2886-2901`, prop passed at `:3610` | `aria-label="Add project"`, `data-testid="sidebar-add-project-trigger"`, `FolderPlusIcon size-3.5`, tooltip **"Add project"** |
| Empty-state hero (no projects at all) | `apps/web/src/routes/_chat.index.tsx:107-131` | Title **"What should we work on?"**, description **"Add a project to start your first thread."**, `Button size="sm"` with `PlusIcon` + label **"Add project"** |
| Draft composer headline | `apps/web/src/components/chat/DraftHeroHeadline.tsx:43`, rendered `:126-145` | Inline dotted-underline button. Label = active project title, or literally **"Add a project"** when none. Headline text: `What should we build in {X}?` / `{X} to start` / **"Add a project to start"** |
| Keyboard | `apps/web/src/components/CommandPalette.tsx:402-420` | `mod+k` toggles the palette in *root* mode (not add-project mode). Default binding: `packages/shared/src/keybindings.ts:37` → `{ key: "mod+k", command: "commandPalette.toggle", when: "!terminalFocus" }` |
| Root palette action row | `apps/web/src/components/CommandPalette.tsx:1189-1216` | Item titled **"Add project"**, `FolderPlusIcon`, `keepOpen: true`. Search terms: `["add project","folder","directory","browse","clone","remote","repository","repo","git","github","gitlab","bitbucket","azure","devops","url","environment"]` |
| Root palette WSL shortcut (only when a WSL desktop-local env exists) | `apps/web/src/components/CommandPalette.tsx:1218-1231` | Title **"Open WSL folder"**, description = env label. Skips the source picker and goes straight to local browse. |

### 1.2 Palette open-state machine

`apps/web/src/components/CommandPalette.tsx:342-377`
```ts
interface CommandPaletteOpenIntent { kind: "add-project" | "new-thread-in" }
interface CommandPaletteUiState { open: boolean; openIntent: CommandPaletteOpenIntent | null }
type CommandPaletteUiAction =
  | { _tag:"SetOpen"; open } | { _tag:"Toggle" }
  | { _tag:"OpenAddProject" } | { _tag:"OpenNewThreadIn" } | { _tag:"ClearOpenIntent" }
```
Reducer rules (`:358-377`):
- `SetOpen` → `{ open, openIntent: open ? state.openIntent : null }` (closing always clears the intent).
- `Toggle` → `{ open: !open, openIntent: null }`.
- `OpenAddProject` → `{ open: true, openIntent: { kind: "add-project" } }`.

The dialog body is **unmounted while closed** (`CommandPaletteDialog` returns `null` when `!open`, `:451-468`), so *all* add-project state is destroyed on dismissal. Reopening always starts fresh.

The intent is consumed in a `useLayoutEffect` (`:1104-1110`): clear intent, then `openAddProjectFlow()`.

### 1.3 The view stack

`apps/web/src/components/CommandPalette.tsx:502-503`
```ts
const [viewStack, setViewStack] = useState<CommandPaletteView[]>([]);
const currentView = viewStack.at(-1) ?? null;
```
`CommandPaletteView` (`CommandPalette.logic.ts:53-57`): `{ addonIcon: ReactNode; groups: CommandPaletteGroup[]; initialQuery?: string }`.

Push (`:868-887`) resets highlight and sets `query = view.initialQuery ?? ""`.
Pop (`:889-897`):
```ts
function popView() {
  setAddProjectCloneFlow(null);
  if (viewStack.length <= 1) setAddProjectEnvironmentId(null);
  setViewStack(v => v.slice(0, -1));
  setHighlightedItemValue(null);
  setQuery("");
}
```

### 1.4 Add-project specific state

`apps/web/src/components/CommandPalette.tsx:504-511`
```ts
const [browseGeneration, setBrowseGeneration]           = useState(0);   // forces <Command> remount
const [addProjectEnvironmentId, setAddProjectEnvironmentId] = useState<EnvironmentId|null>(null);
const [isPickingProjectFolder, setIsPickingProjectFolder]   = useState(false);
const [addProjectCloneFlow, setAddProjectCloneFlow]         = useState<AddProjectCloneFlow|null>(null);
const [isRemoteProjectLookingUp, setIsRemoteProjectLookingUp] = useState(false);
const [isRemoteProjectCloning,   setIsRemoteProjectCloning]   = useState(false);
```

### 1.5 Step graph

`openAddProjectFlow()` (`:1075-1102`):
- If **more than one** environment option → push **Step E (Environments)**.
- Else if exactly one → skip straight to **Step S (Sources)** via `startAddProjectSourceSelection(defaultEnvId)`.
- Else (zero environments) → **no view pushed**; error toast: title **"Unable to browse projects"**, description **"No environment is available."** (`:1086-1093`).

```
                    ┌────────────────────────────┐
 root palette ──────► E: Environments (optional)  │ groups: [{value:"environments",label:"Environments"}]
                    └──────────────┬─────────────┘
                                   │ select env  (startAddProjectSourceSelection)
                    ┌──────────────▼─────────────┐
                    │ S: Sources                  │ groups: [{value:`sources:${envId}`, label:"Sources"}]
                    └───┬───────────────────┬────┘
        "Local folder"  │                   │  "Git URL" / "<Provider> repository"
                        │                   │
        ┌───────────────▼──┐        ┌───────▼──────────────────┐
        │ L: Local browse   │        │ R: Repository input      │  cloneFlow.step="repository"
        │ initialQuery="~/" │        │ initialQuery=""          │
        └───────┬───────────┘        └───────┬──────────────────┘
                │ Enter                       │ Enter (lookup / continue)
                │                             │
                │                     ┌───────▼──────────────────┐
                │                     │ C: Clone destination     │  cloneFlow.step="confirm"
                │                     │ query = default base dir │  (same viewStack entry as R)
                │                     └───────┬──────────────────┘
                │                             │ Enter → clone → then reuses L's add logic
                └─────────────┬───────────────┘
                     project created → new thread → palette closes
```

Important: **R and C share the same `viewStack` entry.** `startAddProjectClone` pushes exactly one view (`:920-931`); the R→C transition only mutates `addProjectCloneFlow` and `query` (`:1471-1482`). So one Backspace/back-arrow from C exits the whole clone flow back to Sources (because `popView` nulls `addProjectCloneFlow` first).

### 1.6 Back navigation

Three equivalent ways (all call `popView`):
1. **Back arrow** in the input's start addon — rendered whenever `isSubmenu` (`:1905-1917`): `<button type="button" aria-label="Back"><ArrowLeftIcon/></button>`. The wrapper gets `[&_[data-slot=autocomplete-start-addon]]:pointer-events-auto` so the normally-inert addon becomes clickable (`:1902-1904`).
2. **Backspace on an empty input** — `:1723-1726`:
   ```ts
   if (event.key === "Backspace" && query === "" && isSubmenu) { preventDefault(); popView(); }
   ```
3. **Clearing the input** when the view had an `initialQuery` — `:899-905`:
   ```ts
   function handleQueryChange(next) {
     setHighlightedItemValue(null); setQuery(next);
     if (next === "" && currentView?.initialQuery) popView();
   }
   ```
   Because `pushPaletteView` only stores a truthy `initialQuery` (`:874`), this auto-pop fires for **L (local browse, `"~/"`)** but *not* for R/C (`initialQuery` was `""`).

`isSubmenu = paletteMode === "submenu" || "submenu-browse"` (`:1614`), i.e. any non-empty view stack.

### 1.7 Dismissal

- **Esc** — Base UI `Dialog` default; footer hint `Esc — Close` (`:2072-2075`).
- **Backdrop pointer-down** → `setOpen(false)` (`:1875-1877`).
- On close, `finalFocus` returns focus to the chat composer: `composerHandleRef?.current?.focusAtEnd(); return false;` (`:1871-1874`).
- Successful add closes the palette explicitly (`setOpen(false)` at `:1332` and `:1382`). Items with `keepOpen: true` do **not** close (`executeItem`, `:1739-1741`).

---

## 2. LOCAL FOLDER MODE — exact UX

### 2.1 Entering

`startAddProjectBrowse(environmentId)` — `apps/web/src/components/CommandPalette.tsx:907-918`:
```ts
setAddProjectEnvironmentId(environmentId);
setAddProjectCloneFlow(null);
pushPaletteView({
  addonIcon: <FolderPlusIcon className={ADDON_ICON_CLASS}/>,   // "size-4"
  groups: [],
  initialQuery: getAddProjectInitialQueryForEnvironment(environmentId),
});
```

Initial query (`:677-690`):
```ts
const baseDirectory = environment?.serverConfig?.settings?.addProjectBaseDirectory?.trim() ?? "";
return baseDirectory.length === 0 ? "~/" : ensureBrowseDirectoryPath(baseDirectory);
```
`addProjectBaseDirectory` is a per-server setting (`packages/contracts/src/settings.ts:414`, default `""`). Settings UI: `apps/web/src/components/settings/SettingsPanels.tsx:915-947` — title **"Add project starts in"**, description **`Leave empty to use "~/" when the Add Project browser opens.`**, placeholder `~/`.

`ensureBrowseDirectoryPath` (`packages/client-runtime/src/state/projects.ts:166-172`) appends the platform-preferred separator if missing.

### 2.2 "Is this a browse query?"

`isFilesystemBrowseQuery` — `packages/client-runtime/src/state/projects.ts:80-91`:
```ts
value.startsWith("./") || value.startsWith("../")
 || value.startsWith(".\\") || value.startsWith("..\\")
 || value.startsWith("/")  || value.startsWith("~/")
 || (isWindowsPlatform(platform) && isWindowsAbsolutePath(value))
```
Note: a bare `~` (no slash) is **not** a browse query on the client.

Used at `CommandPalette.tsx:674-675`:
```ts
const isBrowsing = !isRemoteProjectRepositoryStep && isFilesystemBrowseQuery(query, browseEnvironmentPlatform);
```
`browseEnvironmentPlatform` maps the *server's* OS to a navigator-style string (`:148-159`): `windows→"Win32"`, `darwin→"MacIntel"`, `linux→"Linux"`, else `navigator.platform`.

Consequence: typing free text (e.g. `foo`) in the local-browse view leaves browse mode and shows the (empty) view groups → generic empty state.

### 2.3 Splitting the query into "directory" + "leaf filter"

`apps/web/src/components/CommandPalette.tsx:715-717`
```ts
const browseDirectoryPath = isBrowsing ? getBrowseDirectoryPath(query) : "";
const browseFilterQuery   = isBrowsing && !hasTrailingPathSeparator(query)
                              ? getBrowseLeafPathSegment(query) : "";
```
Helpers in `packages/client-runtime/src/state/projects.ts`:
- `hasTrailingPathSeparator` (`:33-35`) — for unix-absolute paths only `/$`; otherwise `[\\/]$`.
- `getBrowseDirectoryPath` (`:158-164`) — the query itself if it ends with a separator, else everything up to and including the last separator.
- `getBrowseLeafPathSegment` (`:153-156`) — text after the last separator.
- `getBrowseParentPath` (`:174-191`) — root-aware parent; returns `null` at the root. Windows drive special-case at `:187-189` (`C:/x` → `C:\`).
- `canNavigateUp` (`:193-195`) — `hasTrailingPathSeparator(p) && getBrowseParentPath(p) !== null`.
- `appendBrowsePathSegment` (`:148-151`) — `${dir}${segment}${separator}` using `preferredPathSeparator` (`:26-31`: `\` for windows-absolute, `/` for unix-absolute, else whichever the string already contains).

### 2.4 Fetching suggestions

`apps/web/src/components/CommandPalette.tsx:718-734`
```ts
const browseQuery = useEnvironmentQuery(
  isBrowsing && browseDirectoryPath.length > 0 && browseEnvironmentId !== null && !relativePathNeedsActiveProject
    ? filesystemEnvironment.browse({
        environmentId: browseEnvironmentId,
        input: { partialPath: browseDirectoryPath, ...(currentProjectCwdForBrowse ? { cwd: currentProjectCwdForBrowse } : {}) },
      })
    : null,
);
const browseResult   = browseQuery.data;
const isBrowsePending = browseQuery.isPending;
const browseEntries   = browseResult?.entries ?? EMPTY_BROWSE_ENTRIES;
```

**There is NO debounce.** The request key is `JSON.stringify([environmentId, input])` (`packages/client-runtime/src/state/runtime.ts:392-397`) and the input contains only the *directory* portion — so keystrokes that only change the leaf segment do not refetch. Crossing a `/` boundary changes `browseDirectoryPath` and issues a new request.

Caching: SWR atom family, `staleTime` default **30_000 ms**, `revalidateOnMount: true`, `idleTTL` default **5 min** (`packages/client-runtime/src/state/runtime.ts:475-501`). Atoms are keyed per `(environmentId, input)`, so re-visiting a directory is instant from cache and revalidates in the background.

`useEnvironmentQuery` view shape (`apps/web/src/state/query.ts:24-35`): `{ data: A|null, error: string|null, isPending: boolean, refresh: () => void }`. `isPending` is `result.waiting` — true during background revalidation too.

### 2.5 Client-side filtering of entries

`filterBrowseEntries` — `apps/web/src/components/CommandPalette.logic.ts:73-103`:
```ts
const lowerFilter = browseFilterQuery.toLowerCase();
const showHidden  = browseFilterQuery.startsWith(".");
filteredEntries = browseEntries.filter(e =>
   e.name.toLowerCase().startsWith(lowerFilter) && (showHidden || !e.name.startsWith(".")));
highlightedEntry = highlightedItemValue?.startsWith("browse:")
   ? filteredEntries.find(e => e.fullPath === highlightedItemValue.slice("browse:".length)) ?? null : null;
exactEntry = browseFilterQuery.length > 0
   ? filteredEntries.find(e => e.name === browseFilterQuery) ?? null : null;   // case-sensitive
```
Hidden folders (`.foo`) appear only once the user types a leading `.`.
`exactEntry` is what makes the submit button flip between "Add" and "Create & Add".

### 2.6 Rendered list

`buildBrowseGroups` — `apps/web/src/components/CommandPalette.logic.ts:299-339`. Single group `{ value:"directories", label:"Directories" }`:
- Optional first row when `canBrowseUp`: `value:"browse:up"`, title `".."`, icon `<CornerLeftUpIcon className="size-4 text-muted-foreground/80"/>` (`CommandPalette.tsx:1577`), `keepOpen:true`, run → `browseUp()`.
- One row per entry: `value:` `browse:${entry.fullPath}`, `title: entry.name`, icon `<FolderIcon className={ITEM_ICON_CLASS}/>` (`:1578`), `searchTerms: [browseQuery, entry.fullPath, entry.name]`, `keepOpen:true`, run → `browseTo(entry.name)`.

Navigation actions (`CommandPalette.tsx:1544-1560`):
```ts
function browseTo(name)  { setQuery(appendBrowsePathSegment(query, name)); setHighlightedItemValue(null); bumpBrowseGeneration(); }
function browseUp()      { const p = getBrowseParentPath(query); if (p===null) return; setQuery(p); setHighlightedItemValue(null); bumpBrowseGeneration(); }
```
`browseGeneration` is part of the `<Command key=…>` (`:1880`) so the Autocomplete remounts and drops any stale highlight/scroll.

### 2.7 Keyboard behavior in local mode

`handleKeyDown` — `apps/web/src/components/CommandPalette.tsx:1685-1727`:

1. Thread-jump shortcuts (`mod+1..9`) are matched first and execute the matching item (`:1686-1700`).
2. Repository step Enter (clone mode only) — `:1702-1706`.
3. **Browse-path submit** — `:1708-1721`:
   ```ts
   const shouldSubmitBrowsePath = canSubmitBrowsePath && event.key === "Enter"
       && (!hasHighlightedBrowseItem || isPrimaryModifierPressed(event));
   ```
   `isPrimaryModifierPressed` (`:1681-1683`): on Mac `metaKey && !ctrlKey`, elsewhere `ctrlKey && !metaKey`.
   → `submitAddProjectCloneFlow(resolvedAddProjectPath)` when in the clone-destination step, else `handleAddProject(resolvedAddProjectPath)`.
4. Backspace-back (`:1723-1726`).

So:

| Situation | Enter does | Mod+Enter does |
|---|---|---|
| No item highlighted (default — see `autoHighlight={false}` below) | **submit the typed path** | submit the typed path |
| An entry is highlighted (user pressed ↓ or hovered) | **descend into that folder** (Autocomplete item activation → `browseTo`) | **submit the typed path** |

`autoHighlight` is disabled specifically for browse/clone (`:1882`):
```ts
autoHighlight={isBrowsing || isRemoteProjectCloneFlow ? false : "always"}
```
That is the crux: in path modes nothing is preselected, so Enter always means "use what I typed".

Arrow ↑/↓ move highlight (Base UI Autocomplete); `onItemHighlighted` writes `highlightedItemValue` (`:1884-1886`).

### 2.8 Which path is submitted

`apps/web/src/components/CommandPalette.tsx:1562-1568`
```ts
const resolvedAddProjectPath = hasTrailingPathSeparator(query)
  ? (browseResult?.parentPath ?? query.trim())   // server-resolved absolute dir
  : (exactBrowseEntry?.fullPath ?? query.trim());
```
i.e. when the query ends with `/`, the **server-normalized** `parentPath` (already `~`-expanded and `path.resolve`d) wins; otherwise an exact-name match's `fullPath` wins; otherwise the raw text is sent and the server resolves it.

### 2.9 "Will create" detection & submit-button label

`apps/web/src/components/CommandPalette.tsx:1616-1633`
```ts
const canSubmitBrowsePath = isBrowsing && !relativePathNeedsActiveProject;
const willCreateProjectPath =
  canSubmitBrowsePath && !isBrowsePending && query.trim().length > 0 && !hasHighlightedBrowseItem &&
  (hasTrailingPathSeparator(query) ? !browseResult : exactBrowseEntry === null);

const useMetaForMod      = isMacPlatform(navigator.platform);
const submitModifierLabel = useMetaForMod ? "⌘" : "Ctrl";
const isCloneDestinationStep = addProjectCloneFlow?.step === "confirm";
const submitActionLabel = isCloneDestinationStep
  ? (willCreateProjectPath ? "Create & Clone" : "Clone")
  : (willCreateProjectPath ? "Create & Add"   : "Add");
const addShortcutLabel = hasHighlightedBrowseItem ? `${submitModifierLabel} Enter` : "Enter";
```

### 2.10 Relative-path guard

`apps/web/src/components/CommandPalette.tsx:709-714`
```ts
const currentProjectCwdForBrowse = (browseEnvironmentId && currentProjectEnvironmentId === browseEnvironmentId)
  ? currentProjectCwd : null;
const relativePathNeedsActiveProject =
  isExplicitRelativeProjectPath(query.trim()) && currentProjectCwdForBrowse === null;
```
When true: the browse request is skipped (`:721`), `displayedGroups = []` (`:1606-1608`), the empty state reads **"Relative paths require an active project."** (`:2034-2035`), and the submit button is `disabled` (`:1967-1970`).

### 2.11 Empty-state / hint messages (local mode)

`CommandPaletteResults` renders a centered block `py-10 text-center text-sm text-muted-foreground` when there are zero groups (`apps/web/src/components/CommandPaletteResults.tsx:29-38`). Messages chosen at `CommandPalette.tsx:2025-2041`:

| Condition | Message |
|---|---|
| clone step `repository`, source `url` | `Enter a Git clone URL and press Enter to continue.` |
| clone step `repository`, provider source | `Enter a repository path and press Enter to look it up.` |
| clone step `confirm` | `Choose a destination path and press Enter to clone.` |
| `relativePathNeedsActiveProject` | `Relative paths require an active project.` |
| `willCreateProjectPath` | `Press Enter to create this folder and add it as a project.` |
| default | `No matching commands, projects, or threads.` (or `No matching actions.` when query starts with `>`) |

### 2.12 Input placeholders

`apps/web/src/components/CommandPalette.tsx:1611-1613` →
`remoteProjectInputPlaceholder(cloneFlow) ?? getCommandPaletteInputPlaceholder(paletteMode)`.

`getCommandPaletteInputPlaceholder` — `apps/web/src/components/CommandPalette.logic.ts:369-380`:
| mode | placeholder |
|---|---|
| `root` | `Search commands, projects, and threads...` |
| `root-browse` | `Enter project path (e.g. ~/projects/my-app)` |
| `submenu` | `Search...` |
| `submenu-browse` | `Enter path (e.g. ~/projects/my-app)` |

`getCommandPaletteMode` (`:341-349`): `currentView ? (isBrowsing ? "submenu-browse" : "submenu") : (isBrowsing ? "root-browse" : "root")`.

### 2.13 Submitting — `handleAddProjectForEnvironment`

`apps/web/src/components/CommandPalette.tsx:1265-1396`. Ordered validation:

1. `isUnsupportedWindowsProjectPath(rawCwd.trim(), platform)` → toast **"Failed to add project" / "Windows-style paths are only supported on Windows."** (`:1274-1283`)
2. `isExplicitRelativeProjectPath(rawCwd.trim()) && !currentProjectCwd` → toast **"Failed to add project" / "Relative paths require an active project."** (`:1285-1294`)
3. `cwd = resolveProjectPathForDispatch(rawCwd, currentProjectCwd)`; if empty → silent return (`:1296-1297`)
4. **Duplicate check** — `findProjectByPath(projectsInThisEnv, cwd)` (`:1299-1334`). If found:
   - navigate to its latest non-archived thread, or
   - `handleNewThread(projectRef)`; on failure toast **"Failed to open project"**
   - then `setOpen(false)`. **No project is created, no error is shown for the duplicate itself.**
5. Create:
   ```ts
   const projectId = newProjectId();
   await createProject({ environmentId, input: {
     projectId,
     title: inferProjectTitleFromPath(cwd),
     workspaceRoot: cwd,
     createWorkspaceRootIfMissing: true,
     defaultModelSelection: resolveDefaultProviderModelSelection(targetEnvironmentProviders, null),
   }});
   ```
   (`:1336-1353`). Failure → toast **"Failed to add project"** with `error.message` (suppressed when the command was *interrupted*, `isAtomCommandInterrupted`, `:1355`).
6. `handleNewThread(scopeProjectRef(environmentId, projectId))`; failure → toast **"Failed to add project"** (`:1368-1381`).
7. `setOpen(false)` (`:1382`).

`inferProjectTitleFromPath` = last non-empty path segment (`packages/client-runtime/src/state/projects.ts:138-146`).
`resolveProjectPathForDispatch` (`:97-122`) resolves `./`, `../`, `.` segments against the active project cwd; otherwise just `normalizeProjectPathForDispatch`.

### 2.14 Native folder picker fallback (desktop)

Visibility gate — `apps/web/src/components/CommandPalette.tsx:1644-1656`: requires `window.desktopBridge` (Electron only). **In a plain browser the button never renders and the typed-path browser is the only mechanism.** No `<input webkitdirectory>` or File System Access API path.

Footer button (`:2077-2089`): `Button variant="ghost" size="xs"`, disabled while `isPickingProjectFolder`, label `` `Open in ${fileManagerName}` `` (Finder | Explorer | Files).

`handleOpenProjectFromFileManager` (`:1754-1863`): picker throw → swallow, keep palette open; cancel (`null`) → no-op; WSL UNC results mapped back to Linux path + env; unmatched → toast **"Could not add WSL project"**; otherwise `handleAddProject(pickedPath)`.

Electron side — `apps/desktop/src/electron/ElectronDialog.ts:106-139`: `properties: ["openDirectory", "createDirectory"]`.

---

## 3. REMOTE / CLONE MODE

### 3.1 Types & constants

`apps/web/src/components/CommandPalette.tsx:167-200`
```ts
type AddProjectRemoteProviderKind = "github"|"gitlab"|"bitbucket"|"azure-devops";
type AddProjectRemoteSource       = AddProjectRemoteProviderKind | "url";

type AddProjectCloneFlow =
  | { step:"repository"; environmentId; source }
  | { step:"confirm";    environmentId; source; repositoryInput: string;
      repository: SourceControlRepositoryInfo | null; remoteUrl: string };

const REMOTE_PROJECT_SOURCES          = ["url","github","gitlab","bitbucket","azure-devops"];
const REMOTE_PROJECT_PROVIDER_SOURCES = ["github","gitlab","bitbucket","azure-devops"];
```

### 3.2 Labels / hints / icons / placeholders

`apps/web/src/components/CommandPalette.tsx:202-260`

| source | label (:202-215) | path hint (:217-230) | icon (:238-251) | row title (:965) | row description (:966-969) |
|---|---|---|---|---|---|
| `url` | `Git URL` | `URL` | `<LinkIcon/>` | **Git URL** | **Clone from a remote URL** |
| `github` | `GitHub` | `owner/repo` | `<GitHubIcon/>` | **GitHub repository** | **Clone GitHub owner/repo** |
| `gitlab` | `GitLab` | `group/project` | `<GitLabIcon/>` | **GitLab repository** | **Clone GitLab group/project** |
| `bitbucket` | `Bitbucket` | `workspace/repository` | `<BitbucketIcon/>` | **Bitbucket repository** | **Clone Bitbucket workspace/repository** |
| `azure-devops` | `Azure DevOps` | `project/repository` | `<AzureDevOpsIcon/>` | **Azure DevOps repository** | **Clone Azure DevOps project/repository** |

`remoteProjectInputPlaceholder(flow)` (`:253-260`):
```ts
if (!flow) return null;
if (flow.step === "confirm") return null;                 // falls through to "Enter path (e.g. ~/projects/my-app)"
if (flow.source === "url")   return "Enter Git clone URL";
return `Enter ${label} repository (${pathHint})`;         // e.g. "Enter GitHub repository (owner/repo)"
```

### 3.3 Provider readiness

`AddProjectRemoteSourceReadiness = Record<AddProjectRemoteSource, { ready: boolean; hint: string | null }>` (`:279-282`).

`buildAddProjectRemoteSourceReadiness(discovery)` — `:284-333`:
```ts
const unavailable = { ready:false, hint:"Provider status unavailable. Open Settings -> Source Control and rescan." };
default: { url:{ready:true,hint:null}, github:unavailable, gitlab:unavailable, bitbucket:unavailable, "azure-devops":unavailable }
if (!discovery) return default;
for each provider source:
  provider missing from discovery      → unavailable
  provider.status !== "available"      → { ready:false, hint: provider.installHint }
  provider.auth.status === "unauthenticated"
     → { ready:false, hint: auth.detail ?? `${label} is not authenticated. Open Settings -> Source Control for setup guidance.` }
  else                                 → { ready:true, hint:null }
```
Note: `auth.status === "unknown"` counts as **ready**.

Data comes from `sourceControlEnvironment.discovery({ environmentId, input: {} })` (`:661-668`) → RPC `server.discoverSourceControl`.

### 3.4 Source-picker ordering

`orderedSources = ["url", ...sortAddProjectProviderSources(readinessBySource)]` (`:958-961`); ready providers first, then alphabetical by label (`:266-277`).
Final list order: **Local folder → Git URL → (ready providers A→Z) → (unready providers A→Z)** (`buildAddProjectSourceGroups`, `:938-1030`).

### 3.5 "Setup Required" affordance

`apps/web/src/components/CommandPalette.tsx:973-995`: unready rows get a right-aligned `Setup Required` outline button (`h-5 rounded-[.25rem] px-1.5 text-[10px] text-warning-foreground`) with tooltip = readiness hint; the row itself is `disabled` and renders via `DisabledCommandPaletteResultRow` (`opacity-64`, no hover, no chevron); the button closes the palette and navigates to source-control settings (`:933-936`).

### 3.6 Step R — repository input

Entered by `startAddProjectClone(envId, source)` — `:920-931`: sets `addProjectCloneFlow = { step:"repository", environmentId, source }` and pushes a view whose `addonIcon` is the provider icon, `groups: []`, `initialQuery: ""`.

While `step === "repository"`:
- `isBrowsing` forced `false` (`:673-675`), `displayedGroups = []` (`:1603-1604`) → only the empty-state hint shows.
- Input gets `pe-32` right padding to clear the action button (`:1893-1894`).
- Inline action button (`:1925-1953`): `Button variant="outline" size="xs" tabIndex={-1}`, positioned `absolute inset-e-2.5 top-1/2 gap-1.5 pe-1 ps-2 -translate-y-1/2`. Label: `source === "url" ? "Continue" : "Lookup"`; while pending: **"Working"**. Trailing `<Kbd>Enter</Kbd>`; `onMouseDown` prevented so the input keeps focus. Disabled unless `query.trim().length>0 && !isRemoteProjectPending`.
- Footer replaces the "Select" hint with `Enter — {Continue|Lookup}` (`:2055-2059`).

`submitAddProjectCloneFlow()` — repository branch, `:1425-1483`:
- url source → straight to confirm step: `{ step:"confirm", …, repositoryInput: raw, repository: null, remoteUrl: raw }`, `query = getDefaultCloneParentPath(envId)`, remount.
- provider source → `lookupRepository({ environmentId, input: { provider, repository: raw } })`; failure → toast **"Repository lookup failed"**, stays on step R, query preserved; success → confirm step with `remoteUrl = repository.sshUrl`.

### 3.7 Step C — clone destination

- `isBrowsing` true again (query is `~/…`) — the **full local folder browser is reused**, with the group label renamed to **"Select where to clone"** (`:1582-1588`).
- A **repository context card** is pinned above the results (`:1590-1600`, `:2001-2018`): "Repository" label + row with provider icon, `repository?.nameWithOwner ?? repositoryInput` (title), `repository?.url ?? remoteUrl` (subtitle).
- Submit button label: `Clone` / `Create & Clone`; while cloning: **"Cloning"**, disabled.
- `submitAddProjectCloneFlow(destinationPathInput?)` — confirm branch, `:1485-1542`: same windows-path/relative-path validation as local (toasts titled **"Clone failed"**), then `cloneRepository({ environmentId, input: { remoteUrl, destinationPath } })`; failure → toast, stays on C; success → `handleAddProject(cloneResult.value.cwd)`.

**Clone progress UX**: no progress bar/streaming; button text flips to "Cloning" + disabled. No cancel. Server `git clone` timeout **120 s**.

---

## 4. VISUAL DESIGN

### 4.1 Shell

- Backdrop: `fixed inset-0 z-50 transition-all duration-200` fade in/out.
- Viewport: top-anchored — `fixed inset-0 z-50 flex flex-col items-center px-4 py-[max(--spacing(4),4vh)] sm:py-[10vh]` (palette sits at 10vh on ≥sm).
- Popup: glassy dialog, `rounded-2xl border`, scale 98%→100% + opacity entrance, `max-h-105 max-w-xl`.
- Structure:
```
Popup
├── div.relative
│   ├── CommandInput (px-2.5 py-1.5 wrapper; size="lg"; autoFocus)
│   └── inline submit Button (absolute inset-e-2.5 top-1/2 -translate-y-1/2)
├── CommandPanel  max-h-[min(28rem,70vh)]
│   ├── [Repository context card]      (clone confirm only)
│   └── Results (List → Group* → Item*)
└── CommandFooter (keyboard hints)
```

### 4.2 Input

Borderless/transparent inside the dialog; `autoFocus`; placeholder per §2.12; right padding `pe-32`/`pe-36`/`pe-16` depending on inline button; `startAddon`: back-arrow button when in a submenu, `FolderPlusIcon` when browsing at root, else search icon.

### 4.3 List rows

Row: `flex min-h-8 items-center rounded-sm px-2 py-1.5 text-sm`, highlight = app-owned (`bg-accent! text-accent-foreground!` on active row ONLY — hover/base-ui highlight is neutralized so the app's `highlightedItemValue` is the single source of truth); `onMouseDown` prevented (input keeps focus); icon `size-4 text-muted-foreground/80`; title `text-sm text-foreground truncate`; description `truncate text-muted-foreground/85 text-xs`; submenu rows get trailing `<ChevronRightIcon className="ml-auto size-4 shrink-0 text-muted-foreground/50"/>`. Disabled row: `opacity-64`, no hover. Group label: `px-2 py-1.5 font-medium text-muted-foreground text-xs`. Empty state: `py-10 text-center text-sm text-muted-foreground`.

### 4.4 Footer

`flex items-center justify-between gap-2 bg-foreground/[0.025] px-5 py-3 text-sm text-muted-foreground`, kbd chips `h-5 min-w-5 rounded bg-muted px-1 text-xs`.
Left: `↑ ↓ — Navigate` (always) · `Enter — {Continue|Lookup}` (repo step) or `Enter — Select` (when a row is highlighted / not path mode) · `Backspace — Back` (submenu) · `Esc — Close`.
Right: `Open in Finder/Explorer/Files` (desktop only).

### 4.5 Focus

- Input `autoFocus`; all rows/buttons prevent mousedown default so focus never leaves the input; submit buttons `tabIndex={-1}`.
- The whole command remounts when `` `${viewStack.length}-${browseGeneration}-${isBrowsing}-${cloneStep}` `` changes.

---

## 5. MOBILE UX (React Native)

### 5.1 Navigation stack

`apps/mobile/src/Stack.tsx:212-252` — nested stack inside a formSheet:
```
NewTask              ""                        title:"Choose project"
AddProject           "add-project"             title:"Add Project"
AddProjectRepository "add-project/repository"  (title = provider label / "Git URL")
AddProjectDestination "add-project/destination"
AddProjectLocal      "add-project/local"
```
Entry: `navigation.navigate("NewTaskSheet", { screen: "AddProject" })` from header `+` and empty-state CTA (**"Add new project"**; with no env ready → **"Add environment"**).

### 5.2 Shared primitives (`AddProjectScreen.tsx`)

- `AddProjectShell` (`:109-133`) — `flex-1 bg-sheet` + ScrollView `keyboardShouldPersistTaps="handled"`, padding 20/16/insets+18, gap 10.
- `SectionTitle` (`:101-107`) — tiny uppercase muted label.
- `ListSection` (`:135-137`) — `overflow-hidden rounded-[24px] bg-card`.
- `ListRow` (`:139-187`) — pressable row, 28×28 circular icon slot (accent bg when selected), bold title + 2-line muted subtitle, trailing chevron when enabled, `opacity-[0.45]` disabled, top border between rows.
- `PrimaryActionButton` (`:189-210`) — `h-12 rounded-full bg-primary`, spinner when loading, `disabled:opacity-45`.
- `ProjectPathInput` (`:212-229`) — `h-12 rounded-[24px] px-4`, `autoCapitalize="none"`, `autoCorrect={false}`, placeholder **`~/projects/my-app`**, `returnKeyType="done"`, `onSubmitEditing`.
- `ErrorBanner` — rounded rose-tinted inline banner (no toasts on mobile).
- `EmptyEnvironmentState` (`:268-285`) — "No environments connected" + CTA.

### 5.3 Source screen (`:334-439`)

- Environment selection list renders **only when >1** env ("Connected environments" section, checkmark on selected).
- One ListSection: **"Local folder" / "Browse a folder on disk"** row first, then `["url", ...sortedProviders]`.
- Not-ready provider rows: subtitle replaced by readiness hint, row disabled (no settings deep-link on mobile).
- Discovery pending → bare ActivityIndicator under the list.

### 5.4 Repository screen (`:506-589`)

Single TextInput (placeholder `https://github.com/org/repo.git` for url, else path hint), button **"Continue"** / **"Lookup repository"**; failure → inline ErrorBanner; success navigates to Destination with `{ remoteUrl: repository.sshUrl, repositoryTitle: repository.nameWithOwner }`.

### 5.5 Local folder screen (`:684-746`)

Order: ErrorBanner → path input → **"Add project"** button → `FolderBrowser`.
Path initialized from env base dir (`~/` default); `submitPath` resolves then creates; errors inline.

### 5.6 `FolderBrowser` (`:591-682`)

Section **"Browse folders"**; spinner only on first load (not revalidation); **hidden folders always excluded on mobile**; `..` row (`arrow.turn.left.up` symbol) + folder rows; tapping a row **replaces the input text** (append segment / ensure trailing separator), never submits; browse omits `cwd` (no relative paths on mobile).

### 5.7 Destination screen (`:748-838`)

Repository card (`rounded-[24px] bg-card px-4 py-3`, bold title, 2-line muted url) → path input → **"Clone project"** button → same FolderBrowser. `submitPath`: resolve → clone → `createProject(clonedCwd)`; all errors inline.

### 5.8 Mobile add semantics (`useCreateProject`, `:441-492`)

Duplicate → native `Alert.alert("Project already exists", title)` + replace-navigate into that project. Create command hard-codes `createWorkspaceRootIfMissing: true`. Success → replace-navigate into the new project's draft.

---

## 6. SERVER CONTRACT (t3code's — map to Ghostex gxserver equivalents)

### 6.1 `filesystem.browse` — directory suggestions
```ts
// Request: { partialPath: string /*trimmed, non-empty, ≤512*/, cwd?: string }
// Response: { parentPath: string, entries: Array<{ name: string, fullPath: string }> }
// Errors: windows_path_unsupported | current_project_required | read_directory_failed
```
Server impl (`apps/server/src/workspace/WorkspaceEntries.ts:181-228`):
- `~`/`~/…` expanded server-side; non-relative paths `path.resolve`d; relative requires `cwd`.
- `endsWithSeparator = /[\\/]$/.test(partialPath) || partialPath === "~"` → parentPath = path itself, prefix = ""; else parentPath = dirname, prefix = basename.
- `readdir withFileTypes`; **EACCES/EPERM swallowed into empty array** (silent empty list).
- Directories only, name starts with prefix (case-insensitive), hidden only when endsWithSeparator || prefix starts with "."; sort `localeCompare`.

### 6.2 project.create — registration
```ts
{ type:"project.create", commandId, projectId, title, workspaceRoot,
  createWorkspaceRootIfMissing?: boolean, defaultModelSelection?, createdAt }
```
Server normalizes workspaceRoot (`~` expand + resolve + stat; missing && createIfMissing → mkdir -p; still missing → "Workspace root does not exist: <p>"; not a dir → "Workspace root is not a directory: <p>"; mkdir failed → "Failed to create workspace root: <p>"). Invariants: project id absent; no active project with same normalized root ("Active project '<id>' already exists for workspace root '<p>'."). Emits `project.created` event.

### 6.3 `server.discoverSourceControl` — provider readiness (gh/glab/az CLIs, 5s probe timeout).

### 6.4 `sourceControl.lookupRepository` — `{ provider, repository, cwd? }` → `{ provider, nameWithOwner, url, sshUrl }` (e.g. `gh repo view <repo> --json nameWithOwner,url,sshUrl`).

### 6.5 `sourceControl.cloneRepository` — `{ remoteUrl, destinationPath }` → `{ cwd, remoteUrl, repository }`. Destination: expand+resolve; exists&non-empty → "Destination path already exists and is not empty."; exists&not-dir → error; else mkdir -p parent. Then `git clone`, timeout 120s.

### 6.6 Sidebar update: **push, not refetch** — server emits `project-upserted` event applied to the client's cached snapshot; the palette's duplicate-check reads the same store.

---

## 7. STATE MACHINE — see transitions table

| From | Trigger | To | Side effects |
|---|---|---|---|
| CLOSED | open add-project | ENV_PICK (>1 env) / SOURCE_PICK (1) / toast (0) | |
| ENV_PICK | select env | SOURCE_PICK | |
| SOURCE_PICK | Local folder | LOCAL_BROWSE | query = base dir \|\| "~/" |
| SOURCE_PICK | ready remote source | REPO_INPUT | query = "" |
| SOURCE_PICK | unready source | no-op (disabled) | |
| LOCAL_BROWSE | Enter on highlighted row / click | deeper LOCAL_BROWSE | append segment |
| LOCAL_BROWSE | `..` | parent | |
| LOCAL_BROWSE | Enter (no highlight) / mod+Enter | CREATING → CLOSED | add project |
| LOCAL_BROWSE | clear input / Backspace on empty | SOURCE_PICK | pop |
| REPO_INPUT | Enter (url) | CLONE_DEST | remoteUrl = raw |
| REPO_INPUT | Enter (provider) | lookup… → CLONE_DEST / toast+stay | remoteUrl = sshUrl |
| CLONE_DEST | Enter | CLONING → CREATING → CLOSED / toast+stay | |
| any | Esc / backdrop | CLOSED | all state destroyed |

Edge cases (full list in §7.3 of the recon; highlights):
- Nonexistent path → created (createWorkspaceRootIfMissing always true); button pre-labels "Create & Add"; hint "Press Enter to create this folder and add it as a project."
- Path is a file → server error toast "Workspace root is not a directory: <p>".
- Non-git dir → no validation anywhere; any dir can be a project.
- Browse permission denied → silent empty list.
- Duplicate (client-known) → web silently opens existing; mobile Alerts.
- Duplicate (race) → server invariant error toast.
- Empty submit / double submit → silent no-op / guarded by pending flags + serialization.

---

## 8. GOTCHAS FOR REIMPLEMENTERS

1. Prefer shared logic modules over the web palette's inline duplicates (t3code itself diverged).
2. **`~` expansion happens only on the server**; client passes `~/…` verbatim and uses `browseResult.parentPath` for the absolute form.
3. Hidden-folder behavior: web reveals dotfolders when leaf starts with `.`; mobile hides unconditionally.
4. Files are never listed — directories only.
5. No inline validation preview of the typed path; only the "Create & Add" vs "Add" label flip.
6. No debounce; correctness comes from keying the fetch on the directory prefix only.
7. **`autoHighlight={false}` in path modes is load-bearing** — Enter must submit the typed path unless the user explicitly highlighted a row.
8. The dialog body unmounts on close — state reset is by unmount, no explicit reset().
