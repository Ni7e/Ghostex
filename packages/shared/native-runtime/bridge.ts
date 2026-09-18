export type NativeMessage = { kind: string; [key: string]: unknown };
declare const ghostexNativeCall: (request: string) => string;
declare const ghostexNativePost: (message: string) => void;

export function nativeCall<T>(operation: string, params: Record<string, unknown> = {}): T {
  const response = JSON.parse(ghostexNativeCall(JSON.stringify({ operation, ...params })));
  if (response.error) throw new Error(response.error);
  return response.result as T;
}

export function nativePost(message: NativeMessage): void { ghostexNativePost(JSON.stringify(message)); }
