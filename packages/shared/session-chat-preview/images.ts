import { previewRow, previewTextRow, type PreviewScenarioSnapshot } from './message';
import { PREVIEW_SCREENSHOT_BASE64 } from './images-screenshot';

/*
Pictures small enough to live in the fixture itself, so both panes can show a
real image without a file on disk or a network fetch. They are SVG because an
SVG of a mock screen is a few hundred bytes where a PNG of the same thing is
tens of kilobytes.
*/
const BEFORE_BASE64 =
  'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNjAiIGhlaWdodD0iMTAwIj48cmVjdCB3aWR0aD0iMTYwIiBoZWlnaHQ9IjEwMCIgcng9IjgiIGZpbGw9IiMxZDFkMWQiLz48cmVjdCB4PSIxMiIgeT0iMTQiIHdpZHRoPSIxMzYiIGhlaWdodD0iMTYiIHJ4PSI0IiBmaWxsPSIjMmYyZjJmIi8+PHJlY3QgeD0iMTIiIHk9IjQwIiB3aWR0aD0iOTYiIGhlaWdodD0iMTAiIHJ4PSIzIiBmaWxsPSIjM2EzYTNhIi8+PHJlY3QgeD0iMTIiIHk9IjU4IiB3aWR0aD0iMTIwIiBoZWlnaHQ9IjEwIiByeD0iMyIgZmlsbD0iIzNhM2EzYSIvPjxyZWN0IHg9IjEyIiB5PSI3NiIgd2lkdGg9IjcyIiBoZWlnaHQ9IjEwIiByeD0iMyIgZmlsbD0iIzNhM2EzYSIvPjwvc3ZnPg==';
const AFTER_BASE64 =
  'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNjAiIGhlaWdodD0iMTAwIj48cmVjdCB3aWR0aD0iMTYwIiBoZWlnaHQ9IjEwMCIgcng9IjgiIGZpbGw9IiMxMDFhMTQiLz48cmVjdCB4PSIxMiIgeT0iMTQiIHdpZHRoPSIxMzYiIGhlaWdodD0iMTYiIHJ4PSI0IiBmaWxsPSIjMWUzYTJhIi8+PHJlY3QgeD0iMTIiIHk9IjQwIiB3aWR0aD0iMTIwIiBoZWlnaHQ9IjEwIiByeD0iMyIgZmlsbD0iIzJjNWI0MSIvPjxyZWN0IHg9IjEyIiB5PSI1OCIgd2lkdGg9IjEzNiIgaGVpZ2h0PSIxMCIgcng9IjMiIGZpbGw9IiMyYzViNDEiLz48cmVjdCB4PSIxMiIgeT0iNzYiIHdpZHRoPSI4OCIgaGVpZ2h0PSIxMCIgcng9IjMiIGZpbGw9IiMyYzViNDEiLz48L3N2Zz4=';
const CHART_BASE64 =
  'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxODAiIGhlaWdodD0iMTEwIj48cmVjdCB3aWR0aD0iMTgwIiBoZWlnaHQ9IjExMCIgcng9IjgiIGZpbGw9IiMxNjE2MTYiLz48cmVjdCB4PSIxOCIgeT0iNjIiIHdpZHRoPSIyMCIgaGVpZ2h0PSIzMCIgZmlsbD0iIzRmOWNmOSIvPjxyZWN0IHg9IjQ4IiB5PSI0NCIgd2lkdGg9IjIwIiBoZWlnaHQ9IjQ4IiBmaWxsPSIjNGY5Y2Y5Ii8+PHJlY3QgeD0iNzgiIHk9IjI4IiB3aWR0aD0iMjAiIGhlaWdodD0iNjQiIGZpbGw9IiM3Y2M0YTQiLz48cmVjdCB4PSIxMDgiIHk9IjUyIiB3aWR0aD0iMjAiIGhlaWdodD0iNDAiIGZpbGw9IiM0ZjljZjkiLz48cmVjdCB4PSIxMzgiIHk9IjIwIiB3aWR0aD0iMjAiIGhlaWdodD0iNzIiIGZpbGw9IiM3Y2M0YTQiLz48L3N2Zz4=';
const PASTE_BASE64 =
  'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI5NiIgaGVpZ2h0PSI2NCI+PHJlY3Qgd2lkdGg9Ijk2IiBoZWlnaHQ9IjY0IiByeD0iMTAiIGZpbGw9IiMyYjIxMTgiLz48Y2lyY2xlIGN4PSIzMCIgY3k9IjMyIiByPSIxMiIgZmlsbD0iI2UwYTQ1OCIvPjxyZWN0IHg9IjUyIiB5PSIyNCIgd2lkdGg9IjMwIiBoZWlnaHQ9IjYiIHJ4PSIzIiBmaWxsPSIjOGE2YTNjIi8+PHJlY3QgeD0iNTIiIHk9IjM2IiB3aWR0aD0iMjAiIGhlaWdodD0iNiIgcng9IjMiIGZpbGw9IiM4YTZhM2MiLz48L3N2Zz4=';

