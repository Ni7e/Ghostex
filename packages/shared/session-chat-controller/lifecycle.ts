export interface ChatLifecycle {
  useState<T>(initial: T | (() => T)): [T, (value: T | ((current: T) => T)) => void];
  useRef<T>(initial: T): { current: T };
  useMemo<T>(create: () => T, dependencies: readonly unknown[]): T;
  useCallback<T extends (...args: any[]) => any>(callback: T, dependencies: readonly unknown[]): T;
  useEffect(effect: () => void | (() => void), dependencies?: readonly unknown[]): void;
  useLayoutEffect(effect: () => void | (() => void), dependencies?: readonly unknown[]): void;
}

type Cell = { value?: unknown; dependencies?: readonly unknown[]; cleanup?: () => void; setter?: (update: any) => void };

/** A host-neutral lifecycle for the shared chat state machine in the native JavaScript runtime. */
export class ChatComputation<T> implements ChatLifecycle {
  private cells: Cell[] = [];
  private cursor = 0;
  private effects: (() => void)[] = [];
  private scheduled = false;
  private disposed = false;
  private value!: T;

  constructor(private readonly compute: (lifecycle: ChatLifecycle) => T, private readonly changed: (value: T) => void) {}

  private cell(): Cell {
    const index = this.cursor++;
    return (this.cells[index] ??= {});
  }

  private dirty(cell: Cell, dependencies?: readonly unknown[]): boolean {
    return !dependencies || !cell.dependencies || dependencies.length !== cell.dependencies.length || dependencies.some((value, index) => !Object.is(value, cell.dependencies![index]));
  }

  private schedule = (): void => {
    if (this.disposed || this.scheduled) return;
    this.scheduled = true;
    void Promise.resolve().then(() => {
      this.scheduled = false;
      if (!this.disposed) this.run();
    });
  };

  useState = <S>(initial: S | (() => S)): [S, (value: S | ((current: S) => S)) => void] => {
    const cell = this.cell();
    if (!('value' in cell)) cell.value = typeof initial === 'function' ? (initial as () => S)() : initial;
    cell.setter ??= (update) => {
      const next = typeof update === 'function' ? (update as (current: S) => S)(cell.value as S) : update;
      if (Object.is(cell.value, next)) return;
      cell.value = next;
      this.schedule();
    };
    return [cell.value as S, cell.setter];
  };

  useRef = <S>(initial: S): { current: S } => {
    const cell = this.cell();
    if (!('value' in cell)) cell.value = { current: initial };
    return cell.value as { current: S };
  };

  useMemo = <S>(create: () => S, dependencies: readonly unknown[]): S => {
    const cell = this.cell();
    if (this.dirty(cell, dependencies)) {
      cell.value = create();
      cell.dependencies = dependencies;
    }
    return cell.value as S;
  };

  useCallback = <S extends (...args: any[]) => any>(callback: S, dependencies: readonly unknown[]): S => this.useMemo(() => callback, dependencies);

  useEffect = (effect: () => void | (() => void), dependencies?: readonly unknown[]): void => {
    const cell = this.cell();
    if (!this.dirty(cell, dependencies)) return;
    cell.dependencies = dependencies;
    this.effects.push(() => {
      cell.cleanup?.();
      cell.cleanup = effect() || undefined;
    });
  };

  useLayoutEffect = this.useEffect;

  run(): T {
    this.cursor = 0;
    this.effects = [];
    this.value = this.compute(this);
    for (const effect of this.effects) effect();
    this.changed(this.value);
    return this.value;
  }

  current(): T { return this.value; }

  dispose(): void {
    this.disposed = true;
    for (const cell of this.cells) cell.cleanup?.();
    this.cells = [];
  }
}
