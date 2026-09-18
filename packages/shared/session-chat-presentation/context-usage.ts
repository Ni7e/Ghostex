import type { SessionChatContextUsage } from '../session-chat';

export interface SessionChatContextMeterUsage {
  /** 0–100, or null while the agent has not reported context usage. */
  usedPercentage: number | null;
  usedTokens: number | null;
  windowSize: number | null;
}

/**
 * Claude uses tokens over window size; Codex uses its baseline-adjusted reported percentage.
 * Null means the agent has not reported enough data to draw usage.
 */
export function resolveSessionChatContextMeterUsage(
  usage: SessionChatContextUsage | undefined,
  preferReportedPercentage = false
): SessionChatContextMeterUsage | null {
  if (!usage) {
    return null;
  }
  const usedTokens = isFiniteNonNegative(usage.usedTokens) ? usage.usedTokens : null;
  const windowSize = isFiniteNonNegative(usage.windowSize) && usage.windowSize > 0 ? usage.windowSize : null;
  const usedPercentage =
    preferReportedPercentage && isFiniteNonNegative(usage.usedPercentage)
      ? Math.min(100, usage.usedPercentage)
      : usedTokens !== null && windowSize !== null
        ? Math.min(100, (usedTokens / windowSize) * 100)
        : isFiniteNonNegative(usage.usedPercentage)
          ? Math.min(100, usage.usedPercentage)
          : null;
  if (usedPercentage === null && usedTokens === null) {
    return null;
  }
  return { usedPercentage, usedTokens, windowSize };
}

function isFiniteNonNegative(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function formatSessionChatContextTokens(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return '0';
  }
  if (value < 1_000) {
    return `${Math.round(value)}`;
  }
  if (value < 10_000) {
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  }
  if (value < 1_000_000) {
    return `${Math.round(value / 1_000)}k`;
  }
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
}

export function formatSessionChatContextPercentage(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  if (value < 10) {
    return `${value.toFixed(1).replace(/\.0$/, '')}%`;
  }
  return `${Math.round(value)}%`;
}
