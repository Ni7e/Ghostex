import { describe, expect, test } from "vitest";
import {
  beadConversationLinkMatchKey,
  createBeadConversationLinkId,
  indexBeadConversationLinksByBead,
  normalizeBeadConversationLinks,
  selectBeadConversationLinks,
} from "./bead-conversation-links";

describe("bead conversation links", () => {
  test("should keep multiple beads linked to the same Ghostex conversation", () => {
    /*
     * CDXC:ProjectBoard 2026-05-26-10:20:
     * The link model must allow several Beads issues to route to one agent conversation.
     * Normalize link records independently by bead id instead of deduplicating by Ghostex session id.
     */
    const links = normalizeBeadConversationLinks(
      [
        {
          beadId: "zmux-123",
          ghostexSessionId: "session-a",
          id: "link-1",
          projectId: "project-a",
          status: "active",
        },
        {
          beadId: "zmux-456",
          ghostexSessionId: "session-a",
          id: "link-2",
          projectId: "project-a",
          status: "active",
        },
      ],
      "project-a",
    );

    expect(links).toHaveLength(2);
    expect(links.map((link) => link.beadId)).toEqual(["zmux-123", "zmux-456"]);
    expect(new Set(links.map((link) => link.ghostexSessionId))).toEqual(new Set(["session-a"]));
  });

  test("should derive stable ids from project, bead, and Ghostex session", () => {
    expect(createBeadConversationLinkId("My Project", "ZMUX 123", "session/a")).toBe(
      "My-Project:ZMUX-123:session-a",
    );
  });

  test("should discard unusable records and normalize optional metadata", () => {
    const links = normalizeBeadConversationLinks(
      [
        { beadId: "zmux-1" },
        {
          agentName: " codex ",
          agentSessionId: " 019-session ",
          beadDisplayId: " ZMX-1 ",
          beadId: " zmux-1 ",
          ghostexSessionId: " session-1 ",
          sessionPersistenceProvider: "zmx",
          status: "archived",
        },
      ],
      "project-a",
    );

    expect(links).toMatchObject([
      {
        agentName: "codex",
        agentSessionId: "019-session",
        beadDisplayId: "ZMX-1",
        beadId: "zmux-1",
        ghostexSessionId: "session-1",
        projectId: "project-a",
        sessionPersistenceProvider: "zmx",
        status: "archived",
      },
    ]);
  });
});

describe("bead conversation link matching", () => {
  const link = (beadId: string, ghostexSessionId: string) => ({
    beadId,
    ghostexSessionId,
    id: `${beadId}:${ghostexSessionId}`,
  });

  test("should keep a link matched to its bead after a prefix rename", () => {
    /*
     * A board load can rename every issue prefix (zmux-95421485 becomes
     * ghostex-95421485). Links persist the id they were written with, so the
     * lookup must survive the rename instead of orphaning the conversation.
     */
    const index = indexBeadConversationLinksByBead([link("zmux-95421485", "session-a")]);

    expect(selectBeadConversationLinks(index, "ghostex-95421485").map((entry) => entry.id)).toEqual([
      "zmux-95421485:session-a",
    ]);
  });

  test("should group pre-rename and post-rename links under one bead", () => {
    const index = indexBeadConversationLinksByBead([
      link("ghostex-95421485", "session-b"),
      link("zmux-95421485", "session-a"),
    ]);

    expect(selectBeadConversationLinks(index, "ghostex-95421485").map((entry) => entry.id)).toEqual([
      "ghostex-95421485:session-b",
      "zmux-95421485:session-a",
    ]);
  });

  test("should not match links belonging to a different bead", () => {
    const index = indexBeadConversationLinksByBead([link("zmux-95421485", "session-a")]);

    expect(selectBeadConversationLinks(index, "ghostex-11112222")).toEqual([]);
  });

  test("should match hyphenated prefixes on the trailing issue id only", () => {
    expect(beadConversationLinkMatchKey("agent-bo-95421485")).toBe("95421485");
    expect(beadConversationLinkMatchKey(" ZMUX-95421485 ")).toBe("95421485");
    expect(beadConversationLinkMatchKey("95421485")).toBe("95421485");
    expect(beadConversationLinkMatchKey("zmux-")).toBe("zmux-");
  });

  test("should return no links for a bead nothing was ever linked to", () => {
    expect(selectBeadConversationLinks(indexBeadConversationLinksByBead([]), "zmux-1")).toEqual([]);
  });
});
