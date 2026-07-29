import { IconFolder, IconMessageCircle, IconTerminal2, IconWorld } from "@tabler/icons-react";
import type { CSSProperties } from "react";
import type { SidebarSessionItem } from "../../shared/session-grid-contract";
import { AGENT_LOGOS, COLORED_AGENT_LOGOS } from "../agent-logos";

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

export type SidebarV2ProjectIconProps = {
  iconDataUrl?: string;
  title: string;
};

export function SidebarV2ProjectIcon({ iconDataUrl, title }: SidebarV2ProjectIconProps) {
  if (iconDataUrl) {
    return (
      <img alt="" aria-hidden="true" className="sidebar-v2-project-icon" src={iconDataUrl} title={title} />
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
