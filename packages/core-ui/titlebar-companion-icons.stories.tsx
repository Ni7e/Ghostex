import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ComponentType } from 'react';
import { MessageCircle, MessageSquare } from 'lucide-react';
import {
  IconMessage,
  IconMessageFilled,
  IconMessage2,
  IconMessage2Filled,
  IconMessageCircle2,
  IconMessageCircle2Filled,
  IconBubble,
  IconBubbleFilled,
  IconBubbleText,
  IconBubbleTextFilled,
  IconMessages,
  IconMessagesFilled,
  IconArrowBarLeft,
  IconArrowBarRight,
  IconArrowLeftToArc,
  IconArrowRightToArc,
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconChevronLeft,
  IconChevronRight,
  IconChevronLeftPipe,
  IconChevronRightPipe,
  IconChevronsLeft,
  IconChevronsRight,
  IconColumns1,
  IconColumns2,
  IconColumns1Filled,
  IconColumns2Filled,
  IconEye,
  IconEyeOff,
  IconEyeClosed,
  IconLayoutSidebar,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconLayoutSidebarLeftCollapseFilled,
  IconLayoutSidebarLeftExpandFilled,
  IconLayoutSidebarRightCollapse,
  IconLayoutSidebarRightExpand,
  IconLayoutBottombarCollapse,
  IconLayoutBottombarExpand,
  IconSquareChevronLeft,
  IconSquareChevronRight,
  IconSquareChevronLeftFilled,
  IconSquareChevronRightFilled,
  IconSquareChevronsLeft,
  IconSquareChevronsRight,
  IconSquareMinus,
  IconSquarePlus,
  IconWindowMinimize,
  IconWindowMaximize,
  IconWindowOff,
  IconWindow,
} from '@tabler/icons-react';

type Glyph = ComponentType<{ size?: number; stroke?: number }>;
type Option = { name: string; hide: Glyph; show: Glyph; names: string };

const chatBubble: Option = {
  name: 'Side tail with text (current)',
  hide: IconMessage,
  show: IconMessage,
  names: 'Tabler Message · Outline in both states',
};

const chatAlternatives: Option[] = [
  {
    name: 'Rounded square (recommended)',
    hide: ({ size, stroke }) => <MessageSquare size={size} strokeWidth={stroke} fill='currentColor' />,
    show: ({ size, stroke }) => <MessageSquare size={size} strokeWidth={stroke} />,
    names: 'Lucide MessageSquare',
  },
  {
    name: 'Simple circle',
    hide: ({ size, stroke }) => <MessageCircle size={size} strokeWidth={stroke} fill='currentColor' />,
    show: ({ size, stroke }) => <MessageCircle size={size} strokeWidth={stroke} />,
    names: 'Lucide MessageCircle',
  },
  {
    name: 'Centered tail with text',
    hide: IconMessage2Filled,
    show: IconMessage2,
    names: 'Tabler Message2Filled / Message2',
  },
  { name: 'Side tail with text', hide: IconMessageFilled, show: IconMessage, names: 'Tabler MessageFilled / Message' },
  {
    name: 'Geometric round',
    hide: IconMessageCircle2Filled,
    show: IconMessageCircle2,
    names: 'Tabler MessageCircle2Filled / MessageCircle2',
  },
  { name: 'Compact bubble', hide: IconBubbleFilled, show: IconBubble, names: 'Tabler BubbleFilled / Bubble' },
  {
    name: 'Overlapping conversation',
    hide: IconMessagesFilled,
    show: IconMessages,
    names: 'Tabler MessagesFilled / Messages',
  },
  {
    name: 'Compact bubble with text',
    hide: IconBubbleTextFilled,
    show: IconBubbleText,
    names: 'Tabler BubbleTextFilled / BubbleText',
  },
];

