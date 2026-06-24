import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const hostProtocolSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/HostProtocol.swift", import.meta.url),
  "utf8",
);
const appDelegateSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/AppDelegate.swift", import.meta.url),
  "utf8",
);
const portlessAdminClientSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/PortlessAdminClient.swift", import.meta.url),
  "utf8",
);
const nativeSidebarSource = readFileSync(new URL("native-sidebar.tsx", import.meta.url), "utf8");
const sharedNativeHostProtocolSource = readFileSync(
  new URL("../../shared/native-ghostty-host-protocol.ts", import.meta.url),
  "utf8",
);

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("Portless native admin bridge source contract", () => {
  test("HostProtocol and sidebar expose typed sanitized admin command results", () => {
    /*
    CDXC:PortlessIntegration 2026-06-23-00:15:
    Phase 11 exposes Portless install, reconfigure, retry, and remove as typed native admin actions with a dedicated sanitized result event. The bridge must not depend on processResult stdout/stderr for privileged service setup.
    */
    expect(hostProtocolSource).toContain("case portlessAdminAction(PortlessAdminActionCommand)");
    expect(hostProtocolSource).toContain("case portlessAdminResult(");
    expect(hostProtocolSource).toContain("enum PortlessAdminActionKind: String, Codable");
    expect(hostProtocolSource).toContain("case install");
    expect(hostProtocolSource).toContain("case reconfigure");
    expect(hostProtocolSource).toContain("case retry");
    expect(hostProtocolSource).toContain("case remove");
    expect(hostProtocolSource).toContain("case serviceProtocol = \"protocol\"");

    const resultEncoder = sourceBetween(
      hostProtocolSource,
      "case .portlessAdminResult",
      "case .gxserverResponse",
    );
    expect(resultEncoder).toContain('try container.encode("portlessAdminResult", forKey: .type)');
    expect(resultEncoder).toContain("try container.encode(action, forKey: .action)");
    expect(resultEncoder).toContain("try container.encodeIfPresent(portlessProtocol, forKey: .portlessProtocol)");
    expect(resultEncoder).toContain("try container.encode(ok, forKey: .ok)");
    expect(resultEncoder).toContain("try container.encodeIfPresent(exitCode, forKey: .exitCode)");
    expect(resultEncoder).toContain("try container.encode(status, forKey: .status)");
    expect(resultEncoder).toContain("try container.encodeIfPresent(errorCode, forKey: .errorCode)");
    expect(resultEncoder).not.toContain(".stdout");
    expect(resultEncoder).not.toContain(".stderr");

    expect(nativeSidebarSource).toContain('type: "portlessAdminAction"');
    expect(nativeSidebarSource).toContain('hostEvent.type === "portlessAdminResult"');
    expect(nativeSidebarSource).toContain("NativePortlessAdminCommand");
    expect(nativeSidebarSource).toContain("NativePortlessAdminResult");
    expect(nativeSidebarSource).toContain("pendingPortlessAdminResults");
    expect(nativeSidebarSource).toContain("function runNativePortlessAdminAction");
    expect(nativeSidebarSource).toContain("runPortlessAdminAction: runNativePortlessAdminAction");
    expect(sharedNativeHostProtocolSource).toContain('type: "portlessAdminAction"');
    expect(sharedNativeHostProtocolSource).toContain('type: "portlessAdminResult"');
    expect(sharedNativeHostProtocolSource).toContain(
      'export type NativePortlessAdminInstallAction = "install" | "reconfigure" | "retry"',
    );
    expect(sharedNativeHostProtocolSource).toContain("export type NativePortlessAdminCommand = Extract<");
    expect(sharedNativeHostProtocolSource).toContain("export type NativePortlessAdminResult = Extract<");

    const sharedResultType = sourceBetween(
      sharedNativeHostProtocolSource,
      "action: NativePortlessAdminAction;",
      "  | {\n      projectId: string;",
    );
    expect(sharedResultType).toContain("action: NativePortlessAdminAction");
    expect(sharedResultType).toContain("protocol?: NativePortlessProtocol");
    expect(sharedResultType).toContain("status: string");
    expect(sharedResultType).not.toContain("stdout");
    expect(sharedResultType).not.toContain("stderr");
  });

  test("Swift admin client uses bundled Portless runtime, clean env, and fixed localhost service flags", () => {
    /*
    CDXC:PortlessServiceInstall 2026-06-23-05:11:
    The privileged native script must run only Ghostex's bundled code-server Node with Web/portless/dist/cli.js, set the Portless state dir under ~/.ghostex/gxserver/portless, clear inherited PORTLESS_* inputs with env -i, force localhost-only HTTP/HTTPS service flags, disable hosts sync, and install launchd stdout/stderr to /dev/null instead of a persistent service.log path.
    */
    expect(portlessAdminClientSource).toContain('URL(fileURLWithPath: "/usr/bin/osascript")');
    expect(portlessAdminClientSource).toContain("with administrator privileges");
    expect(portlessAdminClientSource).toContain('appendingPathComponent("Web", isDirectory: true)');
    expect(portlessAdminClientSource).toContain('appendingPathComponent("code-server/lib/node"');
    expect(portlessAdminClientSource).toContain('appendingPathComponent("portless/dist/cli.js"');
    expect(portlessAdminClientSource).toContain('PLIST_PATH="/Library/LaunchDaemons/$SERVICE_LABEL.plist"');
    expect(portlessAdminClientSource).toContain("/usr/bin/env -i");
    expect(portlessAdminClientSource).toContain('PORTLESS_STATE_DIR="$HOME/.ghostex/gxserver/portless"');
    expect(portlessAdminClientSource).toContain('PORTLESS_STATE_DIR="$PORTLESS_STATE_DIR"');
    expect(portlessAdminClientSource).toContain("PORTLESS_SYNC_HOSTS=0");
    expect(portlessAdminClientSource).toContain('SUDO_USER="$USER_NAME"');
    expect(portlessAdminClientSource).toContain('SUDO_UID="$USER_UID"');
    expect(portlessAdminClientSource).toContain('SUDO_GID="$USER_GID"');
    expect(portlessAdminClientSource).toContain('HOME="$HOME"');
    expect(portlessAdminClientSource).toContain('PATH="/usr/bin:/bin:/usr/sbin:/sbin"');
    expect(portlessAdminClientSource).toContain("/bin/cat > \"$PLIST_PATH\" <<'EOF_PLIST'");
    expect(portlessAdminClientSource).toContain('port = "443"');
    expect(portlessAdminClientSource).toContain('port = "80"');
    expect(portlessAdminClientSource).toContain('protocolFlag = "--https"');
    expect(portlessAdminClientSource).toContain('protocolFlag = "--no-tls"');
    expect(portlessAdminClientSource).not.toContain("service install --state-dir");
    expect(portlessAdminClientSource).not.toContain("service uninstall --state-dir");
    expect(portlessAdminClientSource).not.toContain("--lan");
    expect(portlessAdminClientSource).not.toContain("--wildcard");
    expect(portlessAdminClientSource).not.toContain("OSLog");

    const plistBuilder = sourceBetween(
      portlessAdminClientSource,
      "private func portlessLaunchdPlist",
      "private func runPrivilegedScript",
    );
    expect(plistBuilder).toContain("<key>PORTLESS_SYNC_HOSTS</key>");
    expect(plistBuilder).toContain("<string>proxy</string>");
    expect(plistBuilder).toContain("<string>start</string>");
    expect(plistBuilder).toContain("<string>--foreground</string>");
    expect(plistBuilder).toContain("<string>--port</string>");
    expect(plistBuilder).toContain("<string>\\(port)</string>");
    expect(plistBuilder).toContain("<string>\\(protocolFlag)</string>");
    expect(plistBuilder).toContain("<string>--tld</string>");
    expect(plistBuilder).toContain("<string>localhost</string>");
    expect(plistBuilder).toContain("<string>--skip-trust</string>");
    expect(plistBuilder).toContain("<key>StandardOutPath</key>");
    expect(plistBuilder).toContain("<key>StandardErrorPath</key>");
    expect(plistBuilder).toContain("<string>/dev/null</string>");
    expect(plistBuilder).not.toContain("service.log");
  });

  test("AppDelegate routes both native command paths through PortlessAdminClient instead of runProcess", () => {
    /*
    CDXC:PortlessIntegration 2026-06-23-00:15:
    Sidebar and local bridge commands share HostCommand, so both AppDelegate command switches must handle Portless through PortlessAdminClient and preserve the dedicated result event path.
    */
    expect(appDelegateSource.match(/case \.portlessAdminAction/g)?.length).toBe(2);
    expect(appDelegateSource.match(/PortlessAdminClient\.shared\.run/g)?.length).toBe(2);

    const portlessCases = appDelegateSource
      .split("case .portlessAdminAction")
      .slice(1)
      .map((source) => source.slice(0, source.indexOf("case .gxserverRequest")));
    expect(portlessCases).toHaveLength(2);
    for (const portlessCase of portlessCases) {
      expect(portlessCase).toContain("PortlessAdminClient.shared.run");
      expect(portlessCase).not.toContain("runProcess(");
    }
  });
});
