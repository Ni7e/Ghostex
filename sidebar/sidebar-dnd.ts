type SessionDragData = {
  groupId: string;
  kind: "session";
  sessionId: string;
};

type GroupDropData = {
  groupId: string;
  kind: "group";
};

export type SidebarGroupDropTarget = {
  groupId: string;
  position: "before" | "after";
};

type CreateGroupDropData = {
  kind: "create-group";
};

type RemoteMachineDragData = {
  kind: "remote-machine";
  remoteMachineId: string;
};

export type SidebarSessionDropTarget =
  | {
      groupId: string;
      kind: "group";
      position: "start" | "end";
    }
  | {
      groupId: string;
      kind: "session";
      position: "before" | "after";
      sessionId: string;
    };

type SessionDropTargetData = {
  dropTarget: SidebarSessionDropTarget;
  kind: "session-drop-target";
};

export type SidebarDropData =
  | SessionDragData
  | GroupDropData
  | RemoteMachineDragData
  | CreateGroupDropData
  | SessionDropTargetData;

const SIDEBAR_GROUP_SELECTOR = "[data-sidebar-group-id]";
const SIDEBAR_SESSION_SELECTOR = "[data-sidebar-session-id]";

export function createSessionDragData(groupId: string, sessionId: string): SessionDragData {
  return {
    groupId,
    kind: "session",
    sessionId,
  };
}

export function createGroupDropData(groupId: string): GroupDropData {
  return {
    groupId,
    kind: "group",
  };
}

export function createCreateGroupDropData(): CreateGroupDropData {
  return {
    kind: "create-group",
  };
}

export function createRemoteMachineDragData(remoteMachineId: string): RemoteMachineDragData {
  return {
    kind: "remote-machine",
    remoteMachineId,
  };
}

export function createSessionDropTargetData(
  dropTarget: SidebarSessionDropTarget,
): SessionDropTargetData {
  return {
    dropTarget,
    kind: "session-drop-target",
  };
}

export function createSessionDropTargetId(dropTarget: SidebarSessionDropTarget): string {
  if (dropTarget.kind === "group") {
    return `session-drop-target:${dropTarget.groupId}:group:${dropTarget.position}`;
  }

  return `session-drop-target:${dropTarget.groupId}:${dropTarget.sessionId}:${dropTarget.position}`;
}

export function getSidebarDropData(candidate: unknown): SidebarDropData | undefined {
  if (!hasData(candidate)) {
    return undefined;
  }

  const data = candidate.data;
  if (!isObjectRecord(data) || !("kind" in data)) {
    return undefined;
  }

  switch (data.kind) {
    case "session":
      return typeof data.groupId === "string" && typeof data.sessionId === "string"
        ? {
            groupId: data.groupId,
            kind: "session",
            sessionId: data.sessionId,
          }
        : undefined;

    case "group":
      return typeof data.groupId === "string"
        ? {
            groupId: data.groupId,
            kind: "group",
          }
        : undefined;

    case "create-group":
      return { kind: "create-group" };

    case "remote-machine":
      return typeof data.remoteMachineId === "string"
        ? {
            kind: "remote-machine",
            remoteMachineId: data.remoteMachineId,
          }
        : undefined;

    case "session-drop-target":
      return isSidebarSessionDropTarget(data.dropTarget)
        ? {
            dropTarget: data.dropTarget,
            kind: "session-drop-target",
          }
        : undefined;

    default:
      return undefined;
  }
}

export function getSidebarSessionDropTarget(
  candidate: SidebarDropData | undefined,
): SidebarSessionDropTarget | undefined {
  return candidate?.kind === "session-drop-target" ? candidate.dropTarget : undefined;
}

export function getClientPoint(
  event: Event | null | undefined,
): { x: number; y: number } | undefined {
  if (
    !event ||
    !("clientX" in event) ||
    !("clientY" in event) ||
    typeof event.clientX !== "number" ||
    typeof event.clientY !== "number"
  ) {
    return undefined;
  }

  return {
    x: event.clientX,
    y: event.clientY,
  };
}

export function getSidebarSessionDropTargetAtPoint(
  documentLike: Pick<Document, "elementFromPoint"> & Partial<Pick<Document, "elementsFromPoint">>,
  x: number,
  y: number,
): SidebarSessionDropTarget | undefined {
  const elements =
    typeof documentLike.elementsFromPoint === "function"
      ? documentLike.elementsFromPoint(x, y)
      : [documentLike.elementFromPoint(x, y)];

  for (const element of elements) {
    if (!isDomElement(element) || isDraggingElement(element)) {
      continue;
    }

    const target = getSidebarSessionDropTargetFromElement(element, y);
    if (target) {
      return target;
    }
  }

  return undefined;
}