/** A column taller than it is wide, and a strip wider than it is tall: both crop to the same square. */
const TALL_BASE64 =
  'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMjAiIGhlaWdodD0iNDAwIj48cmVjdCB3aWR0aD0iMTIwIiBoZWlnaHQ9IjQwMCIgcng9IjEwIiBmaWxsPSIjMTQxYzI2Ii8+PHJlY3QgeD0iMTQiIHk9IjE4IiB3aWR0aD0iOTIiIGhlaWdodD0iMTgiIHJ4PSI0IiBmaWxsPSIjMjQzODRmIi8+PHJlY3QgeD0iMTQiIHk9IjUyIiB3aWR0aD0iOTIiIGhlaWdodD0iMTIiIHJ4PSIzIiBmaWxsPSIjM2Q2MDg5Ii8+PHJlY3QgeD0iMTQiIHk9Ijg2IiB3aWR0aD0iNzQiIGhlaWdodD0iMTIiIHJ4PSIzIiBmaWxsPSIjM2Q2MDg5Ii8+PHJlY3QgeD0iMTQiIHk9IjEyMCIgd2lkdGg9IjU2IiBoZWlnaHQ9IjEyIiByeD0iMyIgZmlsbD0iIzNkNjA4OSIvPjxyZWN0IHg9IjE0IiB5PSIxNTQiIHdpZHRoPSI5MiIgaGVpZ2h0PSIxMiIgcng9IjMiIGZpbGw9IiMzZDYwODkiLz48cmVjdCB4PSIxNCIgeT0iMTg4IiB3aWR0aD0iNzQiIGhlaWdodD0iMTIiIHJ4PSIzIiBmaWxsPSIjM2Q2MDg5Ii8+PHJlY3QgeD0iMTQiIHk9IjIyMiIgd2lkdGg9IjU2IiBoZWlnaHQ9IjEyIiByeD0iMyIgZmlsbD0iIzNkNjA4OSIvPjxyZWN0IHg9IjE0IiB5PSIyNTYiIHdpZHRoPSI5MiIgaGVpZ2h0PSIxMiIgcng9IjMiIGZpbGw9IiMzZDYwODkiLz48cmVjdCB4PSIxNCIgeT0iMjkwIiB3aWR0aD0iNzQiIGhlaWdodD0iMTIiIHJ4PSIzIiBmaWxsPSIjM2Q2MDg5Ii8+PHJlY3QgeD0iMTQiIHk9IjMyNCIgd2lkdGg9IjU2IiBoZWlnaHQ9IjEyIiByeD0iMyIgZmlsbD0iIzNkNjA4OSIvPjxjaXJjbGUgY3g9IjYwIiBjeT0iMzY2IiByPSIxNiIgZmlsbD0iIzZlYThlMCIvPjwvc3ZnPg==';
const WIDE_BASE64 =
  'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NDAiIGhlaWdodD0iMTYwIj48cmVjdCB3aWR0aD0iNjQwIiBoZWlnaHQ9IjE2MCIgcng9IjEwIiBmaWxsPSIjMWQxNzEwIi8+PHJlY3QgeD0iMTgiIHk9IjQyIiB3aWR0aD0iNTYiIGhlaWdodD0iNTYiIHJ4PSI4IiBmaWxsPSIjOGE1YTI2Ii8+PHJlY3QgeD0iOTQiIHk9IjQyIiB3aWR0aD0iNTYiIGhlaWdodD0iNTYiIHJ4PSI4IiBmaWxsPSIjZDA4YTNjIi8+PHJlY3QgeD0iMTcwIiB5PSI0MiIgd2lkdGg9IjU2IiBoZWlnaHQ9IjU2IiByeD0iOCIgZmlsbD0iIzhhNWEyNiIvPjxyZWN0IHg9IjI0NiIgeT0iNDIiIHdpZHRoPSI1NiIgaGVpZ2h0PSI1NiIgcng9IjgiIGZpbGw9IiNkMDhhM2MiLz48cmVjdCB4PSIzMjIiIHk9IjQyIiB3aWR0aD0iNTYiIGhlaWdodD0iNTYiIHJ4PSI4IiBmaWxsPSIjOGE1YTI2Ii8+PHJlY3QgeD0iMzk4IiB5PSI0MiIgd2lkdGg9IjU2IiBoZWlnaHQ9IjU2IiByeD0iOCIgZmlsbD0iI2QwOGEzYyIvPjxyZWN0IHg9IjQ3NCIgeT0iNDIiIHdpZHRoPSI1NiIgaGVpZ2h0PSI1NiIgcng9IjgiIGZpbGw9IiM4YTVhMjYiLz48cmVjdCB4PSI1NTAiIHk9IjQyIiB3aWR0aD0iNTYiIGhlaWdodD0iNTYiIHJ4PSI4IiBmaWxsPSIjZDA4YTNjIi8+PHJlY3QgeD0iMTgiIHk9IjExNiIgd2lkdGg9IjYwNCIgaGVpZ2h0PSIxMCIgcng9IjQiIGZpbGw9IiM0YTNhMjIiLz48L3N2Zz4=';

