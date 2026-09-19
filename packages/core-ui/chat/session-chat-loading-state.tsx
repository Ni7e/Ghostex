import type { CSSProperties } from 'react';
import { Button } from '@/packages/components/ui/button';
import type { SessionChatLoadingStage } from '@/packages/shared/session-chat-presentation/new-session-welcome';
import skeleton from '@/packages/shared/session-chat-presentation/transcript-skeleton.json';

const rem = (px: number) => `${px / 16}rem`;

/**
 * CDXC:SessionChat 2026-09-19 DECISION:
 * User: while an old chat's transcript is loading, show a skeleton in the transcript area so it looks nice while we wait, in both GPUI and React chat.
 * The skeleton replaces the "Loading conversation…" line and, since the same-day decision in new-session-welcome.ts, appears at once; the Retry stage keeps its timing.
 * SEE-ALSO: packages/shared/session-chat-presentation/transcript-skeleton.json, apps/desktop/src/app/native_chat/transcript_skeleton.rs.
 */
export function SessionChatLoadingState({ stage, onRetry }: { stage: SessionChatLoadingStage; onRetry: () => void }) {
  return (
    <div
      aria-busy='true'
      aria-label='Conversation messages'
      className='flex min-h-0 flex-1 flex-col overflow-hidden'
      style={{ paddingBottom: 'var(--ghostex-chat-composer-inset, 0px)' }}
    >
      {stage === 'blank' ? null : (
        <div
          className='ghostex-chat-transcript-skeleton mx-auto flex w-full max-w-3xl flex-col px-4'
          role='status'
          style={
            {
              gap: rem(skeleton.rowGap),
              paddingTop: rem(skeleton.topPadding),
              '--ghostex-chat-skeleton-tint': `${skeleton.tint * 100}%`,
              '--ghostex-chat-skeleton-pulse-min': skeleton.pulseMinOpacity,
              '--ghostex-chat-skeleton-pulse-ms': `${skeleton.pulseMs}ms`,
            } as CSSProperties
          }
        >
          <span className='sr-only'>Loading conversation…</span>
          {stage === 'retry' ? (
            <div className='flex items-center justify-center gap-3 text-muted-foreground text-sm'>
              <span>Still loading this conversation.</span>
              <Button onClick={onRetry} size='sm' variant='outline'>
                Retry
              </Button>
            </div>
          ) : null}
          <div
            aria-hidden='true'
            className='ghostex-chat-transcript-skeleton-rows flex flex-col'
            style={{ gap: rem(skeleton.rowGap) }}
          >
            {skeleton.rows.map((row, index) =>
              row.role === 'user' ? (
                <div className='flex justify-end' key={index}>
                  <div
                    className='ghostex-chat-transcript-skeleton-block'
                    style={{
                      borderRadius: rem(skeleton.bubbleRadius),
                      height: rem(skeleton.bubbleHeight),
                      width: `${(row.widths[0] ?? 0.4) * 100}%`,
                    }}
                  />
                </div>
              ) : (
                <div className='flex flex-col' key={index} style={{ gap: rem(skeleton.barGap) }}>
                  {row.widths.map((width, bar) => (
                    <div
                      className='ghostex-chat-transcript-skeleton-block rounded-full'
                      key={bar}
                      style={{ height: rem(skeleton.barHeight), width: `${width * 100}%` }}
                    />
                  ))}
                </div>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
