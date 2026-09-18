import type { PreviewScenarioSnapshot } from './message';
import { agentsPreviewScenario } from './agents';
import { filesPreviewScenario } from './files';
import { historyPreviewScenario } from './history';
import { imagesPreviewScenario } from './images';
import { richMarkdownPreviewScenario } from './rich-markdown';
import { systemPreviewScenario } from './system';
import { toolsPreviewScenario } from './tools';

export { chatPreviewForkBranches, chatPreviewHistoryPage } from './history';
export { chatPreviewSubagentPage } from './tools';
export { PREVIEW_IMAGE_FILES } from './images';

/**
 * Scenarios whose sample is a transcript of its own rather than a variation of
 * the shared sample conversation. Each one owns a file beside this registry, so
 * a scenario can grow without the fixture becoming a single long file.
 */
const BUILDERS: Readonly<Record<string, () => PreviewScenarioSnapshot>> = {
  tools: toolsPreviewScenario,
  files: filesPreviewScenario,
  images: imagesPreviewScenario,
  system: systemPreviewScenario,
  'rich-markdown': richMarkdownPreviewScenario,
  agents: agentsPreviewScenario,
  history: historyPreviewScenario,
};

export const PREVIEW_SCENARIO_GROUP_IDS = Object.keys(BUILDERS);

/** What the named scenario overrides on the shared sample read result, or null when it owns none. */
export function chatPreviewScenarioOverride(scenario: string): PreviewScenarioSnapshot | null {
  const build = BUILDERS[scenario];
  return build ? build() : null;
}
