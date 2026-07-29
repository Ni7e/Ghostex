import { IconFolder, IconMessageCircle, IconTerminal2, IconWorld } from "@tabler/icons-react";
import type { CSSProperties } from "react";
import type { SidebarSessionItem } from "../../shared/session-grid-contract";
import {
  resolveWorkspaceProjectIconDataUrl,
  type WorkspaceProjectIcon,
} from "../../shared/workspace-project-appearance";
import { AGENT_LOGOS, COLORED_AGENT_LOGOS } from "../agent-logos";
import { SidebarCommandIconGlyph } from "../sidebar-command-icon";

/*
 * CDXC:SidebarV2 2026-07-29:
 * V2 renders its own leading icons rather than reusing the V1 session-card
 * icon stack. The V1 component is a positioned overlay glued to the card's
 * hover/close/timer chrome; V2 needs a plain inline 16px glyph in normal flow.
 * The ASSETS are shared (`agent-logos`), so agent identity can never drift
 * between the two sidebars even though the boxes differ.
 */

type SidebarV2AgentLogoStyle = CSSProperties & {
  "--session-agent-logo": string;
  "--session-agent-logo-colored": string;
};

export type SidebarV2SessionIconProps = {
  agentIcon: SidebarSessionItem["agentIcon"];
  faviconDataUrl?: string;
  isBrowser: boolean;
  /** Mirrors the Session Cards "colored agent icons" setting. */
  useColoredAgentIcons: boolean;
};

export function SidebarV2SessionIcon({
  agentIcon,
  faviconDataUrl,
  isBrowser,
  useColoredAgentIcons,
}: SidebarV2SessionIconProps) {
  if (isBrowser || agentIcon === "browser") {
    if (faviconDataUrl) {
      return (
        <img
          alt=""
          aria-hidden="true"
          className="sidebar-v2-session-icon"
          data-icon-variant="favicon"
          src={faviconDataUrl}
        />
      );
    }
    return (
      <IconWorld
        aria-hidden="true"
        className="sidebar-v2-session-icon"
        data-icon-variant="glyph"
        size={16}
        stroke={1.8}
      />
    );
  }

  if (agentIcon === "t3") {
    return (
      <IconMessageCircle
        aria-hidden="true"
        className="sidebar-v2-session-icon"
        data-icon-variant="glyph"
        size={16}
        stroke={1.8}
      />
    );
  }

  if (!agentIcon) {
    return (
      <IconTerminal2
        aria-hidden="true"
        className="sidebar-v2-session-icon"
        data-icon-variant="glyph"
        size={16}
        stroke={1.8}
      />
    );
  }

  const logoStyle: SidebarV2AgentLogoStyle = {
    "--session-agent-logo": `url("${AGENT_LOGOS[agentIcon]}")`,
    "--session-agent-logo-colored": `url("${COLORED_AGENT_LOGOS[agentIcon]}")`,
  };
  return (
    <span
      aria-hidden="true"
      className="sidebar-v2-session-icon"
      data-agent-icon={agentIcon}
      data-icon-variant={useColoredAgentIcons ? "logo-colored" : "logo"}
      style={logoStyle}
    />
  );
}

/*
 * CDXC:SidebarV2ProjectIcons 2026-07-29:
 * A project's identity is the icon the user picked for it, and in Ghostex that
 * is USUALLY a Tabler glyph with a color rather than an uploaded image — so a
 * surface that reads only `iconDataUrl` shows a generic folder for almost every
 * project. The resolution order mirrors `RecentProjectIcon` exactly (image →
 * Tabler glyph → folder) so the same project reads the same in the inbox, the
 * group headers, the scope menu, and the Recent Projects drawer.
 */
export type SidebarV2ProjectIconProps = {
  icon?: WorkspaceProjectIcon;
  iconDataUrl?: string;
  title: string;
};

export function SidebarV2ProjectIcon({ icon, iconDataUrl, title }: SidebarV2ProjectIconProps) {
  const imageDataUrl = resolveWorkspaceProjectIconDataUrl({ icon, iconDataUrl });
  if (imageDataUrl) {
    return (
      <img
        alt=""
        aria-hidden="true"
        className="sidebar-v2-project-icon"
        data-icon-variant="image"
        src={imageDataUrl}
        title={title}
      />
    );
  }
  if (icon?.kind === "tabler") {
    /*
     * The glyph is wrapped rather than styled directly because the shared
     * V1 glyph component owns its own svg attributes: the wrapper keeps the
     * 16px box identical to the image and folder variants and carries the
     * state hook, without teaching a V1 component about V2's markup.
     */
    return (
      <span
        aria-hidden="true"
        className="sidebar-v2-project-icon"
        data-icon-variant="tabler"
        title={title}
      >
        <SidebarCommandIconGlyph color={icon.color} icon={icon.icon} size={16} stroke={1.8} />
      </span>
    );
  }
  return (
    <IconFolder
      aria-hidden="true"
      className="sidebar-v2-project-icon"
      data-icon-variant="glyph"
      size={16}
      stroke={1.8}
    />
  );
}
