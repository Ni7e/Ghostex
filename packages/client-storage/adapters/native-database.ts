import { nativeCall } from '@/packages/shared/native-runtime/bridge';
import { applyDatabaseMutations, type StorageTable, type StorageMetadata } from './database-transaction';
import { storageCatalog, type StoreId } from '../catalog';
import type { StorageRecord, StorageChange } from '../types';
import type { Mutation } from './database';
export type { Mutation } from './database';

const records: StorageTable = {
  get: async (key) => nativeCall('recordRead', { key }) ?? undefined,
  byStore: async (store) => nativeCall('recordScan', { store }),
  put: async (row) => nativeCall('recordWrite', { row }),
  delete: async (key) => nativeCall('recordRemove', { key }),
};
const metadata: StorageMetadata = {
  get: async (key) => nativeCall('metadataRead', { key }),
  put: async (value, key) => nativeCall('metadataWrite', { value, key }),
};
let tail: Promise<unknown> = Promise.resolve();
export function installDatabaseGuard(): void {}
export async function readDatabaseSnapshot(): Promise<{ rows: StorageRecord[]; revision: number }> {
  await tail.catch(() => {});
  return nativeCall('databaseSnapshot');
}
export async function readDatabase(): Promise<StorageRecord[]> { return (await readDatabaseSnapshot()).rows; }
export function commitDatabase(mutations: readonly Mutation[], migration = false, importSource?: string): Promise<StorageChange[]> {
  return transactionDatabase(() => mutations, [], migration, importSource);
}
export function transactionDatabase(action: (rows: StorageRecord[]) => readonly Mutation[], ids: readonly StoreId[], migration = false, importSource?: string): Promise<StorageChange[]> {
  const operation = tail.catch(() => {}).then(async () => {
    nativeCall('transactionBegin');
    try {
      const receiptKey = importSource ? storageCatalog.migrationReceipts.key + importSource : undefined;
      let changes: StorageChange[] = [];
      if (!receiptKey || !(await records.get(receiptKey))) {
        const rows = (await Promise.all(ids.map(id => records.byStore(id)))).flat();
        const mutations = [...action(rows)];
        if (receiptKey) mutations.push({ key: receiptKey, store: 'migrationReceipts', raw: '1' });
        changes = await applyDatabaseMutations(records, metadata, mutations, migration);
      }
      nativeCall('transactionCommit');
      return changes;
    } catch (error) { nativeCall('transactionRollback'); throw error; }
  });
  tail = operation;
  return operation;
}
export async function readLegacyDatabase(name: string, store: string): Promise<{ rows: unknown[]; close: () => void; retire: (indices?: readonly number[]) => Promise<void> } | undefined> {
  const rows = nativeCall<unknown[]>('legacyDatabaseRead', { name, store });
  if (!rows.length) return;
  return { rows, close() {}, retire: async () => {} };
}
