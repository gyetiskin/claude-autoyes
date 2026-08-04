#!/usr/bin/env node
/**
 * PreToolUse hook entrypoint.
 *
 * Claude Code pipes the pending tool call in as JSON on stdin. Emitting
 * `permissionDecision: "allow"` skips the prompt; emitting nothing leaves the
 * prompt exactly as it would have been.
 *
 * Every failure path here must end in "emit nothing, exit 0" — a broken hook
 * should cost you a prompt, never a blocked session.
 */

import { loadConfig } from './config.js'
import { decide } from './decide.js'
import { appendLog } from './log.js'
import { subjectOf } from './rules.js'

function readStdin() {
  return new Promise((resolve) => {
    let data = ''
    const timer = setTimeout(() => resolve(data), 2000)
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => {
      data += chunk
    })
    process.stdin.on('end', () => {
      clearTimeout(timer)
      resolve(data)
    })
    process.stdin.on('error', () => {
      clearTimeout(timer)
      resolve(data)
    })
  })
}

export async function main() {
  const raw = await readStdin()

  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    return
  }

  const toolName = payload?.tool_name
  if (typeof toolName !== 'string') return

  const config = loadConfig()
  const result = decide({ toolName, toolInput: payload?.tool_input ?? {}, config })

  if (config.log) {
    appendLog(config.logPath, {
      at: new Date().toISOString(),
      session: payload?.session_id ?? null,
      tool: toolName,
      subject: subjectOf(toolName, payload?.tool_input ?? {}).slice(0, 400),
      decision: result.decision,
      reason: result.reason,
    })
  }

  if (result.decision !== 'allow') return

  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: `claude-autoyes: ${result.reason}`,
      },
      suppressOutput: true,
    })}\n`,
  )
}

main().catch(() => process.exit(0))