const options: Option[] = [
  chatBubble,
  { name: 'Bar arrows', hide: IconArrowBarLeft, show: IconArrowBarRight, names: 'ArrowBarLeft / ArrowBarRight' },
  {
    name: 'Chevron stops',
    hide: IconChevronLeftPipe,
    show: IconChevronRightPipe,
    names: 'ChevronLeftPipe / ChevronRightPipe',
  },
  { name: 'Double chevrons', hide: IconChevronsLeft, show: IconChevronsRight, names: 'ChevronsLeft / ChevronsRight' },
  { name: 'Single chevrons', hide: IconChevronLeft, show: IconChevronRight, names: 'ChevronLeft / ChevronRight' },
  {
    name: 'Arrow to edge',
    hide: IconArrowLeftToArc,
    show: IconArrowRightToArc,
    names: 'ArrowLeftToArc / ArrowRightToArc',
  },
  {
    name: 'Square chevrons',
    hide: IconSquareChevronLeft,
    show: IconSquareChevronRight,
    names: 'SquareChevronLeft / SquareChevronRight',
  },
  {
    name: 'Square double chevrons',
    hide: IconSquareChevronsLeft,
    show: IconSquareChevronsRight,
    names: 'SquareChevronsLeft / SquareChevronsRight',
  },
  {
    name: 'Solid square chevrons',
    hide: IconSquareChevronLeftFilled,
    show: IconSquareChevronRightFilled,
    names: 'SquareChevronLeftFilled / SquareChevronRightFilled',
  },
  {
    name: 'Left panel chevrons',
    hide: IconLayoutSidebarLeftCollapse,
    show: IconLayoutSidebarLeftExpand,
    names: 'LayoutSidebarLeftCollapse / LayoutSidebarLeftExpand',
  },
  {
    name: 'Solid left panel',
    hide: IconLayoutSidebarLeftCollapseFilled,
    show: IconLayoutSidebarLeftExpandFilled,
    names: 'LayoutSidebarLeftCollapseFilled / LayoutSidebarLeftExpandFilled',
  },
  {
    name: 'Right panel chevrons',
    hide: IconLayoutSidebarRightCollapse,
    show: IconLayoutSidebarRightExpand,
    names: 'LayoutSidebarRightCollapse / LayoutSidebarRightExpand',
  },
  {
    name: 'Bottom panel chevrons',
    hide: IconLayoutBottombarCollapse,
    show: IconLayoutBottombarExpand,
    names: 'LayoutBottombarCollapse / LayoutBottombarExpand',
  },
  { name: 'One pane / split panes', hide: IconColumns1, show: IconColumns2, names: 'Columns1 / Columns2' },
  {
    name: 'Solid one / split panes',
    hide: IconColumns1Filled,
    show: IconColumns2Filled,
    names: 'Columns1Filled / Columns2Filled',
  },
  { name: 'Visibility', hide: IconEyeOff, show: IconEye, names: 'EyeOff / Eye' },
  { name: 'Closed / open eye', hide: IconEyeClosed, show: IconEye, names: 'EyeClosed / Eye' },
  { name: 'Minus / plus', hide: IconSquareMinus, show: IconSquarePlus, names: 'SquareMinus / SquarePlus' },
  {
    name: 'Inward / outward corners',
    hide: IconArrowsMinimize,
    show: IconArrowsMaximize,
    names: 'ArrowsMinimize / ArrowsMaximize',
  },
  {
    name: 'Minimize / restore window',
    hide: IconWindowMinimize,
    show: IconWindowMaximize,
    names: 'WindowMinimize / WindowMaximize',
  },
  { name: 'Hidden / visible window', hide: IconWindowOff, show: IconWindow, names: 'WindowOff / Window' },
];

