import { IconInfoCircle, IconPlugConnected } from '@tabler/icons-react';
import type { CSSProperties } from 'react';
import { getSidebarAgentIconById } from '@/packages/shared/sidebar-agents';
import { AGENT_HOOK_BENEFITS } from './agent-hook-benefits';
import { AGENT_LOGO_COLORS, getBrandAgentLogoStyle } from './agent-logos';
import {
  AppModalButton,
  AppModalColumn,
  AppModalDescription,
  AppModalFooter,
  AppModalHeader,
  AppModalShell,
  AppModalTitle,
} from './app-modal-shell';

/** Brand colors that are just "white": those logos take the modal foreground so they invert with the theme. */
const NEUTRAL_LOGO_COLORS = new Set(['#ffffff', '#edecec']);

export type AgentHooksRequiredModalProps = {
  agentName: string;
  /** Default sidebar agent id whose hooks are missing; picks the logo and brand tint. */
  hookAgentId?: string;
  isOpen: boolean;
  onClose: () => void;
  onInstall: () => void;
  onSkip: () => void;
};

/**
 * CDXC:AgentHooks 2026-09-15 DECISION:
 * User: the missing-hooks prompt is a friendly, short invitation that shows the agent's logo, not a technical notice.
 * The agent's brand color tints the hero tile and benefit icons; copy names the agent and stays to one sentence per idea.
 */
export function AgentHooksRequiredModal({
  agentName,
  hookAgentId,
  isOpen,
  onClose,
  onInstall,
  onSkip,
}: AgentHooksRequiredModalProps) {
  const icon = getSidebarAgentIconById(hookAgentId);
  const brandColor = icon && !NEUTRAL_LOGO_COLORS.has(AGENT_LOGO_COLORS[icon]) ? AGENT_LOGO_COLORS[icon] : undefined;
  const brandStyle = brandColor ? ({ '--agent-hooks-brand': brandColor } as CSSProperties) : undefined;

  return (
    <AppModalShell className='agent-hooks-required-modal' isOpen={isOpen} onClose={onClose} style={brandStyle}>
      <AppModalColumn>
        <AppModalHeader className='agent-hooks-required-header'>
          <span aria-hidden='true' className='agent-hooks-required-logo-tile'>
            {icon ? (
              <span className='agent-hooks-required-logo' style={getBrandAgentLogoStyle(icon)} />
            ) : (
              <IconPlugConnected size={30} stroke={1.6} />
            )}
          </span>
          <AppModalTitle>Connect Ghostex to {agentName}</AppModalTitle>
          <AppModalDescription>
            A small helper called a hook lets Ghostex follow what {agentName} is doing. It installs in seconds. Just
            approve it when {agentName} asks.
          </AppModalDescription>
        </AppModalHeader>
        <ul className='agent-hooks-required-benefits'>
          {AGENT_HOOK_BENEFITS.map((benefit) => {
            const BenefitIcon = benefit.icon;
            return (
              <li className='agent-hooks-required-benefit' key={benefit.title}>
                <span aria-hidden='true' className='agent-hooks-required-benefit-icon'>
                  <BenefitIcon size={16} stroke={1.75} />
                </span>
                <span className='agent-hooks-required-benefit-text'>
                  <strong>{benefit.title}</strong>
                  <span>{benefit.text}</span>
                </span>
              </li>
            );
          })}
        </ul>
        <p className='agent-hooks-required-note'>
          <IconInfoCircle aria-hidden='true' size={14} stroke={1.75} />
          <span>You can skip for now. These features stay off for {agentName} until its hooks are installed.</span>
        </p>
        <AppModalFooter>
          <AppModalButton onClick={onSkip} type='button'>
            Not now
          </AppModalButton>
          <AppModalButton onClick={onInstall} tone='primary' type='button'>
            Install hooks
          </AppModalButton>
        </AppModalFooter>
      </AppModalColumn>
    </AppModalShell>
  );
}
