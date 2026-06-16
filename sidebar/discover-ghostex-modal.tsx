import {
  IconChevronLeft,
  IconChevronRight,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useId, useMemo, useState } from "react";
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
  id: string;
  imageAlt: string;
  imageSrc: string;
  thumbnailTitle: string;
  title: string;
};

/*
 * CDXC:DiscoverGhostex 2026-06-16-00:26:
 * The discoverGhostex modal is a replayable feature tour, not first-run setup.
 * It intentionally copies the first-launch modal shell while using a replayable
 * feature-tour layout with README screenshots and bottom thumbnail selectors.
 *
 * CDXC:DiscoverGhostex 2026-06-16-02:01:
 * The tour must use real README.md product screenshots and fitting README copy instead of placeholder image blocks. Keep thumbnail labels short so the five-tile strip stays balanced, while the main panel can use the longer README-derived headings and descriptions.
 *
 * CDXC:HighlightedFeatures 2026-06-16-08:17:
 * The replayable feature-tour modal is user-facing as Highlighted Features.
 * Keep the internal discoverGhostex component name and modal id so existing
 * first-run sequencing and native close handling stay stable.
 *
 * CDXC:HighlightedFeatures 2026-06-16-08:41:
 * The modal must load visible README screenshot assets, not the earlier tiny
 * skeleton placeholder PNGs, because the feature tour reads as broken when the
 * picture strip resolves but only shows abstract color blocks.
 *
 * CDXC:HighlightedFeatures 2026-06-16-08:54:
 * Put the feature title and description side by side above the screenshot so
 * the image can span the modal width. Fit the screenshot inside a thin frame so
 * users can inspect the complete README image without cropped edges.
 *
 * CDXC:HighlightedFeatures 2026-06-16-11:24:
 * The five highlighted-feature pages use the product-order and copy provided
 * by the content revamp: Rich Prompt Editor, Browser & Design Mode, Full
 * Embedded Editor, Kanban Board & Beads, and Full Layout Freedom.
 *
 * CDXC:HighlightedFeatures 2026-06-16-12:15:
 * Earlier Highlighted Features closed through outside-click/Escape/native
 * modal handling and did not show an in-modal X button.
 *
 * CDXC:HighlightedFeatures 2026-06-16-12:35:
 * The title should no longer be width-limited. Put the subtitle directly under
 * the title in the same text stack.
 *
 * CDXC:HighlightedFeatures 2026-06-16-12:45:
 * Thumbnail previews should not carry extra overlay icons. Keep the thumbnails
 * slightly darker and make image outlines quieter so the screenshots, not the
 * frames, dominate the tour.
 *
 * CDXC:HighlightedFeatures 2026-06-16-13:45:
 * Put thumbnail labels inside each thumbnail as a dark bottom caption and add
 * left/right image navigation buttons that loop across the five feature pages.
 *
 * CDXC:HighlightedFeatures 2026-06-16-14:08:
 * Keep carousel arrows beside the main screenshot instead of over it. The main
 * screenshot should render with an even quiet outline, and bottom thumbnails
 * should not have persistent outlines.
 *
 * CDXC:HighlightedFeatures 2026-06-16-18:27:
 * Some authored screenshots have transparent rounded window corners. Do not
 * put feature-tile backgrounds behind screenshots, because those backgrounds
 * bleed through the image alpha at the corners.
 *
 * CDXC:HighlightedFeatures 2026-06-16-18:48:
 * Do not show a feature icon beside the Highlighted Features title. The modal
 * header should be title/subtitle text only so the screenshots are the primary
 * visual signal.
 *
 * CDXC:HighlightedFeatures 2026-06-16-19:50:
 * Highlighted Features should not dismiss from outside clicks. Close it from
 * the top-right X button, Escape, or native close paths while keeping the X
 * aligned with the First Time Setup modal close button.
 */
const DISCOVER_GHOSTEX_FEATURES: readonly DiscoverGhostexFeature[] = [
  {
    id: "rich-prompt-editor",
    thumbnailTitle: "Rich Prompt Editor",
    title: "Rich Prompt Editor with Ctrl + G",
    description: "Edit your agent prompts with full hotkeys support and even image previews!",
    imageAlt: "Ghostex Rich Prompt Editor with Ctrl + G",
    imageSrc: richPromptEditorImage,
  },
  {
    id: "chromium-design-mode",
    thumbnailTitle: "Browser & Design Mode",
    title: "Chromium Browser with Design Mode",
    description:
      "Comes with Devtools, Agent Browser Control, and Profiles mgmt. You agent can control it with the /ghostex-browser-use skill.",
    imageAlt: "Ghostex Chromium Browser with Design Mode",
    imageSrc: chromiumDesignModeImage,
  },
  {
    id: "embedded-vscode-editor",
    thumbnailTitle: "Full Embedded Editor",
    title: "Full VS Code Based Editor Built-in",
    description:
      "Great for working with markdown, reviewing code, and checking PRs (Github Extension is great!)",
    imageAlt: "Ghostex Full VS Code Based Editor Built-in",
    imageSrc: embeddedVscodeEditorImage,
  },
  {
    id: "beads-kanban-board",
    thumbnailTitle: "Kanban Board & Beads",
    title: "Manage Your Project on a Kanban board",
    description:
      "Store your ideas here then let an orchestrator agent hand them off to other agents (use the /ghostex-agent-orchestration skill)",
    imageAlt: "Ghostex Kanban Board and Beads",
    imageSrc: kanbanBeadsBoardImage,
  },
  {
    id: "layout-freedom",
    thumbnailTitle: "Full Layout Freedom",
    title: "Full Layout Freedom",
    description:
      "Split your agent terminals anyway you like. Use the same hotkeys from ghostty to navigate the UI with keyboard only.",
    imageAlt: "Ghostex Full Layout Freedom",
    imageSrc: agentsTerminalSplitsImage,
  },
];

