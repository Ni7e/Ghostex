export interface ChatTransferChunk {
  transferId?: string;
  index?: number;
  total?: number;
  data?: string;
}

/** Reassembles the bounded broker frames for either chat renderer. */
export class ChatTransfers {
  private transfers = new Map<string, { parts: string[]; total: number; length: number; timer: ReturnType<typeof setTimeout> }>();

  constructor(private readonly failed: (reason: string) => void) {}

  clear(): void {
    for (const transfer of this.transfers.values()) clearTimeout(transfer.timer);
    this.transfers.clear();
  }

  private fail(reason: string): undefined {
    this.clear();
    this.failed(reason);
    return undefined;
  }

  accept({ transferId, index, total, data }: ChatTransferChunk): unknown | undefined {
    if (!transferId || !Number.isInteger(index) || !Number.isInteger(total) || total! < 1 || total! > 683 || typeof data !== 'string' || data.length > 96 * 1024) {
      return this.fail('Invalid shared chat transfer.');
    }
    let transfer = this.transfers.get(transferId);
    if (!transfer && index === 0 && this.transfers.size < 1) {
      transfer = { parts: [], total: total!, length: 0, timer: setTimeout(() => this.fail('The shared chat transfer timed out.'), 30_000) };
      this.transfers.set(transferId, transfer);
    }
    if (!transfer || transfer.total !== total || transfer.parts.length !== index) return this.fail('The shared chat transfer was interrupted.');
    transfer.length += data.length;
    if (transfer.length > 64 * 1024 * 1024) return this.fail('The shared chat transfer is too large.');
    transfer.parts.push(data);
    if (transfer.parts.length !== transfer.total) return undefined;
    clearTimeout(transfer.timer);
    this.transfers.delete(transferId);
    try { return JSON.parse(transfer.parts.join('')); }
    catch { return this.fail('Invalid shared chat transfer.'); }
  }
}
