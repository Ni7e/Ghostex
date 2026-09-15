import { type ManageAnnotation } from './types';
import {
  findManageAnnotationTextMatches,
  isManageAnnotationActive,
  isManageAnnotationPending,
  quickLabelText,
} from './annotation-store';

/** How much of the annotated text the feedback quotes inline; the line span anchors the rest. */
const FEEDBACK_QUOTE_MAX_LENGTH = 160;

export type ManageAnnotationFeedbackScope = 'all' | 'pending';

export type ManageAnnotationFeedbackDocument = {
  annotations: readonly ManageAnnotation[];
  /** Markdown source used to place annotations in document order and to number their lines. */
  content?: string;
  /** The file as the Docs tree names it, or a review document's title. */
  name: string;
};

export type ManageAnnotationFeedback = {
  /** Ids of every annotation the text covers, by document name. */
  annotationIdsByDocument: Map<string, string[]>;
  count: number;
  /** Documents that contributed at least one annotation. */
  documentCount: number;
  text: string;
};

/**
 * CDXC:Docs 2026-09-15 DECISION:
 * User: format feedback the way Herdr Annotate and plannotator-tui do, one numbered section per annotation in document order with the line span, a short quote, and the note as a blockquote, instead of the old bullets that grouped every redline before every comment and pasted the whole selection.
 * Deleted text stays complete inside a fence so the agent knows exactly what to remove; everything else quotes at most the first 160 characters because the line number does the anchoring.
 * SEE-ALSO: apps/desktop/src/app/docs_annotation_feedback.rs (delivery), skills/ghostex-help/references/features.md (the Docs paragraph).
 */
export function formatManageAnnotationFeedback(
  documents: readonly ManageAnnotationFeedbackDocument[],
  scope: ManageAnnotationFeedbackScope
): ManageAnnotationFeedback {
  const sections: string[] = [];
  const annotationIdsByDocument = new Map<string, string[]>();
  let count = 0;
  for (const document of documents) {
    const included = document.annotations.filter(
      (annotation) => isManageAnnotationActive(annotation) && (scope === 'all' || isManageAnnotationPending(annotation))
    );
    if (included.length === 0) {
      continue;
    }
    const placed = placeAnnotations(included, document.content ?? '');
    const lines: string[] = [`# Annotations on ${document.name}`, ''];
    placed.forEach((entry, index) => {
      lines.push(...formatAnnotationSection(entry, index + 1), '');
    });
    sections.push(lines.join('\n').trimEnd());
    annotationIdsByDocument.set(
      document.name,
      placed.map((entry) => entry.annotation.id)
    );
    count += placed.length;
  }
  return {
    annotationIdsByDocument,
    count,
    documentCount: sections.length,
    text: sections.length === 0 ? 'No annotations.\n' : `${sections.join('\n\n')}\n`,
  };
}

type PlacedAnnotation = {
  annotation: ManageAnnotation;
  /** 1-based first and last source line of the quoted range; absent for global notes and quotes no longer in the text. */
  lines?: [number, number];
  /** Sort key: byte offset of the quote, global notes after everything placed. */
  order: number;
};

function placeAnnotations(annotations: readonly ManageAnnotation[], content: string): PlacedAnnotation[] {
  const placed = annotations.map((annotation, index): PlacedAnnotation => {
    if (annotation.scope !== 'selection' || !content) {
      return { annotation, order: Number.MAX_SAFE_INTEGER - annotations.length + index };
    }
    const match = findManageAnnotationTextMatches(content, annotation.quote)[0];
    if (!match) {
      return { annotation, order: Number.MAX_SAFE_INTEGER - annotations.length + index };
    }
    return {
      annotation,
      lines: [lineNumberAt(content, match.from), lineNumberAt(content, Math.max(match.from, match.to - 1))],
      order: match.from,
    };
  });
  return placed.sort((left, right) => left.order - right.order);
}

function lineNumberAt(content: string, offset: number): number {
  let line = 1;
  const end = Math.min(offset, content.length);
  for (let index = 0; index < end; index += 1) {
    if (content.charCodeAt(index) === 10) {
      line += 1;
    }
  }
  return line;
}

function formatAnnotationSection(entry: PlacedAnnotation, number: number): string[] {
  const { annotation, lines: span } = entry;
  const lineLabel = span ? (span[0] === span[1] ? ` (line ${span[0]})` : ` (lines ${span[0]}–${span[1]})`) : '';
  const lines: string[] = [`## Annotation ${number}${lineLabel}`];
  const note = annotation.note.trim();
  if (annotation.type === 'redline') {
    lines.push('Remove this:', ...fenced(annotation.quote), `> ${blockquote(note || "I don't want this.")}`);
  } else if (annotation.scope === 'global') {
    lines.push('General comment:', `> ${blockquote(note || defaultLabelNote(annotation))}`);
  } else {
    lines.push(`${labelHeading(annotation)}: "${shortQuote(annotation.quote)}"`);
    const body =
      note || (annotation.labelId && annotation.labelId !== 'looks-good' ? defaultLabelNote(annotation) : '');
    if (body) {
      lines.push(`> ${blockquote(body)}`);
    }
  }
  for (const attachment of annotation.attachments) {
    lines.push(`- Attachment ${attachment.name}: ${attachment.dataUrl}`);
  }
  return lines;
}

function labelHeading(annotation: ManageAnnotation): string {
  switch (annotation.labelId) {
    case 'looks-good':
      return 'Looks good';
    case 'clarify':
      return 'Clarify';
    case 'needs-tests':
      return 'Needs tests';
    default:
      return 'Comment on';
  }
}

function defaultLabelNote(annotation: ManageAnnotation): string {
  switch (annotation.labelId) {
    case 'clarify':
      return 'Please clarify this.';
    case 'needs-tests':
      return 'This needs tests.';
    case 'looks-good':
      return quickLabelText('looks-good');
    default:
      return '(see attachment)';
  }
}

function shortQuote(quote: string): string {
  const single = quote.replace(/\s+/g, ' ').trim();
  return single.length > FEEDBACK_QUOTE_MAX_LENGTH
    ? `${single.slice(0, FEEDBACK_QUOTE_MAX_LENGTH - 1).trimEnd()}…`
    : single;
}

function blockquote(text: string): string {
  return text.replace(/\r?\n/g, '\n> ');
}

/** A fence longer than any backtick run inside the text, so quoted markdown cannot escape. */
function fenced(text: string): string[] {
  const longest = Math.max(0, ...text.split(/[^`]+/).map((run) => run.length));
  const fence = '`'.repeat(Math.max(2, longest) + 1);
  return [fence, text, fence];
}
