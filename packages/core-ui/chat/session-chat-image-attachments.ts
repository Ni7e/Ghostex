export interface PastedImagePreview {
  dataUrl: string;
  id: string;
  path: string;
}

/** Rich Prompt Editor numbering: max existing [Image #N]( in the draft, +1. */
export function nextImageReferenceIndex(text: string): number {
  let highest = 0;
  for (const match of text.matchAll(/\[Image #(\d+)·?\]\(/g)) {
    const index = Number.parseInt(match[1] ?? '', 10);
    if (Number.isFinite(index)) {
      highest = Math.max(highest, index);
    }
  }
  return highest + 1;
}

export const IMAGE_PATH_PATTERN = /\.(avif|bmp|gif|heic|heif|ico|jpe?g|png|svg|tiff?|webp)$/i;
/**
 * CDXC:SessionChat 2026-09-06 DECISION:
 * User: expanded image references with the trailing · must still show image previews in input boxes across all apps.
 */
export const LINKED_IMAGE_REFERENCE_PATTERN = /\[Image #\d+·?\]\(([^)\r\n]+)\)/g;

export function linkedImageReferenceHrefs(text: string): string[] {
  return [...text.matchAll(LINKED_IMAGE_REFERENCE_PATTERN)].map((match) => match[1]?.trim() ?? '').filter(Boolean);
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || IMAGE_PATH_PATTERN.test(file.name);
}

export function clipboardImageFiles(data: DataTransfer): File[] {
  const files: File[] = [];
  for (const item of Array.from(data.items)) {
    if (item.kind !== 'file') {
      continue;
    }
    const file = item.getAsFile();
    if (file && isImageFile(file)) {
      files.push(file);
    }
  }
  return files;
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the pasted image.'));
    reader.readAsDataURL(file);
  });
}

export type SaveSessionChatImage = (payload: { base64Data: string; suggestedName?: string }) => Promise<string>;

export async function saveSessionChatImageFile(file: File, save: SaveSessionChatImage) {
  const dataUrl = await readFileAsDataUrl(file);
  const base64Data = dataUrl.split(',', 2)[1] ?? '';
  if (!base64Data) throw new Error('Could not read the pasted image.');
  const path = await save({ base64Data, ...(file.name ? { suggestedName: file.name } : {}) });
  return { path, dataUrl };
}
