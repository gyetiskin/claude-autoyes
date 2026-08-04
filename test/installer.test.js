import assert from 'node:assert/strict'
import { test } from 'node:test'

import { addHook, isInstalled, removeHook, resolveNodePath } from '../src/installer.js'
import { splitCommand, normalizeSegment } from '../src/shell.js'
import { globToRegExp, matchRule, parseRule } from '../src/rules.js'

const COMMAND = '"/usr/bin/node" "/opt/claude-autoyes/src/hook.js"'

test('install preserves unrelated settings', () => {
  const original = { theme: 'dark', statusLine: { type: 'command', command: 'x' } }
  const { settings } = addHook(original, COMMAND)
  assert.equal(settings.theme, 'dark')
  assert.deepEqual(settings.statusLine, original.statusLine)
  assert.ok(isInstalled(settings))
})

test('install does not clobber other PreToolUse hooks', () => {
  const original = {
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'log-it' }] }] },
  }
  const { settings } = addHook(original, COMMAND)
  assert.equal(settings.hooks.PreToolUse.length, 2)
  assert.equal(settings.hooks.PreToolUse[0].hooks[0].command, 'log-it')
})

test('install is idempotent and updates in place', () => {
  const once = addHook({}, COMMAND).settings
  const twice = addHook(once, '"/usr/bin/node" "/new/claude-autoyes/src/hook.js"')
  assert.equal(twice.action, 'updated')
  assert.equal(twice.settings.hooks.PreToolUse.length, 1)
  assert.match(twice.settings.hooks.PreToolUse[0].hooks[0].command, /\/new\//)
})

test('uninstall leaves foreign hooks and drops empty scaffolding', () => {
  const withBoth = addHook(
    { theme: 'dark', hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'log-it' }] }] } },
    COMMAND,
  ).settings
  const { settings, action } = removeHook(withBoth)
  assert.equal(action, 'removed')
  assert.equal(isInstalled(settings), false)
  assert.equal(settings.hooks.PreToolUse.length, 1)
  assert.equal(settings.theme, 'dark')
})

test('uninstall on a clean file is a no-op', () => {
  assert.equal(removeHook({ theme: 'dark' }).action, 'not-found')
})

test('a version-pinned node path is never baked into the hook command', () => {
  for (const volatile of [
    '/opt/homebrew/Cellar/node/26.5.1/bin/node',
    '/Users/me/.nvm/versions/node/v20.11.0/bin/node',
    '/Users/me/.volta/tools/image/node/22.0.0/bin/node',
  ]) {
    const resolved = resolveNodePath(volatile)
    assert.notEqual(resolved, volatile)
    assert.ok(resolved === 'node' || !/\d+\.\d+\.\d+/.test(resolved), `still version-pinned: ${resolved}`)
  }
})

test('an already-stable node path is left alone', () => {
  assert.equal(resolveNodePath('/usr/bin/node'), '/usr/bin/node')
})

test('splitCommand respects quotes and escapes', () => {
  assert.deepEqual(splitCommand('a && b'), ['a', 'b'])
  assert.deepEqual(splitCommand('echo "x && y"'), ['echo "x && y"'])
  assert.deepEqual(splitCommand("echo 'x; y' ; ls"), ["echo 'x; y'", 'ls'])
  assert.deepEqual(splitCommand('cat a | grep b'), ['cat a', 'grep b'])
})

test('normalizeSegment strips assignments and wrappers', () => {
  assert.equal(normalizeSegment('FOO=bar BAZ=1 ls -la'), 'ls -la')
  assert.equal(normalizeSegment('env FOO="a b" node x.js'), 'node x.js')
  assert.equal(normalizeSegment('ls'), 'ls')
})

test('rule parsing handles bare tools, patterns and MCP names', () => {
  assert.deepEqual(parseRule('Read'), { tool: 'Read', pattern: null })
  assert.deepEqual(parseRule('Bash(git status*)'), { tool: 'Bash', pattern: 'git status*' })
  assert.equal(parseRule('mcp__server__tool')?.tool, 'mcp__server__tool')
})

test('glob metacharacters in a rule are matched literally', () => {
  assert.ok(globToRegExp('a.b').test('a.b'))
  assert.equal(globToRegExp('a.b').test('axb'), false)
})

test('a rule for one tool never matches another', () => {
  assert.equal(matchRule('Bash(ls*)', 'Read', { file_path: 'ls' }), false)
})
