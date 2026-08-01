// Per-agent session-option catalogs for the composer footer pills
// (upstream chat spec §1.2-§1.4 port).
//
// The agent is a TUI: there is no API to set a model or a reasoning effort,
// only keystrokes. So every option here is DELIVERED as a slash command (or a
// raw key) typed into the running agent and the value we show is LOCAL:
//   - "default" — what the agent starts with, per the catalog
//   - "dispatched" — we typed the command; the agent has not confirmed it
// There is deliberately no PTY-scrape confirmation, so `dispatched` is the
// strongest claim this surface makes and the pill says so in its tooltip.
//
// Agents without a catalog (grok, unknown ids) get no pills at all.

import type { SessionChatSendKey } from "../../shared/session-chat";

export type SessionChatOptionCategory =
  | "model"
  | "thought_level"
  | "model_config"
  | "mode";

/** Options-pill ordering (§1.2); the model category has its own pill. */
const CATEGORY_ORDER: Record<SessionChatOptionCategory, number> = {
  model: -1,
  thought_level: 0,
  model_config: 1,
  mode: 2,
};

export interface SessionChatOptionChoice {
  value: string;
  label: string;
  description?: string;
}

export type SessionChatOptionDispatch =
  /** Types `build(value)` into the TUI; the chosen value becomes the local truth. */
  | { kind: "command"; build: (value: string) => string }
  /** Types a fixed command that FLIPS an unknown baseline (no value tracked). */
  | { kind: "toggle-command"; command: string }
  /** Types a command that opens the agent's own picker, then shows the terminal. */
  | { kind: "agent-picker"; command: string }
  /** Writes a raw keystroke sequence (no text, no Enter). */
  | { kind: "key"; key: SessionChatSendKey; marker: string };

export interface SessionChatOptionDescriptor {
  /** Stable per agent; also the persistence key. */
  id: string;
  /** Category name, e.g. "Effort" — shown in the tooltip, not in the pill. */
  label: string;
  category: SessionChatOptionCategory;
  dispatch: SessionChatOptionDispatch;
  /** Present for value-carrying (select) options only. */
  choices?: readonly SessionChatOptionChoice[];
  defaultValue?: string;
  /** Row label for toggle / agent-picker / key rows. */
  actionLabel?: string;
  /** Muted line under the menu heading. */
  description?: string;
}

export interface SessionChatSessionOptionCatalog {
  /** The model pill's descriptor (category "model"). */
  model: SessionChatOptionDescriptor;
  /** Everything else, in category order, for the current model. */
  optionsForModel: (modelValue: string) => readonly SessionChatOptionDescriptor[];
}

// ---------------------------------------------------------------------------
// Claude / OpenClaude
// ---------------------------------------------------------------------------

const CLAUDE_MODELS: readonly SessionChatOptionChoice[] = [
  { value: "fable", label: "Fable 5" },
  { value: "opus", label: "Opus 4.8" },
  { value: "sonnet", label: "Sonnet 5" },
  { value: "haiku", label: "Haiku" },
];

const CLAUDE_EFFORTS: readonly SessionChatOptionChoice[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra high" },
  { value: "max", label: "Max" },
];

const CLAUDE_MODEL: SessionChatOptionDescriptor = {
  id: "model",
  label: "Model",
  category: "model",
  choices: CLAUDE_MODELS,
  defaultValue: "sonnet",
  dispatch: { kind: "command", build: (value) => `/model ${value}` },
};

const CLAUDE_EFFORT: SessionChatOptionDescriptor = {
  id: "effort",
  label: "Effort",
  category: "thought_level",
  choices: CLAUDE_EFFORTS,
  defaultValue: "high",
  dispatch: { kind: "command", build: (value) => `/effort ${value}` },
};

const CLAUDE_FAST_MODE: SessionChatOptionDescriptor = {
  id: "fastMode",
  label: "Fast mode",
  category: "model_config",
  actionLabel: "Toggle Fast mode",
  description: "Flips fast mode; the current state is only known to the agent.",
  dispatch: { kind: "toggle-command", command: "/fast" },
};

/*
Permission mode is Shift+Tab in Claude Code's TUI — it has no slash command,
so it is delivered as a raw keystroke through sendSessionChatMessage's `key`
param. Cycling is blind (the TUI owns the order), which is exactly the
"toggle-command" shape: an action row, no tracked value.
*/
const CLAUDE_MODE: SessionChatOptionDescriptor = {
  id: "mode",
  label: "Mode",
  category: "mode",
  actionLabel: "Cycle mode (Shift+Tab)",
  description: "Steps through Claude Code's permission modes.",
  dispatch: { kind: "key", key: "shift-tab", marker: "Sent Shift+Tab (mode cycle)" },
};

// ---------------------------------------------------------------------------
// Codex
// ---------------------------------------------------------------------------

