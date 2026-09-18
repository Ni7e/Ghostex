export const MARKDOWN_PREVIEW = [
  '## Inline code',
  'Text before `inlineCode()` and text after.',
  '**Bold text**, *emphasis*, and `const answer = 42` in the same paragraph.',
  'A long identifier should wrap without clipping: `aVeryLongIdentifierThatMustRemainReadableAndSelectableEvenInsideANarrowConversationPane`.',
  'Unicode stays intact: `café_東京_🙂`.',
  'This line includes `first()` and ends with a hard break.  \nThis is the next line with `second()`.',
  'Select across ordinary text and inline code, then copy. The clipboard should contain the visible words in order.',
].join('\n\n');
