/**
 * Writes the answered-question-exchange gate's expected output to
 * `/tmp/gx-chat/expected/question-exchange.json`.
 *
 * Usage: `bun tooling/gx-chat-core/question-exchange-cases.ts`
 *
 * `packages/shared/session-chat-presentation/questions.ts` reads an asking tool's own input and
 * result back into the card the transcript draws. Four agents frame that result four different
 * ways and none of them echo a structured record, so the file is 550 lines of envelope peeling
 * that no recording reaches: the shared synthetic recording has no answered question tool call in
 * it, and the exchange never appears in the document under a key family c owns (family b draws
 * it). This writes one file of cases, answered by the shipped TypeScript, for
 * `cargo run --example question_exchange_check` to compare the Rust port against.
 *
 * The cases are invented, so the file holds no user data and can be regenerated anywhere.
 */
import { mkdirSync, writeFileSync } from 'node:fs';

import { answeredSessionChatQuestionExchange } from '@/packages/shared/session-chat-presentation/questions';
import { EXPECTED_ROOT } from './recording';

interface Case {
  /** A short name for the report. */
  name: string;
  tool: string;
  input: unknown;
  output: string;
  isError?: boolean;
}

const CLAUDE_QUESTIONS = {
  questions: [
    {
      question: 'Which renderer owns the layout?',
      header: 'Layout',
      multiSelect: false,
      options: [{ label: 'Native' }, { label: 'React' }, { label: 'Native and React' }],
    },
    { question: 'Anything else?', multiSelect: false, options: [{ label: 'No' }] },
  ],
};

const OMP_QUESTIONS = {
  questions: [
    { id: 'q1', question: 'Pick the renderers.', multi: true, options: ['Native', 'React', 'Web'] },
    { id: 'q2', question: 'Name the surface.', options: [] },
    { id: 'q3', question: 'Anything to skip?', options: ['Yes', 'No'] },
  ],
};

const HERMES_QUESTIONS = {
  questions: [
    { question: 'Which pane?', multi_select: true, choices: ['Left', 'Right', 'Both', 'Neither', 'Dropped'] },
    { question: 'Confirm?', choices: ['Yes', 'No'] },
  ],
};

