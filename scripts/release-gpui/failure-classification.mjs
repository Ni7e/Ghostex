/*
 * CDXC:ReleaseTransientFailureClassification 2026-08-13:
 * Closed allow-list of transient transport/availability signatures, plus a
 * fatal list that always wins.
 *
 * The default for unmatched output is FATAL. Retrying an unclassified failure
 * would mask deterministic compiler, integrity, and signature errors, which is
 * exactly what release 7.7 must never repeat: the Zig archive fetch was worth
 * retrying, the `SharedString` compile error was not.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/*
 * A match here is never retryable, even if a transient rule also matches.
 *
 * The `rustc` rule is deliberately narrower than a bare /^error:/: Zig prints
 * `error: invalid HTTP response: HttpConnectionClosing` at line start, so a
 * generic anchor would classify the exact release 7.7 transport failure as a
 * compiler error and refuse to retry it. Unmatched output is fatal anyway, so
 * requiring rustc-specific phrasing loses no safety.
 */
export const FATAL_RULES = Object.freeze([
  {
    id: "rustc",
    pattern:
      /^error\[E\d{4}\]:|^error: (?:could not compile|aborting due to|cannot find|unresolved|expected|mismatched types|failed to run custom build command|the trait bound|no method named|internal compiler error)/m,
  },
  { id: "linker", pattern: /error: linking with .* failed|LNK\d{4}|undefined (?:reference|symbol)/i },
  { id: "zig-compile", pattern: /^\S+\.zig:\d+:\d+: error:/m },
  { id: "integrity", pattern: /hash mismatch|checksum mismatch|SHA-?256 mismatch|digest mismatch|does not match/i },
  {
    id: "signature",
    pattern: /code ?sign(?:ing)? failed|signtool.*(?:failed|error)|attestation verification failed|Invalid signature/i,
  },
  { id: "ghostex-refusal", pattern: /Refusing to |must equal |is missing required|Hard Stop/ },
  { id: "test-failure", pattern: /Tests?\s+\d+ failed|FAIL\s+\S+\.test\./ },
]);

export const RETRYABLE_RULES = Object.freeze([
  { id: "zig-http-close", pattern: /invalid HTTP response: HttpConnectionClosing/i },
  {
    id: "zig-fetch-net",
    pattern:
      /error: (?:ConnectionResetByPeer|ConnectionTimedOut|TemporaryNameServerFailure|UnknownHostName|TlsInitializationFailed|NetworkUnreachable)/,
  },
  { id: "curl-transient", pattern: /curl:\s*\((?:6|7|18|28|35|52|55|56|92)\)/ },
  { id: "http-5xx", pattern: /\b(?:HTTP\/[\d.]+ )?(?:502|503|504)\b/ },
  {
    id: "socket",
    pattern: /\b(?:ECONNRESET|ETIMEDOUT|EAI_AGAIN|EPIPE|socket hang up|Connection reset by peer)\b/i,
  },
  { id: "gh-rate-limit", pattern: /API rate limit exceeded|secondary rate limit|was submitted too quickly/i },
  {
    id: "gh-artifact",
    pattern: /Unable to download artifact|Artifact download failed|Unexpected response\. Unable to download/i,
  },
  {
    id: "apt-transient",
    pattern:
      /(?:Could not resolve|Temporary failure resolving|Connection failed|Undetermined Error).*(?:archive\.ubuntu|ports\.ubuntu|security\.ubuntu)/i,
  },
  { id: "npm-network", pattern: /npm (?:ERR|error)!?\s+network|ERR_SOCKET_TIMEOUT|ETARGET.*registry/i },
  { id: "brew-transient", pattern: /Failed to download resource|curl: \(\d+\).*homebrew/i },
  { id: "notary-transient", pattern: /Unable to (?:reach|contact) (?:the )?Apple notary|HTTP status code: 5\d\d/i },
  { id: "runner-net", pattern: /The remote (?:name|server) could not be resolved|TLS handshake timeout/i },
]);

/*
 * Fatal rules are evaluated first and win outright. Everything that matches no
 * rule is fatal too: retrying an unknown failure is how deterministic breakage
 * gets papered over.
 */
export function classifyFailure(text) {
  const output = typeof text === "string" ? text : String(text ?? "");
  for (const rule of FATAL_RULES) {
    if (rule.pattern.test(output)) return { category: "fatal", matchedRule: rule.id, retryable: false };
  }
  for (const rule of RETRYABLE_RULES) {
    if (rule.pattern.test(output)) return { category: "transient", matchedRule: rule.id, retryable: true };
  }
  return { category: "unclassified", matchedRule: null, retryable: false };
}

/* Collect every text surface an error can carry, so classification sees stderr too. */
export function failureText(error) {
  if (error === null || error === undefined) return "";
  if (typeof error === "string") return error;
  const parts = [];
  if (error.message) parts.push(String(error.message));
  if (error.stderr) parts.push(error.stderr.toString());
  if (error.stdout) parts.push(error.stdout.toString());
  if (error.output && Array.isArray(error.output)) {
    for (const chunk of error.output) if (chunk) parts.push(chunk.toString());
  }
  if (parts.length === 0) parts.push(String(error));
  return parts.join("\n");
}

export function classifyError(error) {
  return classifyFailure(failureText(error));
}

function main() {
  const [source] = process.argv.slice(2);
  const text = source && source !== "-" ? readFileSync(source, "utf8") : readFileSync(0, "utf8");
  const classification = classifyFailure(text);
  process.stdout.write(
    `${classification.retryable ? "TRANSIENT" : "FATAL"} rule=${classification.matchedRule ?? "(none)"} ` +
      `category=${classification.category}\n`,
  );
  /* Exit 0 for a retryable classification so shell wrappers can branch on it. */
  process.exitCode = classification.retryable ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
