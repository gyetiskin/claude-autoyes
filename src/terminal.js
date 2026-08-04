/**
 * Terminal detection.
 *
 * Claude Code spawns hooks as child processes, so they inherit the terminal
 * emulator's environment. iTerm2 sets both TERM_PROGRAM and LC_TERMINAL; the
 * latter survives `ssh` when SendEnv is configured, so we check it first.
 */

/** @returns {string|null} normalized terminal id, or null if undetectable */
export function detectTerminal(env = process.env) {
  if (env.LC_TERMINAL === 'iTerm2') return 'iTerm.app'
  if (env.TERM_PROGRAM) return env.TERM_PROGRAM
  return null
}

/**
 * Fail closed: an unknown terminal never auto-approves. Better to show one
 * extra prompt than to approve inside a terminal the user did not opt into.
 */
export function terminalAllowed(allowedTerminals, env = process.env) {
  if (allowedTerminals.includes('*')) return true
  const current = detectTerminal(env)
  if (!current) return false
  return allowedTerminals.some((t) => t.toLowerCase() === current.toLowerCase())
}
