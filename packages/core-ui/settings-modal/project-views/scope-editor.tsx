import { useId, type ReactNode } from 'react';
import { IconCheck, IconX } from '@tabler/icons-react';
import { Button } from '@/packages/components/ui/button';
import { Switch } from '@/packages/components/ui/switch';
import type { ProjectViewProject, ProjectViewSpace } from '@/packages/shared/ghostex-settings/project-views';
import {
  parseViewScopeSpaceKey,
  viewScopeSpaceKey,
  withViewScopeOverride,
  type GhostexViewScope,
  type GhostexViewScopeOverrideTarget,
} from '@/packages/shared/ghostex-settings/view-scopes';
import { SettingRow, SelectField } from '../fields';

/**
 * CDXC:Extensions 2026-09-20 DECISION:
 * User (ruling 3A): a view's scope is a Default of shown or hidden plus per-project and per-space
 * overrides. So this editor is a Default picker and two grids of toggle cards, each card writing one
 * override for one project or one space. It supersedes the 2026-09-18 "Available in" allow-list
 * (All projects / Selected projects / Selected spaces), which could not say "hide this one here".
 *
 * Two deliberate differences from the custom-view editor: there is no "Matching projects" option, because
 * only a custom view has a source that can fail to resolve, and the project list is ticked HERE rather
 * than one project at a time in Settings → Projects, because a built-in view carries no per-project
 * binding (URL, command, working directory) that would need a project page to edit.
 * SEE-ALSO: packages/core-ui/settings-modal/project-views/editor.tsx renders the custom-view picker.
 */
export type ViewScopeEditorState = { draft: GhostexViewScope; key: string; title: string };

/**
 * CDXC:Settings 2026-09-18 DECISION:
 * User: scope choices are toggle cards, three to a row.
 *
 * The whole card is ONE button so there is a single hit target and one focus stop; the switch inside is
 * the shared app-wide control rendered as decoration only (`aria-hidden`, not focusable), with the
 * button's `aria-pressed` carrying the real state. A nested interactive switch would put two controls in
 * one card and make click and keyboard behaviour depend on where the pointer landed.
 */
function ScopeToggleCard({
  checked,
  label,
  onToggle,
  title,
}: {
  checked: boolean;
  label: ReactNode;
  onToggle: (checked: boolean) => void;
  title?: string;
}) {
  return (
    <button
      aria-pressed={checked}
      className='settings-scope-toggle-card'
      onClick={() => onToggle(!checked)}
      title={title}
      type='button'
    >
      <span className='settings-scope-toggle-card-label'>{label}</span>
      <Switch aria-hidden='true' checked={checked} className='pointer-events-none' size='sm' tabIndex={-1} />
    </button>
  );
}

function ScopeToggleGrid({ children, emptyState, id }: { children: ReactNode; emptyState: string; id: string }) {
  const hasOptions = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return hasOptions ? (
    <div className='settings-scope-toggle-grid' id={id}>
      {children}
    </div>
  ) : (
    <span className='text-sm text-muted-foreground' id={id}>
      {emptyState}
    </span>
  );
}