export function getSidebarSessionDropTargetFromEvent(
  event: Event | null | undefined,
): SidebarSessionDropTarget | undefined {
  const point = getClientPoint(event);
  const target = event?.target;
  const element = target instanceof Element ? target : undefined;
  if (!element) {
    return undefined;
  }

  return getSidebarSessionDropTargetFromElement(element, point?.y);
}

export function getSidebarGroupDropTargetAtPoint(
  documentLike: Pick<Document, "elementFromPoint"> & Partial<Pick<Document, "elementsFromPoint">>,
  x: number,
  y: number,
): SidebarGroupDropTarget | undefined {
  const elements =
    typeof documentLike.elementsFromPoint === "function"
      ? documentLike.elementsFromPoint(x, y)
      : [documentLike.elementFromPoint(x, y)];

  for (const element of elements) {
    if (!isDomElement(element) || isDraggingElement(element)) {
      continue;
    }

    const target = getSidebarGroupDropTargetFromElement(element, y);
    if (target) {
      return target;
    }
  }

  return undefined;
}

export function getSidebarGroupDropTargetFromEvent(
  event: Event | null | undefined,
): SidebarGroupDropTarget | undefined {
  const point = getClientPoint(event);
  const target = event?.target;
  const element = target instanceof Element ? target : undefined;
  if (!element) {
    return undefined;
  }

  return getSidebarGroupDropTargetFromElement(element, point?.y);
}

export function moveGroupIdsByDropTarget(
  groupIds: readonly string[],
  sourceGroupId: string,
  target: SidebarGroupDropTarget,
): string[] {
  const sourceIndex = groupIds.indexOf(sourceGroupId);
  const targetIndex = groupIds.indexOf(target.groupId);
  if (sourceIndex < 0 || targetIndex < 0) {
    return [...groupIds];
  }

  if (sourceGroupId === target.groupId) {
    return [...groupIds];
  }

  const insertIndex = targetIndex + (target.position === "after" ? 1 : 0);
  const adjustedInsertIndex = insertIndex > sourceIndex ? insertIndex - 1 : insertIndex;
  const nextGroupIds = groupIds.filter((groupId) => groupId !== sourceGroupId);
  nextGroupIds.splice(clampIndex(adjustedInsertIndex, nextGroupIds.length), 0, sourceGroupId);
  return nextGroupIds;
}

export function moveSessionIdsByDropTarget(
  sessionIdsByGroup: Record<string, string[]>,
  sessionId: string,
  target: SidebarSessionDropTarget,
): Record<string, string[]> {
  const sourceGroupId = findSessionGroupId(sessionIdsByGroup, sessionId);
  if (!sourceGroupId) {
    return sessionIdsByGroup;
  }

  const sourceSessionIds = sessionIdsByGroup[sourceGroupId];
  if (!sourceSessionIds) {
    return sessionIdsByGroup;
  }

  const sourceIndex = sourceSessionIds.indexOf(sessionId);
  if (sourceIndex < 0) {
    return sessionIdsByGroup;
  }

  const targetSessionIds = sessionIdsByGroup[target.groupId];
  if (!targetSessionIds) {
    return sessionIdsByGroup;
  }

  const targetIndex = getTargetInsertIndex(targetSessionIds, target);
  if (targetIndex === undefined) {
    return sessionIdsByGroup;
  }

  if (sourceGroupId === target.groupId) {
    const adjustedTargetIndex = targetIndex > sourceIndex ? targetIndex - 1 : targetIndex;
    if (adjustedTargetIndex === sourceIndex) {
      return sessionIdsByGroup;
    }

    const nextSessionIds = [...sourceSessionIds];
    nextSessionIds.splice(sourceIndex, 1);
    nextSessionIds.splice(clampIndex(adjustedTargetIndex, nextSessionIds.length), 0, sessionId);

    return {
      ...sessionIdsByGroup,
      [sourceGroupId]: nextSessionIds,
    };
  }

  const nextSourceSessionIds = sourceSessionIds.filter((candidate) => candidate !== sessionId);
  const nextTargetSessionIds = [...targetSessionIds];
  nextTargetSessionIds.splice(clampIndex(targetIndex, nextTargetSessionIds.length), 0, sessionId);

  return {
    ...sessionIdsByGroup,
    [sourceGroupId]: nextSourceSessionIds,
    [target.groupId]: nextTargetSessionIds,
  };
}