const CASES: Case[] = [
  {
    name: 'claude: both questions answered',
    tool: 'AskUserQuestion',
    input: CLAUDE_QUESTIONS,
    output:
      'The user answered: "Which renderer owns the layout?"="Native and React", "Anything else?"="No, and keep the drafts". Read the answers carefully and continue.',
  },
  {
    name: 'claude: second question skipped',
    tool: 'AskUserQuestion',
    input: CLAUDE_QUESTIONS,
    output: 'Your questions have been answered: "Which renderer owns the layout?"="React". You can now continue.',
  },
  {
    name: 'claude: dismissed',
    tool: 'AskUserQuestion',
    input: CLAUDE_QUESTIONS,
    output: 'The user answered: "Which renderer owns the layout?"="[User dismissed the question]"',
  },
  {
    name: 'claude: multi-select labels joined',
    tool: 'AskUserQuestion',
    input: {
      questions: [
        {
          question: 'Which renderers?',
          multiSelect: true,
          options: [{ label: 'Native' }, { label: 'React' }, { label: 'Native and React' }],
        },
      ],
    },
    output: 'The user answered: "Which renderers?"="Native, React, and the web build too"',
  },
  {
    name: 'claude: unparseable result falls back',
    tool: 'AskUserQuestion',
    input: CLAUDE_QUESTIONS,
    output: 'Something the parser has never seen.',
  },
  {
    name: 'claude: an error result is not an exchange',
    tool: 'AskUserQuestion',
    input: CLAUDE_QUESTIONS,
    output: 'The user answered: "Anything else?"="No"',
    isError: true,
  },
  {
    name: 'not an asking tool',
    tool: 'Bash',
    input: CLAUDE_QUESTIONS,
    output: 'The user answered: "Anything else?"="No"',
  },
  {
    name: 'pi: single answer',
    tool: 'cursor_ask_question',
    input: {
      question: 'Keep the cooldown?',
      choices: [{ label: 'Keep', value: 'keep' }, { value: 'drop' }],
      allowCustom: true,
    },
    output: 'User answered: Keep',
  },
  {
    name: 'pi: custom answer',
    tool: 'cursor_ask_question',
    input: { prompt: 'Keep the cooldown?', options: ['Keep', 'Drop'] },
    output: 'User answered: Keep it, but shorten it',
  },
  {
    name: 'pi: cancelled',
    tool: 'cursor_ask_question',
    input: { question: 'Keep the cooldown?', options: ['Keep', 'Drop'] },
    output: 'User cancelled the question.',
  },
  {
    name: 'omp: single selection with a note',
    tool: 'ask',
    input: { questions: [{ id: 'q1', question: 'Pick one.', options: ['Native', 'React'] }] },
    output: 'User selected: Native\nUser added note: and check the collapsed layout',
  },
  {
    name: 'omp: multi-line custom input',
    tool: 'ask',
    input: { questions: [{ id: 'q1', question: 'Pick one.', options: ['Native', 'React'] }] },
    output: 'User provided custom input:\n  first line\n  second line\nUser added note: short',
  },
  {
    name: 'omp: cancelled selection',
    tool: 'ask',
    input: { questions: [{ id: 'q1', question: 'Pick one.', options: ['Native', 'React'] }] },
    output: 'User cancelled the selection',
  },
  {
    name: 'omp: no selection',
    tool: 'ask',
    input: { questions: [{ id: 'q1', question: 'Pick one.', options: ['Native', 'React'] }] },
    output: 'User did not select any options',
  },
  {
    name: 'omp: timeout suffix on a selection',
    tool: 'ask',
    input: { questions: [{ id: 'q1', question: 'Pick one.', options: ['Native', 'React'] }] },
    output: 'User selected: React (auto-selected after timeout)',
  },
  {
    name: 'omp: three questions by id',
    tool: 'ask',
    input: OMP_QUESTIONS,
    output:
      'User answers:\nq1: [Native, Web] (note: and the composer)\nq2: "the question card" (auto-selected after timeout)\nq3: (cancelled)',
  },
  {
    name: 'omp: a question whose id never appears',
    tool: 'ask',
    input: OMP_QUESTIONS,
    output: 'User answers:\nq1: Native\nq3: No',
  },
  {
    name: 'hermes: a single clarify response',
    tool: 'clarify',
    input: { question: 'Which pane?', choices: ['Left', 'Right', 'Both'], multi_select: true },
    output: '{"question":"Which pane?","choices_offered":["Left","Right","Both"],"user_response":["Right","Both"]}',
  },
  {
    name: 'hermes: a batch with a skip and a timeout',
    tool: 'clarify',
    input: HERMES_QUESTIONS,
    output: '{"responses":[{"user_response":["Left","Dropped"]},{"user_response":""}],"timed_out":true}',
  },
  {
    name: 'hermes: bare-string batch entries',
    tool: 'clarify',
    input: { questions: ['Which pane?', 'Confirm?'] },
    output: '{"responses":[{"user_response":"Left"},{"user_response":"Yes"}]}',
  },
  {
    name: 'hermes: choices capped at four',
    tool: 'clarify',
    input: { question: 'Which pane?', choices: ['A', 'B', 'C', 'D', 'E'] },
    output: '{"user_response":"C"}',
  },
  {
    name: 'hermes: broken JSON falls back',
    tool: 'clarify',
    input: { question: 'Which pane?', choices: ['A', 'B'] },
    output: '{"user_response":',
  },
  {
    name: 'omp-style flat input with a recommended row',
    tool: 'ask',
    input: { question: 'Pick one.', options: [{ label: 'Native', description: 'GPUI' }, 'React'], recommended: 1 },
    output: 'User selected: React',
  },
  {
    name: 'input that parses to nothing',
    tool: 'ask',
    input: { questions: [{}, 3, null] },
    output: 'User selected: Native',
  },
  {
    name: 'empty result is not an exchange',
    tool: 'ask',
    input: { questions: [{ id: 'q1', question: 'Pick one.', options: ['Native'] }] },
    output: '   ',
  },
];

const rows = CASES.map((entry) => ({
  name: entry.name,
  tool: entry.tool,
  input: entry.input,
  output: entry.output,
  isError: entry.isError === true,
  exchange: answeredSessionChatQuestionExchange({
    call: { type: 'tool-call', name: entry.tool, input: entry.input },
    result: entry.isError
      ? { type: 'tool-result', output: entry.output, isError: true }
      : { type: 'tool-result', output: entry.output },
  }),
}));

mkdirSync(EXPECTED_ROOT, { recursive: true, mode: 0o700 });
const path = `${EXPECTED_ROOT}/question-exchange.json`;
writeFileSync(path, `${JSON.stringify(rows, null, 2)}\n`, { mode: 0o600 });
console.log(`cases       ${rows.length}`);
console.log(
  `exchanges   ${rows.filter((row) => row.exchange !== null).length} parsed, ${rows.filter((row) => row.exchange === null).length} refused`
);
console.log(`expected    ${path}`);
