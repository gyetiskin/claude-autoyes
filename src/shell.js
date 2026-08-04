/**
 * Minimal shell-aware splitting.
 *
 * Why this exists: a rule like `Bash(git status*)` looks safe, but the raw
 * command `git status && rm -rf ~` also starts with `git status`. Guards and
 * allow-rules therefore run against every *segment* of a command line, not the
 * line as a whole. Quoted regions are skipped so `echo "a && b"` stays one
 * segment.
 *
 * This is deliberately not a full shell parser. It errs toward over-splitting,
 * which produces extra prompts (safe) rather than missed guards (unsafe).
 */

const SEPARATORS = ['&&', '||', ';', '|', '\n']

/** @param {string} command @returns {string[]} non-empty trimmed segments */
export function splitCommand(command) {
  if (typeof command !== 'string' || command.length === 0) return []

  const segments = []
  let current = ''
  let quote = null // "'" | '"' | null

  for (let i = 0; i < command.length; i++) {
    const char = command[i]

    if (quote) {
      current += char
      // Backslash escapes only apply inside double quotes in POSIX shells.
      if (char === '\\' && quote === '"' && i + 1 < command.length) {
        current += command[++i]
      } else if (char === quote) {
        quote = null
      }
      continue
    }

    if (char === "'" || char === '"') {
      quote = char
      current += char
      continue
    }

    if (char === '\\' && i + 1 < command.length) {
      current += char + command[++i]
      continue
    }

    const separator = SEPARATORS.find((s) => command.startsWith(s, i))
    if (separator) {
      segments.push(current)
      current = ''
      i += separator.length - 1
      continue
    }

    current += char
  }
  segments.push(current)

  return segments.map((s) => s.trim()).filter(Boolean)
}

/**
 * Strips leading `VAR=value` assignments and wrappers that hide the real
 * command, so `env FOO=1 sudo rm -rf /` still guards on `sudo`.
 */
export function normalizeSegment(segment) {
  let rest = segment.trim()
  const wrappers = ['env', 'command', 'nohup', 'time', 'exec']

  for (;;) {
    const before = rest
    rest = rest.replace(/^[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+/, '')
    const head = rest.split(/\s+/)[0]
    if (wrappers.includes(head)) rest = rest.slice(head.length).trimStart()
    if (rest === before) return rest
  }
}
