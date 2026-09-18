import { previewCall, previewResult, previewRow, previewTextRow, type PreviewScenarioSnapshot } from './message';

/**
 * The sub-agent strip and the task list, both populated, over a live turn that
 * explains why they are there. Their clocks interpolate from `detectedAt`, so
 * this scenario stamps the roster when the sample is built rather than at the
 * fixed preview start; otherwise every child would open with months on its
 * clock.
 */
export function agentsPreviewScenario(): PreviewScenarioSnapshot {
  const detectedAt = new Date().toISOString();
  return {
    working: true,
    agent: 'claude',
    sessionAgentId: 'claude',
    agentFleet: {
      detectedAt,
      validUntil: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      agents: [
        {
          id: 'agent_7f31',
          status: 'working',
          name: 'general-purpose',
          model: 'claude-opus-5',
          effort: 'high',
          task: 'Auditing every caller of the turn-boundary fold',
          elapsedSeconds: 756,
          tokens: '↓ 155.4k tokens',
        },
        {
          id: 'agent_7f32',
          status: 'working',
          name: 'general-purpose',
          model: 'claude-opus-5',
          effort: 'high',
          nested: 1,
          task: 'Splitting the option-menu geometry module',
          elapsedSeconds: 195,
          tokens: '↓ 76.0k tokens',
        },
        {
          id: 'agent_7f33',
          status: 'idle',
          name: 'explore',
          model: 'claude-sonnet-4-6',
          effort: 'medium',
          task: 'Reading the native transcript renderer',
          elapsedSeconds: 12,
          tokens: '↑ 4.6k tokens',
        },
      ],
    },
    agentTasks: {
      tasks: [
        {
          id: '1',
          subject: 'Share the turn-boundary rules with both renderers',
          activeForm: 'Sharing the turn-boundary rules',
          status: 'completed',
        },
        {
          id: '2',
          subject: 'Fold completed work behind one "Worked for" row in GPUI',
          activeForm: 'Folding completed work in GPUI',
          status: 'in_progress',
        },
        {
          id: '3',
          subject: 'Render file change cards natively',
          activeForm: 'Rendering file change cards natively',
          status: 'pending',
          blockedBy: ['2'],
        },
        {
          id: '4',
          subject: 'Compare both panes at 70%, 100% and 200% zoom',
          activeForm: 'Comparing both panes at every zoom step',
          status: 'pending',
          blockedBy: ['2', '3'],
        },
      ],
    },
    messages: [
      previewTextRow(
        'agents-1',
        'user',
        0,
        'Split the remaining renderer work across sub-agents and keep a task list I can read while they run.'
      ),
      previewTextRow(
        'agents-2',
        'reasoning',
        4,
        'Three pieces of work, and two of them can run at the same time. I will open the task list first so the plan is visible, then launch the children.'
      ),
      previewRow('agents-3', 'tool', 8, [
        previewCall('TaskCreate', {
          subject: 'Fold completed work behind one "Worked for" row in GPUI',
          activeForm: 'Folding completed work in GPUI',
        }),
        previewResult('Created task 2.'),
        previewCall('Task', {
          subagent_type: 'general-purpose',
          description: 'Audit turn boundary callers',
          prompt: 'Audit every caller of the turn-boundary fold and report which ones need the raw message list.',
        }),
        previewResult('{"agent_id":"agent_7f31","agent_nickname":"turn-auditor"}'),
        previewCall('Task', {
          subagent_type: 'general-purpose',
          description: 'Split the option menu geometry module',
          prompt: 'Split option_menu/geometry.rs into per-concern siblings, moving bodies byte-identically.',
        }),
        previewResult('{"agent_id":"agent_7f32","agent_nickname":"geometry-splitter"}'),
      ]),
      previewTextRow(
        'agents-4',
        'assistant',
        14,
        'Two children are running and a third is reading the native renderer. The task list above the composer tracks what is left; the strip shows what each child is doing right now.'
      ),
    ],
  };
}