export function ViewScopeEditor({
  editor,
  onCancel,
  onChange,
  onSave,
  projects,
  spaces,
}: {
  editor: ViewScopeEditorState;
  onCancel: () => void;
  /**
   * CDXC:Settings 2026-09-18 WHY:
   * Takes an updater, not a value. Each card writes one key of the same draft, so a value-based callback
   * reads `editor` from the render that mounted the card: two toggles landing in one React batch make the
   * second overwrite the first, and the card the user pressed first silently springs back.
   */
  onChange: (apply: (current: ViewScopeEditorState) => ViewScopeEditorState) => void;
  onSave: () => void;
  projects: readonly ProjectViewProject[];
  spaces: readonly ProjectViewSpace[];
}) {
  const id = useId();
  const scope = editor.draft;
  const override = (target: GhostexViewScopeOverrideTarget, checked: boolean) =>
    onChange((current) => ({
      ...current,
      draft: withViewScopeOverride(current.draft, target, checked ? 'shown' : 'hidden'),
    }));
  /*
   * A saved override can outlive the space or project it names — a space deleted in the sidebar, a
   * project closed, a remote machine disconnected. Keep the stored entry visible and editable rather
   * than dropping it silently, so saving an unrelated edit cannot quietly widen or narrow the scope.
   */
  const spaceOptions: ProjectViewSpace[] = [
    ...spaces,
    ...Object.keys(scope.spaces).flatMap((key) => {
      if (spaces.some((space) => viewScopeSpaceKey(space) === key)) return [];
      const ref = parseViewScopeSpaceKey(key);
      return ref ? [{ ...ref, name: 'Unavailable space' }] : [];
    }),
  ];
  const projectOptions: ProjectViewProject[] = [
    ...projects,
    ...Object.keys(scope.projects).flatMap((projectId) =>
      projects.some((project) => project.projectId === projectId)
        ? []
        : [{ name: 'Unavailable project', path: '', projectId }]
    ),
  ];
  /*
   * CDXC:Extensions 2026-09-20 WHY:
   * A card shows its own override, or the Default when it has none. It cannot show the space a project
   * inherits from, because Settings is given the sidebar's project rows and its space rows but not the
   * membership between them; that is resolved live, per active project, by the sidebar runtime. The note
   * under Projects says so, and a view tab's own menu (which knows the project it is on) is where the
   * fully resolved state is ticked.
   */
  const spacesNarrow = Object.values(scope.spaces).some((state) => state !== scope.default);
  return (
    <div className='settings-list-panel py-3'>
      <SelectField
        description={`Where ${editor.title} appears unless a project or space below says otherwise.`}
        label='Default'
        value={scope.default}
        onChange={(next) =>
          onChange((current) => ({
            ...current,
            draft: { ...current.draft, default: next === 'hidden' ? 'hidden' : 'shown' },
          }))
        }
        options={[
          { value: 'shown', label: 'Shown everywhere' },
          { value: 'hidden', label: 'Hidden unless chosen' },
        ]}
      />
      <SettingRow
        label='Projects'
        htmlFor={`${id}-projects`}
        description={`Turn ${editor.title} on or off for one project. A project wins over its space and over the default.${
          spacesNarrow ? ' Projects you leave alone follow their space below.' : ''
        }`}
        wide
      >
        <ScopeToggleGrid emptyState='No projects in the sidebar yet.' id={`${id}-projects`}>
          {projectOptions.map((project) => (
            <ScopeToggleCard
              checked={(scope.projects[project.projectId] ?? scope.default) === 'shown'}
              key={project.projectId}
              label={project.name}
              onToggle={(checked) => override({ kind: 'project', projectId: project.projectId }, checked)}
              title={project.path || undefined}
            />
          ))}
        </ScopeToggleGrid>
      </SettingRow>
      <SettingRow
        label='Spaces'
        htmlFor={`${id}-spaces`}
        description={`Turn ${editor.title} on or off for a whole space, including projects in its groups and their worktrees.`}
        wide
      >
        <ScopeToggleGrid emptyState='No spaces available. Create a space in the sidebar first.' id={`${id}-spaces`}>
          {spaceOptions.map((space) => (
            <ScopeToggleCard
              checked={(scope.spaces[viewScopeSpaceKey(space)] ?? scope.default) === 'shown'}
              key={viewScopeSpaceKey(space)}
              label={space.name}
              onToggle={(checked) =>
                override({ kind: 'space', space: { sectionKey: space.sectionKey, spaceId: space.spaceId } }, checked)
              }
            />
          ))}
        </ScopeToggleGrid>
      </SettingRow>
      <div className='settings-management-actions flex-wrap py-3'>
        <Button onClick={onCancel} type='button' variant='outline'>
          <IconX data-icon='inline-start' />
          Cancel
        </Button>
        <Button onClick={onSave} type='button'>
          <IconCheck data-icon='inline-start' />
          Save changes
        </Button>
      </div>
    </div>
  );
}