function Candidate({ option, number }: { option: Option; number: number }) {
  const [visible, setVisible] = useState(true);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const ActiveIcon = visible ? option.hide : option.show;
  return (
    <article className='companion-candidate' aria-label={`${number}. ${option.name}`}>
      <h2>
        <span className='candidate-number'>{String(number).padStart(2, '0')}</span>
        {option.name}
      </h2>
      <div className='candidate-pair'>
        <div>
          <option.hide size={32} stroke={1.9} />
          <span>Hide companion</span>
        </div>
        <div>
          <option.show size={32} stroke={1.9} />
          <span>Show companion</span>
        </div>
      </div>
      <div className='candidate-titlebar'>
        <button
          type='button'
          className='candidate-toggle'
          title={sidebarVisible ? 'Hide sidebar' : 'Show sidebar'}
          aria-label={sidebarVisible ? 'Hide sidebar' : 'Show sidebar'}
          aria-pressed={sidebarVisible}
          onClick={() => setSidebarVisible(!sidebarVisible)}
        >
          <IconLayoutSidebar size={18} stroke={1.9} />
        </button>
        <button
          type='button'
          className='candidate-toggle companion-toggle'
          title={visible ? 'Hide companion' : 'Show companion'}
          aria-label={visible ? 'Hide companion' : 'Show companion'}
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
        >
          <ActiveIcon size={16} stroke={1.9} />
        </button>
        <span className='candidate-navigation' aria-hidden='true'>
          <IconChevronLeft size={14} stroke={1.9} />
          <IconChevronRight size={14} stroke={1.9} />
        </span>
        <span className='candidate-project'>Ghostex</span>
      </div>
      <div className='candidate-workarea' aria-hidden='true'>
        {sidebarVisible && <div className='candidate-sidebar' />}
        {visible && (
          <div className='candidate-companion'>
            <span />
            <span />
          </div>
        )}
        <div className='candidate-main' />
      </div>
      <p className='candidate-state' aria-live='polite'>
        Companion {visible ? 'visible' : 'hidden'}
      </p>
      <code>{option.names}</code>
    </article>
  );
}

