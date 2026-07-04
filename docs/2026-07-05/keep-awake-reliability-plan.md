# Keep Awake Reliability Plan

Date: 2026-07-05

## Current State

Keep Awake currently works, but the macOS app path can leave a detached `caffeinate` process running after Ghostex quits, crashes, reloads, or loses its stored runtime PID. The default duration is also "Until turned off", so some starts are intentionally indefinite. The lid-close prevention helper is separate and safer because it uses a short lease/heartbeat, but the main awake hold needs stronger ownership.

## Proposed Changes

1. Move Keep Awake ownership into `gxserver`.
   - `gxserver` should own the runtime state: active/inactive, source, duration, expiry, child process handle, and stop reason.
   - The macOS app, sidebar, and titlebar should send commands such as `start`, `stop`, and `status`.
   - Important caveat: this controls the machine where `gxserver` is running. Local Mac sleep prevention needs the local `gxserver`, not a remote one.

2. Start `caffeinate` directly from `gxserver`.
   - Do not use `/bin/sh`.
   - Do not use `nohup`.
   - Do not background it manually.
   - Spawn `/usr/bin/caffeinate` directly and keep the child process handle.

3. Add a Settings button for Keep Awake support setup.
   - Avoid labeling this as "Install caffeinate" because macOS already ships `caffeinate` at `/usr/bin/caffeinate`.
   - Better labels: "Verify Keep Awake Support" or "Set Up Keep Awake".
   - The button should check that `/usr/bin/caffeinate` exists and can be started.
   - If closed-lid support is enabled, the same setup flow can install or repair the privileged lid helper.

4. Keep the lid-close helper separate, but controlled by `gxserver`.
   - `caffeinate` does not prevent MacBook lid-close sleep.
   - The existing privileged helper and `pmset disablesleep` path are still needed for that case.
   - `gxserver` should own the decision, while the privileged helper remains the small macOS-specific executor.

5. Kill only the owned `caffeinate` child on stop.
   - Stop should terminate only the `caffeinate` process that `gxserver` started.
   - Avoid broad `pkill caffeinate`.
   - Avoid PID-only ownership where possible; the child process handle is safer.

6. Kill the owned `caffeinate` child when `gxserver` shuts down.
   - If `gxserver` exits normally, it should clean up the active Keep Awake process.
   - This prevents "Ghostex was closed but the Mac is still awake."

7. Prefer process-bound behavior for crash cleanup.
   - Where possible, start `caffeinate` in a way that naturally dies when the owning `gxserver` process dies.
   - Validate the best macOS approach before implementing.
   - The goal is no detached process that can live forever.

8. Make runtime state `gxserver`-owned, not `localStorage`-owned.
   - UI storage may cache display state, but it must not be the source of truth.
   - On reload, the UI should ask `gxserver` for status.
   - If `gxserver` says inactive, the UI should clear any stale active icon.

9. Add a diagnostics/status command.
   - Example commands or endpoints: `ghostex keep-awake status` and a matching local API endpoint.
   - Report active/inactive state.
   - Report source: manual, launch, external display, delayed send, or working sessions.
   - Report duration.
   - Report expiry time or "until turned off".
   - Report whether display sleep is allowed.
   - Report whether lid prevention is active.
   - Report whether the `caffeinate` child is alive.
   - Report last stop reason or last error.

10. Make automatic starts visible in the UI.
    - If Keep Awake started automatically, show why.
    - Example labels: "Keeping awake: delayed send", "Keeping awake: working session", "Keeping awake: external display", or "Keeping awake: launch setting".
    - This reduces confusion when users did not manually start Keep Awake.

11. Reconsider the default duration.
    - Current default is "Until turned off".
    - That makes permanent-awake reports more likely.
    - A safer default would be "2 hours", especially for auto-start cases.
    - Manual "Until turned off" can still exist as an explicit menu choice.

12. Add a strong "Allow Sleep Now" action.
    - This should stop the active `gxserver`-owned runtime immediately.
    - It should also suppress automatic restart for the current run unless the user manually starts Keep Awake again.
    - This gives users one obvious escape hatch.

13. Make auto-start rules bounded or explicit.
    - Launch and external-display auto-start should use the configured default duration.
    - Delayed send can stay automatic, but should stop as soon as delayed send is done.
    - Working-session mode should stop after the working state plus the grace window.

14. Treat `deactivateOnUserSwitch` as unfinished until implemented.
    - The setting exists, but the current macOS titlebar path did not appear to enforce it.
    - If the setting remains visible, `gxserver` should implement it.
    - Otherwise, hide or remove the setting until it has real behavior.

