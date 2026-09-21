import { findCustomSessionTag } from '@/packages/shared/session-tags';
import { getSessionTagCatalogs } from '@/packages/core-ui/session-tag-catalogs';

const builtins: Record<string, { icon: string; iconColor: string }> = {
  favorite: { icon: 'star-filled', iconColor: '#f3cd5f' },
  'high-priority': { icon: 'alert-triangle', iconColor: '#ff8b6b' },
  'low-priority': { icon: 'arrow-down', iconColor: '#8e949d' },
  research: { icon: 'microscope', iconColor: '#8fb8ff' },
  todo: { icon: 'checkbox', iconColor: '#d9dee6' },
  'in-progress': { icon: 'player-play', iconColor: '#4ee6b8' },
  testing: { icon: 'test-pipe', iconColor: '#59d9ff' },
  blocked: { icon: 'barrier-block', iconColor: '#ff5f73' },
  'on-hold': { icon: 'player-pause', iconColor: '#d2a7ff' },
  done: { icon: 'circle-check', iconColor: '#95d7f6' },
  bug: { icon: 'bug', iconColor: '#a54646' },
  feature: { icon: 'puzzle', iconColor: '#f0c66e' },
  design: { icon: 'palette', iconColor: '#ff9ee7' },
  untagged: { icon: 'tag-off', iconColor: '#acb6c0' },
};

export function nativeTagPresentation(tag: string) {
  const custom = findCustomSessionTag(tag, getSessionTagCatalogs());
  return custom ? { icon: custom.icon, iconColor: custom.color } : builtins[tag];
}
