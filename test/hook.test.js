import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const HOOK = fileURLToPath(new URL('../src/hook.js', import.meta.url))

/** Runs the real hook binary the way Claude Code does: JSON in on stdin. */
function runHook(payload, env = {}) {
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      [HOOK],
      { env: { ...process.env, TERM_PROGRAM: 'iTerm.app', ...env } },
      (error, stdout) => resolve({ code: error?.code ?? 0, stdout }),
    )
    child.stdin.end(typeof payload === 'string' ? payload : JSON.stringify(payload))
  })
}

/** Isolates the test from the developer's real ~/.claude/autoyes.json. */
function isolatedConfig(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'autoyes-'))
  const path = join(dir, 'autoyes.json')
  writeFileSync(path, JSON.stringify({ log: false, ...overrides }))
  return { HOME: dir, CLAUDE_CONFIG_DIR: dir, AUTOYES_CONFIG: path }
}

test('emits an allow decision for an approved command', async () => {
  const { stdout, code } = await runHook(
    { tool_name: 'Bash', tool_input: { command: 'git status --short' } },
    isolatedConfig(),
  )
  assert.equal(code, 0)
  const parsed = JSON.parse(stdout)
  assert.equal(parsed.hookSpecificOutput.permissionDecision, 'allow')
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'PreToolUse')
})

test('stays silent for a guarded command, leaving the prompt intact', async () => {
  const { stdout, code } = await runHook(
    { tool_name: 'Bash', tool_input: { command: 'rm -rf ~/projects' } },
    isolatedConfig(),
  )
  assert.equal(code, 0)
  assert.equal(stdout.trim(), '')
})

test('malformed stdin never blocks a tool call', async () => {
  for (const payload of ['not json', '', '{}', '{"tool_name":null}']) {
    const { stdout, code } = await runHook(payload, isolatedConfig())
    assert.equal(code, 0, `exit code for payload: ${payload}`)
    assert.equal(stdout.trim(), '', `stdout for payload: ${payload}`)
  }
})

test('a corrupt config file falls back to defaults instead of crashing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'autoyes-'))
  writeFileSync(join(dir, 'autoyes.json'), '{ this is not json')
  const { code } = await runHook(
    { tool_name: 'Bash', tool_input: { command: 'git status' } },
    { AUTOYES_CONFIG: join(dir, 'autoyes.json') },
  )
  assert.equal(code, 0)
})

test('a non-iTerm2 terminal produces no output', async () => {
  const { stdout } = await runHook(
    { tool_name: 'Read', tool_input: { file_path: '/tmp/a' } },
    { ...isolatedConfig(), TERM_PROGRAM: 'Apple_Terminal', LC_TERMINAL: '' },
  )
  assert.equal(stdout.trim(), '')
})
