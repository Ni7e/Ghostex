import { useId, type ReactNode } from 'react';
import { IconCheck, IconX } from '@tabler/icons-react';
import { Button } from '@/packages/components/ui/button';
import { Switch } from '@/packages/components/ui/switch';
import type { ProjectViewProject, ProjectViewSpace } from '@/packages/shared/ghostex-settings/project-views';
import type { GhostexViewScope } from '@/packages/shared/ghostex-settings/view-scopes';
import { SettingRow, SelectField } from '../fields';

/**
 * CDXC:Extensions 2026-09-18 DECISION:
 * User: built-in views and extensions get the same Edit button and the same "Available in" picker as the
 * custom views, so a workarea, a titlebar button, or a store extension can be limited to chosen projects
 * or chosen spaces instead of only being on or off app-wide. The projects and spaces are picked as a
 * three-per-row grid of toggle cards, not a checkbox list.
 *
 * Two deliberate differences from the custom-view editor: there is no "Matching projects" option, because
 * only a custom view has a source that can fail to resolve, and the project list is ticked HERE rather
 * than one project at a time in Settings → Projects, because a built-in view carries no per-project
 * binding (URL, command, working directory) that would need a project page to edit.
 * SEE-ALSO: packages/core-ui/settings-modal/project-views/editor.tsx renders the same two controls.
 */
export type ViewScopeEditorState = { draft: GhostexViewScope; error?: string; key: string; title: string };

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
  const update = (patch: Partial<GhostexViewScope>) =>
    onChange((current) => ({ ...current, draft: { ...current.draft, ...patch }, error: undefined }));
  /*
   * A saved scope can outlive the space or project it names — a space deleted in the sidebar, a project
   * closed, a remote machine disconnected. Keep the stored entry visible and untickable-away-by-accident
   * rather than dropping it silently, so saving an unrelated edit cannot quietly widen the scope.
   */
  const spaceOptions = [
    ...spaces,
    ...scope.spaceRefs
      .filter((ref) => !spaces.some((space) => space.sectionKey === ref.sectionKey && space.spaceId === ref.spaceId))
      .map((ref) => ({ ...ref, name: 'Unavailable space' })),
  ];
  const projectOptions = [
    ...projects,
    ...scope.projectIds
      .filter((projectId) => !projects.some((project) => project.projectId === projectId))
      .map((projectId) => ({ name: 'Unavailable project', path: '', projectId })),
  ];
  return (
    <div className='settings-list-panel py-3'>
      <SelectField
        description={`Choose where ${editor.title} appears.`}
        label='Available in'
        value={scope.availability}
        onChange={(availability) => update({ availability: availability as GhostexViewScope['availability'] })}
        options={[
          { value: 'all', label: 'All projects' },
          { value: 'selected', label: 'Selected projects' },
          { value: 'spaces', label: 'Selected spaces' },
        ]}
      />
      {scope.availability === 'selected' ? (
        <SettingRow
          label='Projects'
          htmlFor={`${id}-projects`}
          description={`Show ${editor.title} only in the projects you turn on here.`}
          wide
        >
          <ScopeToggleGrid emptyState='No projects in the sidebar yet.' id={`${id}-projects`}>
            {projectOptions.map((project) => {
              const checked = scope.projectIds.includes(project.projectId);
              return (
                <ScopeToggleCard
                  checked={checked}
                  key={project.projectId}
                  label={project.name}
                  onToggle={(selected) =>
                    update({
                      projectIds: selected
                        ? [...scope.projectIds, project.projectId]
                        : scope.projectIds.filter((projectId) => projectId !== project.projectId),
                    })
                  }
                  title={project.path || undefined}
                />
              );
            })}
          </ScopeToggleGrid>
        </SettingRow>
      ) : null}
      {scope.availability === 'spaces' ? (
        <SettingRow
          label='Spaces'
          htmlFor={`${id}-spaces`}
          description={`Show ${editor.title} for any project in a space you turn on here, including projects in its groups and their worktrees.`}
          wide
        >
          <ScopeToggleGrid emptyState='No spaces available. Create a space in the sidebar first.' id={`${id}-spaces`}>
            {spaceOptions.map((space) => {
              const checked = scope.spaceRefs.some(
                (ref) => ref.sectionKey === space.sectionKey && ref.spaceId === space.spaceId
              );
              return (
                <ScopeToggleCard
                  checked={checked}
                  key={`${space.sectionKey}:${space.spaceId}`}
                  label={space.name}
                  onToggle={(selected) =>
                    update({
                      spaceRefs: selected
                        ? [...scope.spaceRefs, { sectionKey: space.sectionKey, spaceId: space.spaceId }]
                        : scope.spaceRefs.filter(
                            (ref) => ref.sectionKey !== space.sectionKey || ref.spaceId !== space.spaceId
                          ),
                    })
                  }
                />
              );
            })}
          </ScopeToggleGrid>
        </SettingRow>
      ) : null}
      {editor.error ? (
        <p className='text-sm text-destructive' role='alert'>
          {editor.error}
        </p>
      ) : null}
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
