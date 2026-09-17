import { useEffect, useRef, useState } from 'react';
import type { AccountSwitchProgress } from '@/packages/shared/agent-accounts';
import { computeAccountSwitchStatus } from '@/packages/shared/session-chat-controller/account-switch';

export function useAccountSwitchStatus(
  progress: AccountSwitchProgress | null,
  sessionKey: string | undefined,
  ready = true
) {
  return computeAccountSwitchStatus(progress, sessionKey, ready, { useState, useRef, useEffect });
}
