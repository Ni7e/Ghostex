# Native Windows remote connections and wmx

User scope: native PowerShell remote machines from macOS GPUI and Android, preserve POSIX and WSL connections, and extract the Windows session host into the public `maddada/wmx` submodule under `.dependencies/wmx`. Implement the zmx behaviors Ghostex consumes; document unused zmx features as future work.

## Delivery checklist

- [x] Extract and publish standalone wmx, then register its submodule.
- [x] Match session lifecycle, raw input, attach/detach, history, title observation, resize/visibility leadership, refresh, and version/capability contracts.
- [x] Preserve existing native sessions when installing wmx.
- [x] Update native and WSL Windows build/staging scripts and release inputs.
- [x] Add native Windows detection and command routing to macOS GPUI remote connect, token/start, terminal attach, file upload, and applicable project/editor actions.
- [x] Add equivalent detection/routing to Android connection checks, inventory, terminal, chat, project actions, port lookup, and uploads.
- [x] Keep explicit WSL selection and direct POSIX SSH environments working.
- [x] Build Windows app/runtime and mobile app; run relevant existing checks and end-to-end checks.
- [x] Verify macOS GPUI connection and Android connection against Windows with screenshots.
- [x] Document the shared zmx/wmx maintenance contract and update Ghostex Help.
- [x] Commit/push submodules first, integrate the parent commit, and preserve unrelated work.

## Findings

- Mobile sends POSIX login wrappers in multiple JS clients. Native Android uploads also probe with `uname`.
- macOS GPUI remote detection currently routes every Windows OpenSSH host through WSL.
- The existing Windows host persists sessions but lacks zmx's visible/chat/hidden grid leadership and refresh behavior.
- Windows session storage must remain at the existing Ghostex runtime directory during extraction; wmx receives it through `WMX_DIR`.

## Working copies and verification

- Parent: `/Users/madda/dev/_worktrees/Ghostex-wmx-20260914`, branch `feat/wmx-windows-remote-20260914`.
- Mobile: its isolated `apps/mobile/app` checkout, branch `feat/windows-remote-20260914`.
- Windows test host: `w`, `100.105.82.19`; existing debug checkout and isolated profile from the preceding work.
- macOS main started clean at `7967cbc4`; no edits there.
- Android SDK is `/opt/homebrew/share/android-commandlinetools`; no device connected initially, two emulator AVDs available.
- Expo SDK 57 documentation read as required by mobile AGENTS.md.

## Verified results

- Published [maddada/wmx](https://github.com/maddada/wmx) at `e9996a7`; the final [Windows build and smoke suite passed](https://github.com/maddada/wmx/actions/runs/34828543409).
- Published mobile commit `887ce7f` to its main branch and the feature branch.
- Built the complete Windows GPUI app, native gxserver/CLI/wmx, native Code payload, Android debug APK, and macOS isolated Ghostex-3 app.
- Root TypeScript/Help checks, mobile TypeScript, all 17 existing editor tests and 19 existing zmx identity/provider tests passed.
- Android connected over SSH, browsed Windows folders, created `C:\dev\WMX Remote Test`, attached PowerShell, sent a command, and uploaded a PNG. macOS connected to the same project and session, displayed the phone's output, and sent its own command.
- Restarting Android preserved the session. Restarting only the new Windows control plane also preserved its wmx shell.
- A fresh native gxserver started through SSH returned EOF, remained healthy after the connection ended, and stopped cleanly through the CLI.
- The Windows host's Ubuntu-24.04 WSL environment returned its project/session inventory through the new mobile command builder. WSL option names must remain unquoted because wsl.exe parses quoted flags as Linux command text.
- wmx smoke coverage includes delayed first request, multiple clients, visible/chat/hidden grid leadership, refresh acknowledgement, stdin EOF detach, raw input/history, capability handoff, graceful restart and verified force-kill.
- Android's native SSH layer now uses a PTY exec request for prepared commands, removing an additional hidden Unix `exec` prefix.
- Native Codex accepted a chat prompt sent from Android and replied `WMX_CHAT_OK`. Both Android and macOS displayed the transcript. Android switched chat to terminal and back with its messages preserved.
- This exposed two missing parity behaviors: styled history must export physical rows and literal composer padding, and new Windows Codex sessions need their process-owned rollout resolved. The history and native process-handle fixes are included.
- Native Windows process ownership uses [Windows process snapshots](https://learn.microsoft.com/en-us/windows/win32/api/processsnapshot/nf-processsnapshot-psscapturesnapshot) and [file-handle paths](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getfinalpathnamebyhandlew). It does not select a transcript by project directory or recency.
- WSL inventory and an SFTP upload through its translated UNC path passed against Ubuntu-24.04.
- The final native gxserver is running from `C:\dev\Ghostex-wmx-remote\apps\desktop\build\windows\Ghostex\resources\native`; the complete Windows app bundle is staged one level above `resources`.

Screenshots: [Android chat](/Users/madda/.local/share/ghostex/i/android-wmx-chat-roundtrip-20260914.png), [macOS chat](/Users/madda/.local/share/ghostex/i/macos-wmx-chat-roundtrip-20260914.png), [Android PowerShell](/Users/madda/.local/share/ghostex/i/android-wmx-powershell-working-20260914.png).

The existing product gate still disables the Code tab for all remote projects. This task preserves that behavior; native Windows prompt-editor/runtime routing is prepared independently. No live user session was deliberately stopped.

Android validation used an emulator connected through the Mac's Tailscale route, not a physical phone. The emulator's Tailscale banner reflects its own missing Tailscale app; its SSH connection to the Windows Tailnet address succeeded. These changes still need to ship in the next mobile and desktop releases for existing installed apps to receive them.
