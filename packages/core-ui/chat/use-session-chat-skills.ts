import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { computeSessionChatSkills } from '@/packages/shared/session-chat-controller/skills';
import type { SessionChatTransport } from './session-chat-transport';

const lifecycle = { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState };

export function useSessionChatSkills(transport: SessionChatTransport, agentId: string | null) {
  return computeSessionChatSkills(transport, agentId, lifecycle);
}
