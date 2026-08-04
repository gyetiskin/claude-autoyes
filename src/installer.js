import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SETTINGS_PATH = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'settings.json')
export const HOOK_PATH = join(dirname(fileURLToPath(import.meta.url)), 'hook.js')

/** Identifies our hook entry across upgrades, even if the path changes. */
export const HOOK_MARKER = 'claude-autoyes'

export function hookCommand(nodePath = process.execPath, hookPath = HOOK_PATH) {
  return `"${nodePath}" "${hookPath}"`
}

export function readSettings(path = SETTINGS_PATH) {
  if (!existsSync(path)) return {}
  const raw = readFileSync(path, 'utf8').trim()
  if (!raw) return {}
  return JSON.parse(raw)
}

function isOurs(hook) {
  return typeof hook?.command === 'string' && hook.command.includes(HOOK_MARKER)
}

/**
 * Merges our PreToolUse entry into an existing settings object without
 * disturbing anything else. Re-running is idempotent: an existing entry is
 * updated in place rather than duplicated.
 */
export function addHook(settings, command) {
  const next = structuredClone(settings)
  next.hooks ??= {}
  next.hooks.PreToolUse ??= []

  const entry = {
    type: 'command',
    command,
    timeout: 10,
    statusMessage: 'claude-autoyes',
  }

  for (const group of next.hooks.PreToolUse) {
    const index = (group.hooks ?? []).findIndex(isOurs)
    if (index !== -1) {
      group.hooks[index] = entry
      return { settings: next, action: 'updated' }
    }
  }

  next.hooks.PreToolUse.push({ matcher: '*', hooks: [entry] })
  return { settings: next, action: 'installed' }
}

export function removeHook(settings) {
  const next = structuredClone(settings)
  const groups = next.hooks?.PreToolUse
  if (!Array.isArray(groups)) return { settings: next, action: 'not-found' }

  let removed = false
  for (const group of groups) {
    const before = (group.hooks ?? []).length
    group.hooks = (group.hooks ?? []).filter((hook) => !isOurs(hook))
    if (group.hooks.length !== before) removed = true
  }

  next.hooks.PreToolUse = groups.filter((group) => (group.hooks ?? []).length > 0)
  if (next.hooks.PreToolUse.length === 0) delete next.hooks.PreToolUse
  if (Object.keys(next.hooks ?? {}).length === 0) delete next.hooks

  return { settings: next, action: removed ? 'removed' : 'not-found' }
}

export function isInstalled(settings) {
  return (settings.hooks?.PreToolUse ?? []).some((group) => (group.hooks ?? []).some(isOurs))
}

/** Never overwrite settings.json without leaving a copy behind. */
export function backupSettings(path = SETTINGS_PATH) {
  if (!existsSync(path)) return null
  const backup = `${path}.autoyes-backup`
  copyFileSync(path, backup)
  return backup
}

export function writeSettings(settings, path = SETTINGS_PATH) {
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
}
