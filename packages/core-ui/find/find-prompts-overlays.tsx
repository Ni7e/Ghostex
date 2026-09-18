/*
CDXC:PromptSearch 2026-09-16 WHY:
Only the fork picker still takes over the bottom pane where the terminal picker
puts it. The agent and project filters moved to dropdowns in the toolbar
(find-prompts-filters.tsx) on the user's instruction, superseding the 2026-08-20
layout that mirrored all three terminal overlays here.
*/

import { FIND_PROMPT_AGENTS, type FindPromptAgent } from '../../shared/agent-prompt-search';

function OverlayShell({ children, hint, title }: { children: React.ReactNode; hint: string; title: string }) {
  return (
    <div className='flex h-full min-h-0 flex-col gap-1 px-3 py-2'>
      <div className='text-[12px] font-medium uppercase tracking-wide text-muted-foreground'>{title}</div>
      <div className='min-h-0 flex-1 overflow-y-auto scrollbar-thin'>{children}</div>
      <div className='text-[12px] text-muted-foreground'>{hint}</div>
    </div>
  );
}

export function FindForkOverlay({
  colors,
  onPick,
}: {
  colors: Readonly<Record<string, string>>;
  onPick: (agent: FindPromptAgent) => void;
}) {
  return (
    <OverlayShell hint='Press 1-6, or click an agent · Esc cancels' title='Fork prompt into'>
      <div className='flex flex-wrap gap-1.5 py-1'>
        {FIND_PROMPT_AGENTS.map((agent, position) => (
          <button
            className='flex items-center gap-1.5 rounded-md bg-accent/40 px-2.5 py-1.5 text-[14px] hover:bg-accent/70'
            key={agent}
            onMouseDown={(event) => {
              event.preventDefault();
              onPick(agent);
            }}
            type='button'
          >
            <span className='font-semibold tabular-nums'>{position + 1}</span>
            <span aria-hidden='true' className='size-2 rounded-full' style={{ backgroundColor: colors[agent] }} />
            <span>{agent}</span>
          </button>
        ))}
      </div>
    </OverlayShell>
  );
}
