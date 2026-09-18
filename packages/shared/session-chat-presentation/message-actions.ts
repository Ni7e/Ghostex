/** Content requirements shared by the React action buttons and native transcript projection. */
export function sessionChatMessageActionContent(markdown: string) {
  return {
    copyable: markdown.length > 0,
    canAnnotate: markdown.trim().length > 0,
    canSaveMarkdown: markdown.split(/\r?\n/u).filter((line) => line.trim().length > 0).length > 1,
  };
}