export function DiscoverGhostexModal({
  isOpen,
  onClose,
  theme = "dark-blue",
}: DiscoverGhostexModalProps) {
  const titleId = useId();
  const [activeFeatureId, setActiveFeatureId] = useState(DISCOVER_GHOSTEX_FEATURES[0].id);
  const activeFeatureIndex = useMemo(
    () =>
      Math.max(
        0,
        DISCOVER_GHOSTEX_FEATURES.findIndex((feature) => feature.id === activeFeatureId),
      ),
    [activeFeatureId],
  );
  const activeFeature = DISCOVER_GHOSTEX_FEATURES[activeFeatureIndex];
  const activateRelativeFeature = (offset: -1 | 1) => {
    const nextFeatureIndex =
      (activeFeatureIndex + offset + DISCOVER_GHOSTEX_FEATURES.length) %
      DISCOVER_GHOSTEX_FEATURES.length;
    setActiveFeatureId(DISCOVER_GHOSTEX_FEATURES[nextFeatureIndex].id);
  };

  useEffect(() => {
    if (isOpen) {
      setActiveFeatureId(DISCOVER_GHOSTEX_FEATURES[0].id);
    }
  }, [isOpen]);

  return (
    <Dialog
      disablePointerDismissal
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
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle id={titleId}>Highlighted Features</DialogTitle>
        </DialogHeader>
        <button
          aria-label="Close Highlighted Features"
          className="ghostex-modal-icon-close"
          onClick={onClose}
          type="button"
        >
          <IconX aria-hidden="true" />
        </button>

        <div className="discover-ghostex-body">
          <section
            aria-labelledby="discover-ghostex-feature-title"
            className="discover-ghostex-feature-stage"
            id="discover-ghostex-feature-panel"
            role="tabpanel"
          >
            <div className="discover-ghostex-feature-copy">
              <div className="discover-ghostex-feature-heading">
                <h2 className="discover-ghostex-feature-title" id="discover-ghostex-feature-title">
                  {activeFeature.title}
                </h2>
                <p className="discover-ghostex-feature-description">
                  {activeFeature.description}
                </p>
              </div>
            </div>
            <div className="discover-ghostex-feature-visual">
              <button
                aria-label="Previous highlighted feature"
                className="discover-ghostex-feature-nav-button discover-ghostex-feature-nav-button-left"
                onClick={() => activateRelativeFeature(-1)}
                type="button"
              >
                <IconChevronLeft aria-hidden="true" size={20} stroke={2} />
              </button>
              <img
                alt={activeFeature.imageAlt}
                className="discover-ghostex-feature-image"
                decoding="async"
                src={activeFeature.imageSrc}
              />
              <button
                aria-label="Next highlighted feature"
                className="discover-ghostex-feature-nav-button discover-ghostex-feature-nav-button-right"
                onClick={() => activateRelativeFeature(1)}
                type="button"
              >
                <IconChevronRight aria-hidden="true" size={20} stroke={2} />
              </button>
            </div>
          </section>

          <div className="discover-ghostex-feature-strip" role="tablist" aria-label="Highlighted features">
            {DISCOVER_GHOSTEX_FEATURES.map((feature) => {
              const isActive = feature.id === activeFeature.id;
              return (
                <button
                  aria-controls="discover-ghostex-feature-panel"
                  aria-label={feature.thumbnailTitle}
                  aria-selected={isActive}
                  className="discover-ghostex-thumbnail-button"
                  data-active={isActive}
                  key={feature.id}
                  onClick={() => setActiveFeatureId(feature.id)}
                  role="tab"
                  type="button"
                >
                  <span className="discover-ghostex-thumbnail-visual" aria-hidden="true">
                    <img
                      alt=""
                      className="discover-ghostex-thumbnail-image"
                      decoding="async"
                      loading="lazy"
                      src={feature.imageSrc}
                    />
                    <span className="discover-ghostex-thumbnail-title">
                      {feature.thumbnailTitle}
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
