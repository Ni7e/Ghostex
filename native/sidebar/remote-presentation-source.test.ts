import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const nativeSidebarSource = readFileSync(new URL("./native-sidebar.tsx", import.meta.url), "utf8");
const sortableSessionCardSource = readFileSync(
  new URL("../../sidebar/sortable-session-card.tsx", import.meta.url),
  "utf8",
);
const sessionGroupSectionSource = readFileSync(
  new URL("../../sidebar/session-group-section.tsx", import.meta.url),
  "utf8",
);
const sessionCardsCssSource = readFileSync(
  new URL("../../sidebar/styles/session-cards.css", import.meta.url),
  "utf8",
);

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("remote presentation sidebar source", () => {
  test("projects remote sessions through the shared gxserver row shape", () => {
    /*
     * CDXC:RemotePresentation 2026-06-30-00:11:
     * Remote machine rows must not maintain a hand-copied subset of gxserver
     * session fields. Delegate to the shared projector so remote titles,
     * lifecycle state, activity, tags, and persistence metadata stay in parity
     * with local gxserver-backed rows.
     */
    const remoteProjection = sourceBetween(
      nativeSidebarSource,
      "function createRemotePresentationSidebarSession",
      "function createRemotePresentationGroupId",
    );
    expect(remoteProjection).toContain("createGxserverPresentationSidebarSession({");
    expect(remoteProjection).toContain("createRemotePresentationSessionId(machineId, projectId, sessionId)");
    expect(remoteProjection).toContain("isFocused");
    expect(remoteProjection).toContain("isVisible: isFocused || index === 0");
    expect(remoteProjection).not.toContain("displayTitle: presentation.displayTitle");
    expect(remoteProjection).not.toContain("providerSessionState,");
  });

  test("marks remote cards and anchored status dots for lifecycle chrome", () => {
    /*
     * CDXC:RemotePresentation 2026-06-30-00:11:
     * A remote running-idle session still needs visible sidebar status. Carry the
     * remote marker through both session-card render paths and keep the CSS scoped
     * to remote neutral lifecycle states.
     */
    expect(sortableSessionCardSource).toContain("const isRemoteSession = Boolean(sessionGroup?.remoteMachineContext);");
    expect(sortableSessionCardSource).toContain("alwaysShowStateTooltip: isRemoteSession");
    expect(sortableSessionCardSource).toContain("data-remote-session={String(isRemoteSession)}");
    expect(sessionGroupSectionSource).toContain('data-remote-session={String(Boolean(group.remoteMachineContext))}');
    expect(sessionCardsCssSource).toContain('.session-frame[data-remote-session="true"]:is(');
    expect(sessionCardsCssSource).toContain(
      '.session-status-dot-anchored[data-remote-session="true"]:is(',
    );
    expect(sessionCardsCssSource).toContain(
      '[data-remote-session="true"][data-lifecycle-state="running"]',
    );
    expect(sessionCardsCssSource).toContain(
      '[data-remote-session="true"][data-lifecycle-state="sleeping"]',
    );
    expect(sessionCardsCssSource).toContain(
      '[data-remote-session="true"][data-lifecycle-state="done"]',
    );
  });
});
