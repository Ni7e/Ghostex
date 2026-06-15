import {
  IconBrowser,
  IconCode,
  IconLayoutKanban,
  IconPencil,
  IconTerminal2,
  IconStack2,
} from "@tabler/icons-react";
import { useEffect, useId, useMemo, useState, type ComponentType } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { SidebarTheme } from "../shared/session-grid-contract";
import agentsTerminalSplitsImage from "../media/readme/ghostex-agents-terminal-splits.png";
import chromiumDesignModeImage from "../media/readme/ghostex-chromium-design-mode.png";
import embeddedVscodeEditorImage from "../media/readme/ghostex-embedded-vscode-editor.png";
import kanbanBeadsBoardImage from "../media/readme/ghostex-kanban-beads-board.png";
import richPromptEditorImage from "../media/readme/ghostex-rich-prompt-editor-ctrl-g.png";

export type DiscoverGhostexModalProps = {
  isOpen: boolean;
  onClose: () => void;
  theme?: SidebarTheme;
};

type DiscoverGhostexFeature = {
  description: string;
  icon: ComponentType<{ className?: string; size?: number; stroke?: number }>;
  id: string;
  imageAlt: string;
  imageSrc: string;
  thumbnailTitle: string;
  title: string;
};

/*
 * CDXC:DiscoverGhostex 2026-06-16-00:26:
 * Discover Ghostex is a replayable feature-tour modal, not first-run setup.
 * It intentionally copies the first-launch modal shell while using the requested tour layout: left feature title and description, a large right-side feature image, and bottom thumbnail selectors.
 *
 * CDXC:DiscoverGhostex 2026-06-16-02:01:
 * The tour must use real README.md product screenshots and fitting README copy instead of placeholder image blocks. Keep thumbnail labels short so the five-tile strip stays balanced, while the main panel can use the longer README-derived headings and descriptions.
 */
const DISCOVER_GHOSTEX_FEATURES: readonly DiscoverGhostexFeature[] = [
  {
    description: "Great for working with markdown, reviewing code, and checking PRs.",
    icon: IconCode,
    id: "embedded-vscode-editor",
    imageAlt: "Ghostex embedded VS Code based editor",
    imageSrc: embeddedVscodeEditorImage,
    thumbnailTitle: "VS Code Editor",
    title: "Embedded VS Code Based Editor",
  },
  {
    description:
      "Split your terminals and use keyboard hotkeys to jump between terminals in the Agents view.",
    icon: IconTerminal2,
    id: "agent-terminal-splits",
    imageAlt: "Ghostex split terminals in the Agents view",
    imageSrc: agentsTerminalSplitsImage,
    thumbnailTitle: "Agent Splits",
    title: "Agent Terminal Splits",
  },
  {
    description:
      "Embedded Chromium browser panes include Design Mode, DevTools, Agent Browser Control, and profiles.",
    icon: IconBrowser,
    id: "chromium-design-mode",
    imageAlt: "Ghostex embedded Chromium Browser with Design mode",
    imageSrc: chromiumDesignModeImage,
    thumbnailTitle: "Chromium Browser",
    title: "Chromium Browser With Design Mode",
  },
  {
    description:
      "Dump notes into a Beads board, then let an orchestrator agent hand them off to other agents.",
    icon: IconLayoutKanban,
    id: "beads-kanban-board",
    imageAlt: "Ghostex Kanban board based on beads",
    imageSrc: kanbanBeadsBoardImage,
    thumbnailTitle: "Beads Kanban",
    title: "Beads Kanban Board",
  },
  {
    description: "Edit agent prompts with full hotkey support and image previews from Ctrl+G.",
    icon: IconPencil,
    id: "rich-prompt-editor",
    imageAlt: "Ghostex Rich Prompt Editor with ctrl + g",
    imageSrc: richPromptEditorImage,
    thumbnailTitle: "Prompt Editor",
    title: "Rich Prompt Editor With Ctrl+G",
  },
];

export function DiscoverGhostexModal({
  isOpen,
  onClose,
  theme = "dark-blue",
}: DiscoverGhostexModalProps) {
  const titleId = useId();
  const [activeFeatureId, setActiveFeatureId] = useState(DISCOVER_GHOSTEX_FEATURES[0].id);
  const activeFeature = useMemo(
    () =>
      DISCOVER_GHOSTEX_FEATURES.find((feature) => feature.id === activeFeatureId) ??
      DISCOVER_GHOSTEX_FEATURES[0],
    [activeFeatureId],
  );
  const ActiveFeatureIcon = activeFeature.icon;

  useEffect(() => {
    if (isOpen) {
      setActiveFeatureId(DISCOVER_GHOSTEX_FEATURES[0].id);
    }
  }, [isOpen]);

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
      open={isOpen}
    >
      <DialogContent
        aria-labelledby={titleId}
        className={cn(
          "ghostex-settings-shadcn settings-modal-dialog first-launch-setup-modal-dialog discover-ghostex-modal-dialog flex flex-col gap-0 overflow-hidden p-0 font-sans",
          getSidebarThemeVariant(theme) === "dark" && "dark",
        )}
        data-sidebar-theme={theme}
      >
        <DialogHeader className="sr-only">
          <DialogTitle id={titleId}>Discover Ghostex</DialogTitle>
        </DialogHeader>

        <div className="discover-ghostex-body">
          <section
            aria-labelledby="discover-ghostex-feature-title"
            className="discover-ghostex-feature-stage"
            id="discover-ghostex-feature-panel"
            role="tabpanel"
          >
            <div className="discover-ghostex-feature-copy">
              <span className="discover-ghostex-feature-icon">
                <ActiveFeatureIcon aria-hidden="true" size={22} stroke={1.8} />
              </span>
              <h2 className="discover-ghostex-feature-title" id="discover-ghostex-feature-title">
                {activeFeature.title}
              </h2>
              <p className="discover-ghostex-feature-description">
                {activeFeature.description}
              </p>
            </div>
            <div
              className="discover-ghostex-feature-visual"
            >
              <img
                alt={activeFeature.imageAlt}
                className="discover-ghostex-feature-image"
                decoding="async"
                src={activeFeature.imageSrc}
              />
            </div>
          </section>

          <div className="discover-ghostex-feature-strip" role="tablist" aria-label="Discover Ghostex features">
            {DISCOVER_GHOSTEX_FEATURES.map((feature) => {
              const FeatureIcon = feature.id === "agent-terminal-splits" ? IconStack2 : feature.icon;
              const isActive = feature.id === activeFeature.id;
              return (
                <button
                  aria-controls="discover-ghostex-feature-panel"
                  aria-selected={isActive}
                  className="discover-ghostex-thumbnail-button"
                  data-active={isActive}
                  key={feature.id}
                  onClick={() => setActiveFeatureId(feature.id)}
                  role="tab"
                  type="button"
                >
                  <span className="discover-ghostex-thumbnail-title">
                    {feature.thumbnailTitle}
                  </span>
                  <span className="discover-ghostex-thumbnail-visual" aria-hidden="true">
                    <img
                      alt=""
                      className="discover-ghostex-thumbnail-image"
                      decoding="async"
                      loading="lazy"
                      src={feature.imageSrc}
                    />
                    <span className="discover-ghostex-thumbnail-icon">
                      <FeatureIcon size={18} stroke={1.8} />
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function getSidebarThemeVariant(theme: SidebarTheme): "dark" | "light" {
  return theme.startsWith("light-") || theme === "plain-light" ? "light" : "dark";
}