const CODEX_MODELS: readonly SessionChatOptionChoice[] = [
  { value: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
  { value: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
  { value: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
  { value: "gpt-5.5", label: "GPT-5.5" },
  { value: "gpt-5.2-codex", label: "GPT-5.2 Codex" },
];

const CODEX_EFFORTS: readonly SessionChatOptionChoice[] = [
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra high" },
];

/** Luna has no extra-high tier. */
export function codexEffortChoices(
  modelValue: string,
): readonly SessionChatOptionChoice[] {
  return modelValue === "gpt-5.6-luna"
    ? CODEX_EFFORTS.filter((choice) => choice.value !== "xhigh")
    : CODEX_EFFORTS;
}

/*
Codex sets model AND reasoning effort in one interactive `/model` overlay that
cannot be driven blind (the row order changes with the model). So both are
agent-picker options: we type `/model`, then flip the pane to the terminal so
the user finishes in the TUI. Nothing is claimed about the resulting value.
*/
const CODEX_MODEL: SessionChatOptionDescriptor = {
  id: "model",
  label: "Model",
  category: "model",
  choices: CODEX_MODELS,
  actionLabel: "Choose in agent picker…",
  description: "Codex picks the model in its own overlay.",
  dispatch: { kind: "agent-picker", command: "/model" },
};

const CODEX_EFFORT: SessionChatOptionDescriptor = {
  id: "effort",
  label: "Reasoning effort",
  category: "thought_level",
  actionLabel: "Choose in agent picker…",
  description: "Set together with the model in Codex's /model overlay.",
  dispatch: { kind: "agent-picker", command: "/model" },
};

const CODEX_MODE: SessionChatOptionDescriptor = {
  id: "mode",
  label: "Mode",
  category: "mode",
  actionLabel: "Switch to Plan mode",
  dispatch: { kind: "command", build: () => "/plan" },
};

// ---------------------------------------------------------------------------
// Catalog resolution
// ---------------------------------------------------------------------------

const CLAUDE_CATALOG: SessionChatSessionOptionCatalog = {
  model: CLAUDE_MODEL,
  optionsForModel: (modelValue) =>
    sortDescriptors([
      // Haiku has no effort tiers.
      ...(modelValue === "haiku" ? [] : [CLAUDE_EFFORT]),
      ...(modelValue === "opus" ? [CLAUDE_FAST_MODE] : []),
      CLAUDE_MODE,
    ]),
};

const CODEX_CATALOG: SessionChatSessionOptionCatalog = {
  model: CODEX_MODEL,
  optionsForModel: (modelValue) =>
    sortDescriptors([
      { ...CODEX_EFFORT, choices: codexEffortChoices(modelValue) },
      CODEX_MODE,
    ]),
};

function sortDescriptors(
  descriptors: readonly SessionChatOptionDescriptor[],
): readonly SessionChatOptionDescriptor[] {
  return [...descriptors].sort(
    (left, right) => CATEGORY_ORDER[left.category] - CATEGORY_ORDER[right.category],
  );
}

const CATALOG_BY_AGENT: Record<string, SessionChatSessionOptionCatalog> = {
  claude: CLAUDE_CATALOG,
  openclaude: CLAUDE_CATALOG,
  codex: CODEX_CATALOG,
};

export function sessionChatSessionOptionCatalog(
  agent: string | null | undefined,
): SessionChatSessionOptionCatalog | null {
  if (agent === null || agent === undefined) {
    return null;
  }
  return CATALOG_BY_AGENT[agent] ?? null;
}

/**
 * Command names the option pills can type, so classifySessionChatSend renders
 * a dispatched pill command as the same muted "Ran /model sonnet" row a typed
 * command gets. Names only (no slash), matching the slash-command catalog.
 */
export function sessionChatOptionCommandNames(
  agent: string | null | undefined,
): readonly string[] {
  const catalog = sessionChatSessionOptionCatalog(agent);
  if (!catalog) {
    return [];
  }
  const names = new Set<string>();
  const collect = (descriptor: SessionChatOptionDescriptor): void => {
    const { dispatch } = descriptor;
    const command =
      dispatch.kind === "command"
        ? dispatch.build(descriptor.choices?.[0]?.value ?? "")
        : dispatch.kind === "toggle-command" || dispatch.kind === "agent-picker"
          ? dispatch.command
          : null;
    if (command === null) {
      return;
    }
    const name = command.trim().split(/\s+/, 1)[0]?.replace(/^\//, "") ?? "";
    if (name !== "") {
      names.add(name);
    }
  };
  collect(catalog.model);
  // Union over every model, so a name only reachable under one model (Claude's
  // /fast) still classifies as a command.
  for (const choice of catalog.model.choices ?? [{ value: "", label: "" }]) {
    for (const descriptor of catalog.optionsForModel(choice.value)) {
      collect(descriptor);
    }
  }
  return [...names];
}

// ---------------------------------------------------------------------------
// Local value state
// ---------------------------------------------------------------------------

export type SessionChatOptionSource = "default" | "dispatched";

export interface SessionChatOptionValue {
  value: string;
  source: SessionChatOptionSource;
}

/** Descriptor id → local value. Only value-carrying options appear. */
export type SessionChatOptionState = Readonly<
  Record<string, SessionChatOptionValue>
>;

export const SESSION_CHAT_DISPATCHED_HINT = "Sent to the agent — not confirmed";

function isTrackedValue(
  descriptor: SessionChatOptionDescriptor,
  value: string,
): boolean {
  return (descriptor.choices ?? []).some((choice) => choice.value === value);
}

/** Value-carrying descriptors: a select the pills can label from. */
export function sessionChatOptionTracksValue(
  descriptor: SessionChatOptionDescriptor,
): boolean {
  return (
    descriptor.dispatch.kind === "command" &&
    descriptor.choices !== undefined &&
    descriptor.choices.length > 0 &&
    descriptor.defaultValue !== undefined
  );
}

export function seedSessionChatOptionState(
  catalog: SessionChatSessionOptionCatalog,
  stored: SessionChatOptionState = {},
): SessionChatOptionState {
  const next: Record<string, SessionChatOptionValue> = {};
  const seed = (descriptor: SessionChatOptionDescriptor): void => {
    if (!sessionChatOptionTracksValue(descriptor) || next[descriptor.id]) {
      return;
    }
    const storedValue = stored[descriptor.id];
    if (storedValue && isTrackedValue(descriptor, storedValue.value)) {
      next[descriptor.id] = storedValue;
      return;
    }
    if (descriptor.defaultValue !== undefined) {
      next[descriptor.id] = { value: descriptor.defaultValue, source: "default" };
    }
  };
  seed(catalog.model);
  const modelValue = next[catalog.model.id]?.value ?? catalog.model.defaultValue ?? "";
  for (const descriptor of catalog.optionsForModel(modelValue)) {
    seed(descriptor);
  }
  return next;
}

export function setSessionChatOptionValue(
  state: SessionChatOptionState,
  descriptorId: string,
  value: string,
  source: SessionChatOptionSource,
): SessionChatOptionState {
  const current = state[descriptorId];
  if (current?.value === value && current.source === source) {
    return state;
  }
  return { ...state, [descriptorId]: { value, source } };
}

/**
 * A command the USER typed reconciles the pills: `/model opus` makes the model
 * pill read Opus without a second dispatch. Exact match against the catalog's
 * own builders, so an unrelated `/model` argument is ignored.
 */
export function reconcileSessionChatOptionsFromCommand(
  catalog: SessionChatSessionOptionCatalog,
  state: SessionChatOptionState,
  text: string,
): SessionChatOptionState {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (!normalized.startsWith("/")) {
    return state;
  }
  const modelValue = state[catalog.model.id]?.value ?? catalog.model.defaultValue ?? "";
  const descriptors = [catalog.model, ...catalog.optionsForModel(modelValue)];
  let next = state;
  for (const descriptor of descriptors) {
    if (descriptor.dispatch.kind !== "command") {
      continue;
    }
    for (const choice of descriptor.choices ?? []) {
      if (descriptor.dispatch.build(choice.value) === normalized) {
        next = setSessionChatOptionValue(
          next,
          descriptor.id,
          choice.value,
          "dispatched",
        );
      }
    }
  }
  return next;
}

/** Pill label: the value's label, or null when nothing is known. */
export function sessionChatOptionValueLabel(
  descriptor: SessionChatOptionDescriptor,
  state: SessionChatOptionState,
): string | null {
  const current = state[descriptor.id];
  if (!current) {
    return null;
  }
  return (
    descriptor.choices?.find((choice) => choice.value === current.value)?.label ?? null
  );
}

/** Options-pill label: known non-model values joined by " · " (§1.2). */
export function sessionChatOptionsPillLabel(
  descriptors: readonly SessionChatOptionDescriptor[],
  state: SessionChatOptionState,
): string | null {
  const labels = descriptors
    .map((descriptor) => sessionChatOptionValueLabel(descriptor, state))
    .filter((label): label is string => label !== null);
  return labels.length > 0 ? labels.join(" · ") : null;
}

// ---------------------------------------------------------------------------
// Persistence — last dispatched values per session
// ---------------------------------------------------------------------------

const STORAGE_PREFIX = "ghostex.sessionChat.options.";

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    // Storage disabled by the embedder: pills still work, just per-mount.
    return null;
  }
}

export function readStoredSessionChatOptions(
  sessionKey: string | null | undefined,
): SessionChatOptionState {
  if (!sessionKey) {
    return {};
  }
  const raw = storage()?.getItem(`${STORAGE_PREFIX}${sessionKey}`);
  if (!raw) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  const next: Record<string, SessionChatOptionValue> = {};
  for (const [id, entry] of Object.entries(parsed as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const { source, value } = entry as { source?: unknown; value?: unknown };
    if (typeof value === "string" && (source === "default" || source === "dispatched")) {
      next[id] = { value, source };
    }
  }
  return next;
}

export function writeStoredSessionChatOptions(
  sessionKey: string | null | undefined,
  state: SessionChatOptionState,
): void {
  if (!sessionKey) {
    return;
  }
  try {
    storage()?.setItem(`${STORAGE_PREFIX}${sessionKey}`, JSON.stringify(state));
  } catch {
    // Quota/private-mode failures must not break sending.
  }
}
