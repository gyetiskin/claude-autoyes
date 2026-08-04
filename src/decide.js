import { checkGuards } from './guards.js'
import { findAll, findAny } from './rules.js'
import { splitCommand, normalizeSegment } from './shell.js'
import { detectTerminal, terminalAllowed } from './terminal.js'

/**
 * The whole decision, as one pure function — no I/O, so it is fully testable
 * and the CLI's `explain` command shares exactly the hook's logic.
 *
 * @returns {{decision: 'allow'|'ask', reason: string, rule?: string, guard?: string}}
 */
export function decide({ toolName, toolInput = {}, config, env = process.env }) {
  if (!config.enabled) {
    return { decision: 'ask', reason: 'claude-autoyes is disabled' }
  }
  if (config.mode === 'off') {
    return { decision: 'ask', reason: 'mode is "off"' }
  }
  if (!terminalAllowed(config.terminals, env)) {
    const current = detectTerminal(env) ?? 'unknown'
    return { decision: 'ask', reason: `terminal "${current}" is not in terminals: [${config.terminals.join(', ')}]` }
  }

  // Normalizing can empty a segment (a bare `FOO=bar`, a stray `fi`). An empty
  // segment runs nothing, so it must not veto approval of the whole chain.
  const segments =
    toolName === 'Bash' && typeof toolInput.command === 'string'
      ? splitCommand(toolInput.command).map(normalizeSegment).filter(Boolean)
      : []

  if (!config.unsafeDisableBuiltinGuards) {
    const guard = checkGuards(toolName, toolInput)
    if (guard) {
      return { decision: 'ask', reason: `built-in guard "${guard.id}": ${guard.why}`, guard: guard.id }
    }
  }

  // ANY segment matching alwaysAsk forces a prompt; ALL segments must match
  // autoApprove before the prompt is skipped.
  const asked = findAny(config.alwaysAsk, toolName, toolInput, segments)
  if (asked) {
    return { decision: 'ask', reason: `matched alwaysAsk rule ${asked}`, rule: asked }
  }

  const approved = findAll(config.autoApprove, toolName, toolInput, segments)
  if (approved) {
    return { decision: 'allow', reason: `matched autoApprove rule ${approved}`, rule: approved }
  }

  if (config.mode === 'aggressive') {
    return { decision: 'allow', reason: 'aggressive mode: unguarded and not in alwaysAsk' }
  }

  return { decision: 'ask', reason: 'no autoApprove rule matched' }
}
