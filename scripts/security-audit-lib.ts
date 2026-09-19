// scripts/security-audit-lib.ts
//
// Recognizers shared with scripts/security-audit.ts. Nothing here touches the
// filesystem or the process, so a test can import it; the audit script keeps
// its CLI entry and still runs every check on load.
//
// Functions: fetchWindowEnd, hasInjectionGuard, logsCredential

export const FETCH_RE = /\bfetch\s*\(/

// A file with an unbalanced parenthesis must not drag the window to the end of
// the file, so the balancer gives up after this many lines.
export const FETCH_WINDOW_MAX_LINES = 60

// Index of the last line belonging to the fetch() argument list that starts on
// lines[startIndex]. A fixed line window flagged correct calls whose options
// object was merely long, and a false positive on a CI-blocking check teaches
// people to ignore it.
export function fetchWindowEnd(lines: string[], startIndex: number): number {
  const fetchAt = lines[startIndex].search(FETCH_RE)
  let depth = 0
  let opened = false
  let windowEnd = startIndex

  for (let j = startIndex; j < Math.min(startIndex + FETCH_WINDOW_MAX_LINES, lines.length); j++) {
    const from = j === startIndex ? fetchAt : 0
    for (let k = from; k < lines[j].length; k++) {
      const ch = lines[j][k]
      if (ch === "(") {
        depth++
        opened = true
      } else if (ch === ")") {
        depth--
      }
    }
    windowEnd = j
    if (opened && depth <= 0) break
  }

  return windowEnd
}

// Evidence that a file validates cookie values before interpolation. Every
// entry has to match a regex character class that actually holds the characters
// it claims to reject or allow, because a guard that is named rather than
// written is not a guard.
//
// Two approaches are valid:
//   1. Blocklist: a class holding ";" and at least one control-character
//      escape. The semicolon is what splits one cookie into two; CR and LF
//      are what split one header into two.
//   2. Allowlist: a class narrow enough that nothing in it can break a
//      header, which is stricter than any blocklist.
const INJECTION_GUARD_PATTERNS = [
  /\[[^\]]*;[^\]]*(?:\\r|\\n|\\x00)[^\]]*\]/, // blocklist, semicolon first
  /\[[^\]]*(?:\\r|\\n|\\x00)[^\]]*;[^\]]*\]/, // blocklist, control char first
  /\[\^a-fA-F0-9\]/, // hex-only allowlist
  /\[\^a-f0-9\]/i, // hex-only allowlist variant
  /\[\^\\w\]/, // word-char-only allowlist
]

export function hasInjectionGuard(content: string): boolean {
  // Comment lines are dropped first: a class quoted in prose describes a guard
  // rather than being one, and the whole-file test would otherwise accept it.
  const code = content
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim()
      return !trimmed.startsWith("//") && !trimmed.startsWith("*") && !trimmed.startsWith("/*")
    })
    .join("\n")

  return INJECTION_GUARD_PATTERNS.some((re) => re.test(code))
}

// Variable names that hold credentials in adapter code
const CREDENTIAL_VARS = [
  "apiToken",
  "creds\\.uid",
  "creds\\.pass",
  "creds\\.cookies",
  "cookies",
  "trimmedToken",
  "trimmedPass",
  "trimmedUid",
]

// Adapters log through pino as log.debug/info/warn/error, and console calls are
// a lint error across src/lib/tracker-platforms, so a console-only detector has
// nothing left to match. Both call shapes are read.
const CRED_IN_LOG_RE = new RegExp(
  `\\b(?:console\\.(?:log|warn|error)|log\\.(?:debug|info|warn|error))\\s*\\([^)]*\\b(?:${CREDENTIAL_VARS.join("|")})\\b`
)

export function logsCredential(line: string): boolean {
  return CRED_IN_LOG_RE.test(line)
}
