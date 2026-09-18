import { useState } from 'react';
import type { PanelProps } from '../onboarding-state';
import { AgentsTogetherDemo, ChatTerminalDemo, DesktopMobileDemo } from '../previews/welcome-demos';
import { Cta, Eyebrow, FootActions, Heading, Icon, Sub, type IconName } from '../primitives';
import { box } from '../stage';

type WelcomeTab = 'together' | 'chat' | 'mobile';

const TABS: readonly { id: WelcomeTab; icon: IconName; title: string; detail: string }[] = [
  {
    id: 'together',
    icon: 'org',
    title: 'Agents that work together',
    detail: 'One agent can launch and hand work to another.',
  },
  { id: 'chat', icon: 'chat', title: 'Chat + terminal', detail: 'Read it as a chat, the real CLI runs underneath.' },
  { id: 'mobile', icon: 'phone', title: 'Desktop + mobile', detail: 'Always-on sessions, pick up anywhere.' },
];

export function WelcomePanel({ go }: PanelProps) {
  const [tab, setTab] = useState<WelcomeTab>('together');
  const [hovered, setHovered] = useState<WelcomeTab | null>(null);
  return (
    <>
      <Eyebrow x={46} y={114}>
        Welcome to Ghostex
      </Eyebrow>
      <Heading x={46} y={139} w={700} l1='Your coding agents.' l2='One serious workspace.' />
      <Sub x={46} y={264} w={640}>
        Use your own subscriptions or API keys with 20+ supported agents, Ghostex is the workspace around them.
      </Sub>
      <div className='glass tabcard' style={box(46, 348, 676, 312)} role='tablist' aria-label='What Ghostex can do'>
        {TABS.map((item) => (
          <button
            key={item.id}
            type='button'
            role='tab'
            aria-selected={tab === item.id}
            className={'tabrow' + (hovered === item.id ? ' hl' : '') + (tab === item.id ? ' sel' : '')}
            onClick={() => setTab(item.id)}
            onPointerEnter={() => setHovered(item.id)}
            onPointerLeave={() => setHovered(null)}
          >
            <span className='ibox lg'>
              <Icon n={item.icon} size={20} />
            </span>
            <span className='tabrow-t'>
              <span className='nm lg'>{item.title}</span>
              <span className='ss'>{item.detail}</span>
            </span>
            <Icon n='chevR' size={16} className='tabrow-c' />
          </button>
        ))}
      </div>
      {/* CDXC:Onboarding 2026-09-15 DECISION: User: "remove the I already know ghostex button"; Next is the only action. */}
      <FootActions panel={1}>
        <Cta filled onClick={() => go(2)}>
          Next
        </Cta>
      </FootActions>
      {tab === 'together' && <AgentsTogetherDemo key='together' />}
      {tab === 'chat' && <ChatTerminalDemo key='chat' />}
      {tab === 'mobile' && <DesktopMobileDemo key='mobile' />}
    </>
  );
}
