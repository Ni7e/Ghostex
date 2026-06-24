<!--
CDXC:T3CodeUpstreamReset 2026-06-22-20:58:
The embedded T3 Code fork is being reset to upstream main before reapplying only the fixes that still matter.
Preserve notes about the Ghostex-local fork commits and their touched files so the next implementation pass can re-evaluate requirements against the new upstream code instead of blindly carrying old patches forward.

CDXC:T3CodeUpstreamReset 2026-06-22-21:00:
The tracked t3code submodule checkout has been reset to upstream/main at ea52bb1dbda115f9824415f7589505c9e57268c6.
Treat old Ghostex fork commits in this file as historical requirements to re-validate, not patches to apply automatically.
-->

# T3 Code Upstream Main Reset Notes

## Snapshot

- Current Ghostex submodule checkout: `5d80cc25df26e6529507f6bf84c6768f027abd66`
- Current upstream `main`: `ea52bb1dbda115f9824415f7589505c9e57268c6`
- Merge base: `4f0f24f055fe5f5346f7e73372e8cdc167e052f9`
- Divergence: Ghostex has 6 local commits; upstream has 388 commits after the merge base.
- Snapshot diff from current Ghostex checkout to upstream `main`: 5,376 tracked paths.
- Snapshot status counts: 4,536 added, 658 modified, 144 deleted, 38 renamed.

Top-level snapshot diff by path root:

```text
3439 .repos
1500 apps
 279 packages
  67 infra
  29 scripts
  23 docs
  11 oxlint-plugin-t3code
   6 patches
   4 .github
   1 vitest.config.ts
   1 vite.config.ts
   1 turbo.json
   1 tsconfig.base.json
   1 pnpm-workspace.yaml
   1 pnpm-lock.yaml
   1 package.json
   1 bun.lock
   1 README.md
   1 AGENTS.md
   1 .vscode
   1 .oxlintrc.json
   1 .oxfmtrc.json
   1 .mise.toml
   1 .macroscope
   1 .gitignore
   1 .env.example
   1 .docs
```

Use this command to reproduce the exact full snapshot path list:

```bash
git -C t3code diff --name-status ghostex..upstream/main
```

## Ghostex-Local Files

These are the files changed by the 6 Ghostex-local commits relative to the old upstream merge base. These are the useful reimplementation targets after resetting to upstream `main`.

```text
M apps/server/src/bootstrap.test.ts
M apps/server/src/bootstrap.ts
M apps/web/src/authBootstrap.test.ts
M apps/web/src/components/AppSidebarLayout.tsx
M apps/web/src/components/NoActiveThreadState.tsx
A apps/web/src/components/NotFoundState.tsx
A apps/web/src/components/ThreadStateScaffold.test.tsx
A apps/web/src/components/ThreadStateScaffold.tsx
M apps/web/src/components/chat/ChatComposer.tsx
M apps/web/src/components/chat/ChatHeader.tsx
M apps/web/src/components/ui/sidebar.tsx
M apps/web/src/environments/primary/auth.ts
A apps/web/src/hooks/useCopyToClipboard.test.ts
M apps/web/src/hooks/useCopyToClipboard.ts
M apps/web/src/main.tsx
A apps/web/src/routes/-__root.test.ts
M apps/web/src/routes/__root.tsx
M apps/web/src/routes/settings.tsx
A apps/web/src/vsmuxEmbed.test.ts
A apps/web/src/vsmuxEmbed.ts
A apps/web/src/vsmuxThreadGuard.test.ts
A apps/web/src/vsmuxThreadGuard.ts
```

## Local Change Notes

### `f95981247` - bootstrap fd EACCES fallback

Purpose: when the desktop/bootstrap file descriptor path cannot be duplicated because `/dev/fd/<fd>` or `/proc/self/fd/<fd>` returns `EACCES`, fall back to reading the inherited fd directly.

Files touched:

```text
apps/server/src/bootstrap.ts
apps/server/src/bootstrap.test.ts
```

