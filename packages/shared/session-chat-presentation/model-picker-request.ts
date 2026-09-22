import { agentModelCatalogEffortLabel, type AgentModelCatalog } from '@/packages/shared/agent-model-catalog';
import type { ModelPickerRequest, ModelPickerProvider } from '@/packages/shared/session-chat-presentation/model-picker';

/**
 * CDXC:SessionChat 2026-09-22 DECISION: User: new models and quick picker changes must reach customers without an app release.
 * Card order, card names and hidden cards come from the catalog (`quickPickerOrder`, `quickPickerLabel`, `quickPickerHidden`),
 * which is where the earlier decisions now live: Cursor's hand-picked order with Grok 4.7 above Grok 4.6, Antigravity's
 * Gemini-first order, the short Claude and Codex names, and no 200K Opus card (it stays in the full model menu as that
 * row's Context Window choice).
 */
function quickPickerRank(order: readonly string[] | undefined, value: string): number {
  const index = order?.indexOf(value) ?? -1;
  return index === -1 ? (order?.length ?? 0) : index;
}

function codexCardVersion(label: string, cardLabel: string | undefined): string {
  if (!cardLabel || !label.endsWith(cardLabel)) return label;
  const version = label.slice(0, label.length - cardLabel.length);
  return /\s$/.test(version) ? version.trimEnd() : label;
}

/** CDXC:SessionChat 2026-09-09 DECISION: User: Cursor, Grok Build and Antigravity get the quick picker with white accents and one standard icon for every model. */
export function modelPickerProvider(icon?: string): ModelPickerProvider | undefined {
  if (icon === 'claude' || icon === 'codex') return icon;
  if (icon === 'cursor-cli' || icon === 'cursor') return 'cursor';
  if (icon === 'grok-build' || icon === 'grok') return 'grok';
  if (icon === 'antigravity-cli' || icon === 'antigravity') return 'antigravity';
}

/** Shared by the in-pane chat picker and the terminal's native modal host. */
export function createModelPickerRequest(
  catalog: AgentModelCatalog,
  provider: ModelPickerProvider,
  selectedModel?: string,
  selectedEffort?: string
): ModelPickerRequest | undefined {
  const agent = catalog.agents[provider];
  if (!agent) return;
  const order = agent.quickPickerOrder;
  const models = agent.models
    // CDXC:SessionChat 2026-09-09 DECISION: User: keep only the selected models in the quick picker, exclude Cursor Composer too, and retain every other model under Legacy in the normal picker.
    .filter((model) => !model.group && !model.quickPickerHidden)
    .sort((a, b) => quickPickerRank(order, a.value) - quickPickerRank(order, b.value))
    .map((model) => ({
      value: model.value,
      label: model.quickPickerLabel ?? model.label,
      // Codex's cards show the codename big and the version under it: "GPT 6 Astra" is "Astra" over "GPT 6".
      version: provider === 'codex' ? codexCardVersion(model.label, model.quickPickerLabel) : undefined,
      efforts: model.efforts.map((value) => ({ value, label: agentModelCatalogEffortLabel(catalog, value) })),
      defaultEffort: model.defaultEffort ?? agent.defaultEffort,
    }));
  // Detection may not have arrived yet. The catalog default is a starting cursor, not a claim about the running agent.
  const model =
    models.find((entry) => entry.value === selectedModel) ??
    models.find((entry) => entry.value === agent.models.find((model) => model.default)?.value) ??
    models[0];
  if (!model) return;
  const effort =
    model.efforts.find((entry) => entry.value === selectedEffort)?.value ??
    model.efforts.find((entry) => entry.value === model.defaultEffort)?.value ??
    model.efforts[0]?.value ??
    '';
  const efforts = agent.efforts.map((value) => ({ value, label: agentModelCatalogEffortLabel(catalog, value) }));
  return {
    requestId: crypto.randomUUID(),
    provider,
    models,
    efforts,
    model: model.value,
    effort,
  };
}
