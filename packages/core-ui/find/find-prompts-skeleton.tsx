/*
CDXC:PromptSearch 2026-09-16 DECISION:
User: while prompts load, Find shows skeleton rows shaped like the rendered result list (day header, agent column, prompt line, time and title line) filling the whole results area, and a paragraph-shaped skeleton in the preview pane, instead of a centered spinner.
*/

import { cn } from '@/packages/components/utils';

/* Widths cycle so the list reads as real content rather than a stripe pattern. */
const PROMPT_WIDTHS = ['62%', '44%', '78%', '35%', '56%', '70%', '48%', '66%', '40%', '74%'];
const TITLE_WIDTHS = ['38%', '52%', '30%', '46%', '58%', '34%', '50%', '42%', '60%', '36%'];
const PARAGRAPH_WIDTHS = ['92%', '84%', '96%', '70%', '88%', '78%', '94%', '52%'];
const SKELETON_ROW_COUNT = 40;
const ROWS_PER_DAY = 7;

function Bar({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <span aria-hidden='true' className={cn('ghostex-find-skeleton-bar', className)} style={style} />;
}

function SkeletonDayHeader() {
  return (
    <div className='px-2 pb-1.5 pt-3.5'>
      <Bar className='h-3 w-44' />
    </div>
  );
}

function SkeletonRow({ position }: { position: number }) {
  return (
    <div className='ghostex-find-row flex gap-2 rounded-lg px-2 py-2'>
      <span className='w-3 shrink-0' />
      <span className='flex min-w-0 flex-1 flex-col gap-2'>
        <span className='flex min-w-0 items-center gap-2.5'>
          <Bar className='h-3.5 w-[4.5rem] shrink-0' />
          <Bar className='h-3.5' style={{ width: PROMPT_WIDTHS[position % PROMPT_WIDTHS.length] }} />
        </span>
        <span className='flex min-w-0 items-center gap-2.5'>
          <Bar className='h-3 w-[4.5rem] shrink-0 opacity-70' />
          <Bar className='h-3 opacity-70' style={{ width: TITLE_WIDTHS[position % TITLE_WIDTHS.length] }} />
        </span>
      </span>
    </div>
  );
}

/** Fills the results list with placeholder rows; the parent clips the overflow. */
export function FindPromptsListSkeleton({ groupByDay }: { groupByDay: boolean }) {
  const rows: React.ReactNode[] = [];
  for (let position = 0; position < SKELETON_ROW_COUNT; position += 1) {
    if (groupByDay && position % ROWS_PER_DAY === 0) {
      rows.push(<SkeletonDayHeader key={`day-${position}`} />);
    }
    rows.push(<SkeletonRow key={`row-${position}`} position={position} />);
  }
  return (
    <div
      aria-busy='true'
      aria-label='Loading prompts'
      className='ghostex-find-skeleton h-full overflow-hidden'
      role='status'
    >
      {rows}
    </div>
  );
}

/** Paragraph-shaped placeholder for the selected-prompt preview. */
export function FindPromptsPreviewSkeleton() {
  return (
    <div aria-hidden='true' className='ghostex-find-skeleton flex flex-col gap-2.5 px-3 py-1'>
      {PARAGRAPH_WIDTHS.map((width, position) => (
        <Bar className='h-3.5' key={position} style={{ width }} />
      ))}
    </div>
  );
}