function CompanionIconGallery({
  appearance,
  selection,
}: {
  appearance: 'dark' | 'light';
  selection: 'all' | 'chat-bubble' | 'chat-alternatives';
}) {
  const displayedOptions =
    selection === 'chat-bubble' ? [chatBubble] : selection === 'chat-alternatives' ? chatAlternatives : options;
  return (
    <main className='companion-icon-gallery' data-appearance={appearance}>
      <style>{`
        .companion-icon-gallery { --gallery-bg: #101010; --gallery-panel: #161616; --gallery-chrome: #202020; --gallery-line: #343434; --gallery-text: #e6e6e6; --gallery-muted: #a3a3a3; --gallery-hover: #383838; box-sizing: border-box; min-height: 100vh; padding: 28px; background: var(--gallery-bg); color: var(--gallery-text); font: 14px/1.5 'Inter Variable', sans-serif; }
        .companion-icon-gallery[data-appearance='light'] { --gallery-bg: #fafafa; --gallery-panel: #fff; --gallery-chrome: #f4f4f5; --gallery-line: #d4d4d8; --gallery-text: #27272a; --gallery-muted: #606068; --gallery-hover: #e4e4e7; }
        .companion-icon-gallery * { box-sizing: border-box; }
        .companion-icon-gallery h1 { margin: 0 0 8px; font-size: 24px; font-weight: 600; }
        .companion-icon-gallery header p { margin: 0; color: var(--gallery-muted); max-width: 720px; }
        .companion-icon-gallery .candidate-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 310px), 1fr)); gap: 16px; margin-top: 24px; }
        .companion-icon-gallery .companion-candidate { min-width: 0; padding: 18px; background: var(--gallery-panel); border: 1px solid var(--gallery-line); border-radius: 10px; }
        .companion-icon-gallery h2 { display: flex; gap: 10px; align-items: baseline; margin: 0; font-size: 14px; font-weight: 600; }
        .companion-icon-gallery .candidate-number { color: var(--gallery-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
        .companion-icon-gallery .candidate-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 24px 0; }
        .companion-icon-gallery .candidate-pair > div { display: flex; flex-direction: column; align-items: center; gap: 10px; }
        .companion-icon-gallery .candidate-pair span { font-size: 12px; color: var(--gallery-muted); }
        .companion-icon-gallery .candidate-titlebar { height: 28px; display: flex; align-items: center; padding: 0 6px; background: var(--gallery-chrome); border-bottom: 1px solid var(--gallery-line); }
        .companion-icon-gallery .candidate-toggle { width: 29px; height: 27px; padding: 0; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 29px; color: var(--gallery-text); border: 0; border-radius: 0; background: transparent; cursor: pointer; }
        .companion-icon-gallery .companion-toggle { width: 27px; height: 25px; flex-basis: 27px; }
        .companion-icon-gallery .candidate-toggle svg { transform: translate(.75px, .25px); }
        .companion-icon-gallery .candidate-toggle:hover { background: var(--gallery-hover); }
        .companion-icon-gallery .candidate-toggle:focus-visible { outline: 2px solid #7198ff; outline-offset: -2px; }
        .companion-icon-gallery .candidate-navigation { display: flex; gap: 12px; padding: 0 8px; color: var(--gallery-muted); }
        .companion-icon-gallery .candidate-project { margin-left: 8px; font-size: 12px; font-weight: 600; }
        .companion-icon-gallery .candidate-workarea { display: flex; height: 50px; gap: 3px; padding: 4px; background: var(--gallery-bg); }
        .companion-icon-gallery .candidate-sidebar { width: 36px; border-right: 1px solid var(--gallery-line); background: var(--gallery-chrome); }
        .companion-icon-gallery .candidate-companion { width: 52px; display: flex; flex-direction: column; gap: 3px; }
        .companion-icon-gallery .candidate-companion span { flex: 1; border: 1px solid var(--gallery-line); }
        .companion-icon-gallery .candidate-main { flex: 1; background: var(--gallery-panel); }
        .companion-icon-gallery .candidate-state { margin: 10px 0 4px; color: var(--gallery-muted); font-size: 12px; }
        .companion-icon-gallery code { display: block; overflow-wrap: anywhere; color: var(--gallery-muted); font-size: 11px; }
        .companion-icon-gallery footer { margin-top: 24px; color: var(--gallery-muted); }
        @media (max-width: 500px) { .companion-icon-gallery { padding: 16px; } }
      `}</style>
      <header>
        <h1>
          {selection === 'chat-alternatives'
            ? 'Chat bubbles: 8 alternatives'
            : selection === 'chat-bubble'
              ? 'Companion toggle: side tail with text'
              : `Companion toggle: ${options.length} icon pairs`}
        </h1>
        <p>
          Compare both states enlarged, then try the second button in each titlebar. The sidebar button stays beside it.
          Sidebar: 29 × 27px with an 18px icon. Companion: 27 × 25px with a 16px icon. Stroke: 1.9.
        </p>
      </header>
      <div className='candidate-grid' style={selection === 'chat-bubble' ? { maxWidth: 420 } : undefined}>
        {displayedOptions.map((option, index) => (
          <Candidate key={option.name} option={option} number={index + 1} />
        ))}
      </div>
      <footer>
        {selection === 'chat-bubble'
          ? 'Same outlined icon in both states · Tooltip changes between Hide and Show companion'
          : `${displayedOptions.length} pairs · Choose by number or name`}
      </footer>
    </main>
  );
}

const meta = {
  title: 'Titlebar/Companion Icon Options',
  component: CompanionIconGallery,
  parameters: { layout: 'fullscreen' },
  args: { appearance: 'dark', selection: 'all' },
  argTypes: { appearance: { control: 'inline-radio', options: ['dark', 'light'] } },
} satisfies Meta<typeof CompanionIconGallery>;

export default meta;
type Story = StoryObj<typeof meta>;
export const AllOptions: Story = {};
export const ChatBubbleSelected: Story = { args: { selection: 'chat-bubble' } };
export const SideTailWithText: Story = { args: { selection: 'chat-bubble' } };
export const ChatBubbleAlternatives: Story = { args: { selection: 'chat-alternatives' } };
