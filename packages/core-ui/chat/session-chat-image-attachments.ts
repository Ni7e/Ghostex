export interface PastedImagePreview {
  dataUrl: string;
  id: string;
  path: string;
}

import { IMAGE_PATH_PATTERN } from '@/packages/shared/session-chat-presentation/references';
export { nextImageReferenceIndex, IMAGE_PATH_PATTERN, LINKED_IMAGE_REFERENCE_PATTERN, linkedImageReferenceHrefs } from '@/packages/shared/session-chat-presentation/references';

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
