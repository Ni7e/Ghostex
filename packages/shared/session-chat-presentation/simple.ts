export function sessionChatSimpleEditLabel(count: number): string {
  return `Edited ${count} ${count === 1 ? 'file' : 'files'}`;
}

export function sessionChatToolCountLabel(count: number): string {
  return count === 0 ? 'Tool output' : `${count} tool ${count === 1 ? 'call' : 'calls'}`;
}
