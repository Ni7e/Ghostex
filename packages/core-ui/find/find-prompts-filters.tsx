/*
CDXC:PromptSearch 2026-09-16 DECISION:
User: the agent and project filters at the top right of Find are dropdowns like the Quick Access Sessions tab (searchable project list, checkmarks on the active choices), not hint keys that open a pane at the bottom. The hotkeys still open these menus.
*/

import { IconChevronDown } from '@tabler/icons-react';
import { Button } from '@/packages/components/ui/button';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/packages/components/ui/command';
import { Popover, PopoverTrigger } from '@/packages/components/ui/popover';
import { SearchableDropdownContent } from '@/packages/components/ui/searchable-dropdown';
import { cn } from '@/packages/components/utils';
import { AppTooltip } from '../app-tooltip';
import {
  FIND_PROMPT_AGENTS,
  type FindPromptAgent,
  type FindPromptProjectFacet,
} from '../../shared/agent-prompt-search';

export const FIND_TOOLBAR_BUTTON_CLASS =
  'ghostex-find-toolbar-button h-8 gap-1.5 px-2.5 text-[13px] font-normal text-muted-foreground hover:text-foreground data-[active=true]:border-foreground/35 data-[active=true]:text-foreground';

/* CDXC:PromptSearch 2026-09-16 DECISION:
 * User: the agent and project dropdowns keep a fixed width and truncate the picked value, so the toolbar does not resize when the selection changes. */
function FilterTrigger({
  active,
  hotkey,
  label,
  open,
  title,
  widthClass,
}: {
  active: boolean;
  hotkey: string;
  label: string;
  open: boolean;
  title: string;
  widthClass: string;
}) {
  return (
    <AppTooltip content={`${title} (${hotkey})`}>
      <PopoverTrigger
        aria-expanded={open}
        aria-label={title}
        render={
          <Button
            className={cn(FIND_TOOLBAR_BUTTON_CLASS, 'justify-between', widthClass)}
            data-active={active ? 'true' : 'false'}
            onKeyDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.preventDefault()}
            variant='outline'
          />
        }
      >
        <span className='min-w-0 flex-1 truncate text-left'>{label}</span>
        <IconChevronDown className='size-3.5 shrink-0 opacity-70' />
      </PopoverTrigger>
    </AppTooltip>
  );
}

export function FindAgentFilterMenu({
  colors,
  hotkey,
  onClear,
  onOpenChange,
  onToggle,
  open,
  selected,
}: {
  colors: Readonly<Record<string, string>>;
  hotkey: string;
  onClear: () => void;
  onOpenChange: (open: boolean) => void;
  onToggle: (agent: FindPromptAgent) => void;
  open: boolean;
  selected: ReadonlySet<FindPromptAgent>;
}) {
  const label =
    selected.size === 0 ? 'All agents' : [...FIND_PROMPT_AGENTS].filter((agent) => selected.has(agent)).join(', ');
  return (
    <Popover onOpenChange={onOpenChange} open={open}>
      <FilterTrigger
        active={selected.size > 0}
        hotkey={hotkey}
        label={label}
        open={open}
        title='Filter by agent'
        widthClass='w-32'
      />
      <SearchableDropdownContent align='end' className='ghostex-find-filter-menu' sideOffset={6}>
        <Command>
          <CommandList aria-multiselectable>
            <CommandItem data-checked={selected.size === 0} onSelect={onClear} value='All agents'>
              All agents
            </CommandItem>
            {FIND_PROMPT_AGENTS.map((agent) => (
              <CommandItem
                data-checked={selected.has(agent)}
                key={agent}
                onSelect={() => onToggle(agent)}
                value={agent}
              >
                <span
                  aria-hidden='true'
                  className='size-2 shrink-0 rounded-full'
                  style={{ backgroundColor: colors[agent] }}
                />
                {agent}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </SearchableDropdownContent>
    </Popover>
  );
}

export function FindProjectFilterMenu({
  hotkey,
  onOpenChange,
  onSelect,
  open,
  projects,
  selected,
}: {
  hotkey: string;
  onOpenChange: (open: boolean) => void;
  onSelect: (path: string | null) => void;
  open: boolean;
  projects: readonly FindPromptProjectFacet[];
  selected: string | null;
}) {
  const label = projects.find((facet) => facet.path === selected)?.name ?? (selected ? selected : 'All projects');
  const pick = (path: string | null) => {
    onSelect(path);
    onOpenChange(false);
  };
  return (
    <Popover onOpenChange={onOpenChange} open={open}>
      <FilterTrigger
        active={selected !== null}
        hotkey={hotkey}
        label={label}
        open={open}
        title='Filter by project'
        widthClass='w-40'
      />
      <SearchableDropdownContent align='end' className='ghostex-find-filter-menu' sideOffset={6}>
        <Command>
          <CommandInput aria-label='Filter projects' autoFocus clearOnEscape={false} placeholder='Filter projects...' />
          <CommandList>
            <CommandEmpty>No projects found.</CommandEmpty>
            <CommandItem data-checked={selected === null} onSelect={() => pick(null)} value='All projects'>
              All projects
            </CommandItem>
            {projects.map((facet) => (
              <CommandItem
                data-checked={selected === facet.path}
                key={facet.path}
                keywords={[facet.name, facet.path]}
                onSelect={() => pick(facet.path)}
                title={facet.path}
                value={facet.path}
              >
                <span className='truncate'>{facet.name}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </SearchableDropdownContent>
    </Popover>
  );
}