Re-evaluate on upstream `main`: upstream has since reworked bootstrap errors and tests. If this is still needed, the likely change is just adding `EACCES` to the fd-path duplication-error predicate and adding one regression case in the current `apps/server/src/bootstrap.test.ts`.

### `c80bf5c08` - clipboard copy fallback

Purpose: if `navigator.clipboard.writeText` rejects, copy through a hidden textarea and `document.execCommand("copy")`, preserving selection and focus.

Files touched:

```text
apps/web/src/hooks/useCopyToClipboard.ts
apps/web/src/hooks/useCopyToClipboard.test.ts
```

Re-evaluate on upstream `main`: upstream now has typed clipboard errors and a `writeTextToClipboard` helper. If this is still needed, adapt the fallback into that helper instead of restoring the older `copyTextToClipboard` shape.

### `78b2ee30b` - keep sidebar reachable while collapsed

Purpose: expose a visible sidebar trigger in empty/thread/settings states even when the sidebar is collapsed, including Electron desktop chrome paths.

Files touched:

```text
apps/web/src/components/AppSidebarLayout.tsx
apps/web/src/components/NoActiveThreadState.tsx
apps/web/src/components/NotFoundState.tsx
apps/web/src/components/chat/ChatHeader.tsx
apps/web/src/components/ui/sidebar.tsx
apps/web/src/routes/__root.tsx
apps/web/src/routes/settings.tsx
```

Re-evaluate on upstream `main`: upstream has newer layout classes and a larger client-connection architecture. Preserve the behavior only where current upstream still hides the sidebar trigger in a state users can get stuck in.

### `7781f49b0` - VSmux/Ghostex embed bridge

Purpose: let a Ghostex/VSmux embed host T3 Code without normal browser routing. The patch added memory history for embed mode, parent active-thread notifications, preferred-thread recovery during startup, and bridged paste-image payload handling.

Files touched:

```text
apps/web/src/components/chat/ChatComposer.tsx
apps/web/src/main.tsx
apps/web/src/routes/-__root.test.ts
apps/web/src/routes/__root.tsx
apps/web/src/vsmuxEmbed.test.ts
apps/web/src/vsmuxEmbed.ts
apps/web/src/vsmuxThreadGuard.test.ts
apps/web/src/vsmuxThreadGuard.ts
```

Re-evaluate on upstream `main`: this is the largest port surface because upstream changed routing, auth, mobile, connection state, and app bootstrap code. Rebuild only the embed behaviors Ghostex still needs against current upstream concepts.

### `ec1e164d3` - thread state scaffold refactor

Purpose: reduce duplication between no-active-thread and not-found screens while keeping the sidebar trigger in those states.

Files touched:

```text
apps/web/src/components/NoActiveThreadState.tsx
apps/web/src/components/NotFoundState.tsx
apps/web/src/components/ThreadStateScaffold.test.tsx
apps/web/src/components/ThreadStateScaffold.tsx
```

Re-evaluate on upstream `main`: likely optional. Do not re-add this abstraction unless the current upstream code still has duplication and the sidebar-trigger behavior needs a shared wrapper.

### `5d80cc25d` - require owner session for desktop bootstrap

Purpose: a stale desktop-managed client-role browser cookie should not satisfy startup auth. Desktop startup should exchange the bootstrap credential until the session is owner-capable, otherwise owner-only orchestration APIs fail after launch.

Files touched:

```text
apps/web/src/authBootstrap.test.ts
apps/web/src/environments/primary/auth.ts
```

Re-evaluate on upstream `main`: upstream has split and reworked primary/desktop auth tests. If still needed, port the requirement into the current auth module and put the regression in the current desktop/primary auth test surface instead of restoring the old aggregate test layout.

## Reset Intent

The tracked `t3code` checkout has been reset to upstream `main` exactly at `ea52bb1dbda115f9824415f7589505c9e57268c6`, and the parent Ghostex repo now sees the `t3code` gitlink as modified. After this reset, reimplement only confirmed Ghostex requirements against the new code.
