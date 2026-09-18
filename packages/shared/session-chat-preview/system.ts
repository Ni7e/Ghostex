import {
  previewCall,
  previewResult,
  previewRow,
  previewStamp,
  previewTextRow,
  type PreviewScenarioSnapshot,
} from './message';

const TASK_NOTIFICATION = (status: string, summary: string, id: string): string =>
  [
    '<task-notification>',
    `<task-id>${id}</task-id>`,
    '<tool-use-id>toolu_01H9ZC4</tool-use-id>',
    `<status>${status}</status>`,
    `<summary>${summary}</summary>`,
    `<output-file>/sample/project/.ghostex/tasks/${id}.log</output-file>`,
    '</task-notification>',
  ].join('\n');

const INTER_AGENT_MESSAGE = [
  'Message from another agent',
  'Agent: windows-support',
  'Session: Fix the ConPTY resize path',
  'Session ID: sess_9f21c4',
  'Agent ID: claude',
  'Agent Session ID: 0f2b-5d19',
  'Reply to: ghostex agents send windows-support "your reply"',
  '',
  'The resize path is fixed on the Windows side. Your visibility OSC change lands cleanly on top of it, so go ahead and merge.',
].join('\n');

const AGENT_MESSAGE = [
  'Message from /root/explorer',
  '',
  'I read every caller of the fold and none of them depends on the collapsed list alone.',
  '',
  'Two of them do read the raw list for byte offsets, so keep passing both.',
].join('\n');

const STATUS_OUTPUT = [
  'Model: gpt-5 (high)',
  'Tokens: 63.9K used of 272K',
  'Session: /sample/project · main',
  'Sandbox: workspace-write',
].join('\n');

/**
 * The rows a session produces that are neither the reader's prompt nor the
 * agent's reply: completed-action pills, notifications, the app's own command
 * rows, a fork seam, messages from other agents, and an answered question.
 * Nothing here settles a turn, so every row stays visible instead of folding
 * behind a "Worked for" summary.
 */
export function systemPreviewScenario(): PreviewScenarioSnapshot {
  return {
    forkInfo: { forkedFromId: 'rollout-2026-09-16-a', ancestorIds: ['rollout-2026-09-16-a'] },
    appCommands: [
      {
        id: 'goal-1',
        command: '/goal',
        sentAt: previewStamp(120),
        output: 'Goal: active\nShip the shared transcript rules to both renderers.\nTime: 2m · Tokens: 63.9K/50K',
        goal: {
          status: 'active',
          objective: 'Ship the shared transcript rules to both renderers.',
          usage: 'Time: 2m · Tokens: 63.9K/50K',
        },
      },
      {
        id: 'status-1',
        command: '/status',
        sentAt: previewStamp(126),
        output: STATUS_OUTPUT,
      },
      {
        id: 'rename-1',
        command: '/rename Shared transcript rules',
        title: 'Shared transcript rules',
        sentAt: previewStamp(132),
      },
      { id: 'compact-1', command: '/compact', sentAt: previewStamp(138) },
    ],
    messages: [
      previewTextRow(
        'fork-boundary:sess_9f21c4',
        'system',
        0,
        'Session forked from an earlier thread. Messages above this point are shared with sibling branches.',
        { byteOffset: 0 }
      ),
      previewTextRow(
        'system-2',
        'user',
        4,
        'Take over from the other branch: finish the shared transcript rules and tell me when the checks are clean.'
      ),
      previewTextRow('system-3', 'system', 20, 'Context compacted'),
      previewTextRow(
        'system-4',
        'user',
        26,
        '<local-command-stdout>Set model to Opus 5 and saved as your default for new sessions.</local-command-stdout>'
      ),
      previewTextRow(
        'system-5',
        'user',
        32,
        TASK_NOTIFICATION('completed', 'Ran the release preflight and every gate passed (exit code 0)', 'bg_31')
      ),
      previewTextRow(
        'system-6',
        'user',
        38,
        TASK_NOTIFICATION(
          'failed',
          'Rebuilt the desktop app and the link step could not find sccache (exit code 101)',
          'bg_32'
        )
      ),
      previewRow('system-7', 'tool', 46, [
        previewCall('AskUserQuestion', {
          questions: [
            {
              question: 'Which renderer should I finish first?',
              header: 'Order of work',
              multiSelect: false,
              options: [
                { label: 'React', description: 'The reference implementation both panes are compared against.' },
                { label: 'GPUI', description: 'The native renderer that is still catching up.' },
                { label: 'Both together', description: 'Slower, but the two never drift apart.' },
              ],
            },
            {
              question: 'Should the fork seam keep its own row?',
              header: 'Fork seam',
              multiSelect: false,
              options: [
                { label: 'Keep it', description: 'A labelled rule where the thread changes.' },
                { label: 'Drop it', description: 'One continuous transcript.' },
              ],
            },
          ],
        }),
        previewResult(
          'The user answered: "Which renderer should I finish first?"="React", "Should the fork seam keep its own row?"="Keep it, and label it with the branch name". Read the answers carefully and continue.'
        ),
      ]),
      previewTextRow('system-8', 'system', 60, AGENT_MESSAGE),
      previewTextRow('system-9', 'user', 72, INTER_AGENT_MESSAGE),
    ],
  };
}
