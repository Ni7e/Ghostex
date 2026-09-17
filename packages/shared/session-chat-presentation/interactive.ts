import type { SessionChatInteractivePrompt } from '../session-chat';

export type QuestionDraft = { indices: number[]; other: string };

export function sessionChatCardDismissKey(prompt: SessionChatInteractivePrompt | null): string | null {
  if (!prompt) return null;
  return prompt.kind === 'question'
    ? `question:${prompt.questions.length}:${prompt.questions[0]?.question ?? ''}`
    : `approval:${prompt.tool}:${prompt.summary ?? ''}`;
}

export function selectQuestionOption(drafts: QuestionDraft[], questionIndex: number, multiSelect: boolean, optionIndex: number): QuestionDraft[] {
  return drafts.map((entry, index) => {
    if (index !== questionIndex) return entry;
    if (!multiSelect) return { ...entry, indices: [optionIndex] };
    return { ...entry, indices: entry.indices.includes(optionIndex) ? entry.indices.filter((value) => value !== optionIndex) : [...entry.indices, optionIndex].sort((a, b) => a - b) };
  });
}