function getTargetInsertIndex(
  targetSessionIds: readonly string[],
  target: SidebarSessionDropTarget,
): number | undefined {
  if (target.kind === "group") {
    return target.position === "end" ? targetSessionIds.length : 0;
  }

  const hoveredSessionIndex = targetSessionIds.indexOf(target.sessionId);
  if (hoveredSessionIndex < 0) {
    return undefined;
  }

  return hoveredSessionIndex + (target.position === "after" ? 1 : 0);
}

function clampIndex(index: number, max: number): number {
  return Math.max(0, Math.min(index, max));
}

function findSessionGroupId(
  sessionIdsByGroup: Record<string, readonly string[]>,
  sessionId: string,
): string | undefined {
  return Object.entries(sessionIdsByGroup).find(([, sessionIds]) =>
    sessionIds.includes(sessionId),
  )?.[0];
}

function getSidebarSessionDropTargetFromElement(
  element: Element,
  clientY: number | undefined,
): SidebarSessionDropTarget | undefined {
  const sessionElement = element.closest<HTMLElement>(SIDEBAR_SESSION_SELECTOR);
  if (sessionElement) {
    const groupElement = sessionElement.closest<HTMLElement>(SIDEBAR_GROUP_SELECTOR);
    const groupId = groupElement?.dataset.sidebarGroupId;
    const sessionId = sessionElement.dataset.sidebarSessionId;
    if (groupId && sessionId) {
      const bounds = sessionElement.getBoundingClientRect();
      const relativeY = clientY ?? bounds.top + bounds.height / 2;
      /*
       * CDXC:SidebarDragDrop 2026-06-19-11:12:
       * Session insertion indicators should never disappear at row center.
       * Treat the midpoint as the first pixel of the lower half so center/down
       * shows an after-line and center/up shows a before-line.
       */
      return {
        groupId,
        kind: "session",
        position: relativeY >= bounds.top + bounds.height / 2 ? "after" : "before",
        sessionId,
      };
    }
  }

  const groupElement = element.closest<HTMLElement>(SIDEBAR_GROUP_SELECTOR);
  const groupId = groupElement?.dataset.sidebarGroupId;
  if (!groupId) {
    return undefined;
  }

  const bounds = groupElement.getBoundingClientRect();
  const relativeY = clientY ?? bounds.top + bounds.height / 2;
  return {
    groupId,
    kind: "group",
    position: relativeY > bounds.top + bounds.height / 2 ? "end" : "start",
  };
}

function getSidebarGroupDropTargetFromElement(
  element: Element,
  clientY: number | undefined,
): SidebarGroupDropTarget | undefined {
  const groupElement = element.closest<HTMLElement>(SIDEBAR_GROUP_SELECTOR);
  const groupId = groupElement?.dataset.sidebarGroupId;
  if (!groupElement || !groupId) {
    return undefined;
  }

  /*
   * CDXC:ProjectReorder 2026-05-22-22:18:
   * Project reorder insertion lines should be stable while dragging across
   * expanded projects. Resolve before/after from the visible header row instead
   * of the full group height so session lists do not move the midpoint.
   */
  const boundsElement = getSidebarGroupDropBoundsElement(groupElement);
  const bounds = boundsElement.getBoundingClientRect();
  const relativeY = clientY ?? bounds.top + bounds.height / 2;
  return {
    groupId,
    position: relativeY > bounds.top + bounds.height / 2 ? "after" : "before",
  };
}

function getSidebarGroupDropBoundsElement(groupElement: HTMLElement): HTMLElement {
  if (typeof groupElement.querySelector !== "function") {
    return groupElement;
  }

  return groupElement.querySelector<HTMLElement>(".group-head") ?? groupElement;
}

function hasData(candidate: unknown): candidate is { data?: unknown } {
  return isObjectRecord(candidate) && "data" in candidate;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDraggingElement(element: Element): boolean {
  return element.closest<HTMLElement>("[data-dragging='true']") !== null;
}

function isDomElement(candidate: unknown): candidate is Element {
  return typeof candidate === "object" && candidate !== null && "closest" in candidate;
}

function isSidebarSessionDropTarget(candidate: unknown): candidate is SidebarSessionDropTarget {
  if (!isObjectRecord(candidate) || typeof candidate.groupId !== "string") {
    return false;
  }

  if (candidate.kind === "group") {
    return candidate.position === "start" || candidate.position === "end";
  }

  return (
    candidate.kind === "session" &&
    typeof candidate.sessionId === "string" &&
    (candidate.position === "before" || candidate.position === "after")
  );
}
