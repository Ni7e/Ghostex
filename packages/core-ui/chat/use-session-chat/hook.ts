import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { computeSessionChat } from '@/packages/shared/session-chat-controller/controller';
import { sessionChatDraftClientId } from '../session-chat-queue';
import { recordDeliveredSessionChatDrafts } from '../session-chat-sent-history';
import type { UseSessionChatOptions, UseSessionChatResult } from './state';

const lifecycle = { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState };

export function useSessionChat(options: UseSessionChatOptions): UseSessionChatResult {
  const clientId = useMemo(() => sessionChatDraftClientId(), []);
  return computeSessionChat({ ...options, clientId, onDeliveredDrafts: recordDeliveredSessionChatDrafts }, lifecycle);
}
