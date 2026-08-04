import { appendFileSync, readFileSync } from 'node:fs'

/**
 * Audit trail. Auto-approval only stays trustworthy if you can go back and see
 * what was approved on your behalf, so every decision is appended as one JSON
 * line. Logging failures are swallowed — a full disk must not block a tool call.
 */
export function appendLog(logPath, entry) {
  try {
    appendFileSync(logPath, `${JSON.stringify(entry)}\n`, 'utf8')
  } catch {
    // Intentionally ignored.
  }
}

export function readLog(logPath, limit = 20) {
  let raw
  try {
    raw = readFileSync(logPath, 'utf8')
  } catch {
    return []
  }
  return raw
    .split('\n')
    .filter(Boolean)
    .slice(-limit)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return { raw: line }
      }
    })
}