const SVG_MEDIA_TYPE = 'image/svg+xml';
const dataUrl = (base64: string): string => `data:${SVG_MEDIA_TYPE};base64,${base64}`;

/**
 * The sample machine paths the preview transport can read bytes for, so a
 * path-backed reference resolves exactly as it would against a real session.
 * `/sample/project/shots/missing.png` is deliberately absent: an unreadable
 * picture must still render its named chip rather than a broken image.
 */
export const PREVIEW_IMAGE_FILES: Readonly<Record<string, { base64Data: string; mediaType: string }>> = {
  '/sample/project/shots/before.png': { base64Data: BEFORE_BASE64, mediaType: SVG_MEDIA_TYPE },
  '/sample/project/shots/after.png': { base64Data: AFTER_BASE64, mediaType: SVG_MEDIA_TYPE },
  '/sample/project/shots/ghostex-paste-2026-09-17-093012.png': {
    base64Data: PASTE_BASE64,
    mediaType: SVG_MEDIA_TYPE,
  },
  '/sample/project/shots/window@2x.png': { base64Data: PREVIEW_SCREENSHOT_BASE64, mediaType: 'image/png' },
};

/**
 * Pictures in a conversation: attachments on a user turn, a numbered reference
 * written into the prompt's own text, a screenshot off a Retina screen, a tall
 * one and a wide one, a markdown image in a reply, and a chip for a file this
 * host cannot read.
 */
export function imagesPreviewScenario(): PreviewScenarioSnapshot {
  return {
    messages: [
      previewRow('images-1', 'user', 0, [
        { type: 'image-ref', url: dataUrl(BEFORE_BASE64), alt: 'Transcript before the spacing fix' },
        { type: 'image-ref', url: dataUrl(AFTER_BASE64), alt: 'Transcript after the spacing fix' },
        {
          type: 'image-ref',
          path: '/sample/project/shots/ghostex-paste-2026-09-17-093012.png',
        },
        {
          type: 'text',
          text: 'Two screens of the same transcript, plus the paste from the review call. The second one is what I want.',
        },
      ]),
      previewTextRow(
        'images-2',
        'user',
        12,
        'Line them up yourself: [Image #1](/sample/project/shots/before.png) and [Image #2](/sample/project/shots/after.png), both at 100%.'
      ),
      previewRow('images-3', 'assistant', 24, [
        { type: 'image-ref', url: dataUrl(CHART_BASE64), alt: 'Row height per message kind' },
        { type: 'image-ref', path: '/sample/project/shots/missing.png', alt: 'Archived comparison' },
      ]),
      previewRow('images-4', 'assistant', 30, [
        {
          type: 'text',
          text: [
            'The second screen keeps a full line of space under every tool row, which is where the extra height comes from.',
            '',
            `![Row height per message kind](${dataUrl(CHART_BASE64)})`,
            '',
            'The archived comparison is not on this machine any more, so it stays a named chip instead of a broken picture.',
          ].join('\n'),
        },
      ]),
      previewRow('images-5', 'user', 36, [
        { type: 'image-ref', path: '/sample/project/shots/window@2x.png' },
        { type: 'text', text: 'The whole window off a Retina screen, on its own. Open it to read the rows.' },
      ]),
      previewRow('images-6', 'user', 42, [
        { type: 'image-ref', url: dataUrl(TALL_BASE64), alt: 'The settings column, top to bottom' },
        { type: 'image-ref', url: dataUrl(WIDE_BASE64), alt: 'The toolbar across the window' },
        { type: 'text', text: 'One tall, one wide, both cropped to the same square.' },
      ]),
      previewTextRow(
        'images-7',
        'user',
        48,
        'And the same screenshot written into the sentence: [Image #1](/sample/project/shots/window@2x.png) sits between these words, on a line long enough to wrap before it so the prose and the picture have to share the row.'
      ),
    ],
  };
}
