#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

import { CONFIG_PATH, DEFAULT_CONFIG, loadConfig, saveConfig } from '../src/config.js'
import { decide } from '../src/decide.js'
import { ALL_GUARDS } from '../src/guards.js'
import {
  HOOK_PATH,
  SETTINGS_PATH,
  addHook,
  backupSettings,
  hookCommand,
  isInstalled,
  readSettings,
  removeHook,
  writeSettings,
} from '../src/installer.js'
import { readLog } from '../src/log.js'
import { detectTerminal } from '../src/terminal.js'

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
}

const USAGE = `
${c.bold('claude-autoyes')} — auto-approve routine Claude Code prompts in iTerm2

${c.bold('Usage')}
  claude-autoyes <command> [options]

${c.bold('Commands')}
  install              Register the PreToolUse hook in ~/.claude/settings.json
  uninstall            Remove the hook (config file is kept)
  status               Show installation, terminal and config state
  doctor               Diagnose why prompts are or aren't being auto-approved
  on | off             Toggle auto-approval without uninstalling
  mode <safe|aggressive|off>
                       Change how unmatched calls are treated
  explain <tool> [subject]
                       Dry-run one tool call and print the decision
  allow <rule>         Append a rule to autoApprove
  ask <rule>           Append a rule to alwaysAsk
  reset                Refresh rule lists from the built-in defaults
  rules                List active rules
  guards               List built-in safety guards
  log [n]              Show the last n decisions (default 20)
  config               Print the resolved config

${c.bold('Examples')}
  claude-autoyes install
  claude-autoyes explain Bash "git status --short"
  claude-autoyes allow 'Bash(docker compose logs*)'
  claude-autoyes log 50
`

function say(...args) {
  console.log(...args)
}

function fail(message) {
  console.error(c.red(`error: ${message}`))
  process.exit(1)
}

function cmdInstall() {
  let settings
  try {
    settings = readSettings()
  } catch (error) {
    fail(`${SETTINGS_PATH} is not valid JSON (${error.message}). Fix it first.`)
  }

  const backup = backupSettings()
  const { settings: next, action } = addHook(settings, hookCommand())
  writeSettings(next)

  if (!existsSync(CONFIG_PATH)) {
    saveConfig(DEFAULT_CONFIG)
    say(c.dim(`wrote default config  ${CONFIG_PATH}`))
  }

  say(c.green(`✓ hook ${action}`), c.dim(`→ ${SETTINGS_PATH}`))
  if (backup) say(c.dim(`  backup            ${backup}`))
  say(c.dim(`  hook              ${HOOK_PATH}`))
  say('')
  say(`Restart Claude Code (or open ${c.cyan('/hooks')} once) to load the hook.`)
}

function cmdUninstall() {
  const settings = readSettings()
  backupSettings()
  const { settings: next, action } = removeHook(settings)
  writeSettings(next)
  say(action === 'removed' ? c.green('✓ hook removed') : c.yellow('hook was not installed'))
}

function cmdStatus() {
  const config = loadConfig()
  const installed = (() => {
    try {
      return isInstalled(readSettings())
    } catch {
      return false
    }
  })()
  const terminal = detectTerminal() ?? 'unknown'
  const terminalOk = config.terminals.includes('*') || config.terminals.some((t) => t.toLowerCase() === terminal.toLowerCase())

  say('')
  say(`  ${c.bold('hook')}       ${installed ? c.green('installed') : c.red('not installed')}`)
  say(`  ${c.bold('enabled')}    ${config.enabled ? c.green('yes') : c.yellow('no')}`)
  say(`  ${c.bold('mode')}       ${config.mode === 'aggressive' ? c.yellow(config.mode) : config.mode}`)
  say(`  ${c.bold('terminal')}   ${terminal} ${terminalOk ? c.green('(allowed)') : c.yellow('(not allowed)')}`)
  say(`  ${c.bold('guards')}     ${config.unsafeDisableBuiltinGuards ? c.red('DISABLED') : c.green(`${ALL_GUARDS.length} active`)}`)
  say(`  ${c.bold('rules')}      ${config.autoApprove.length} auto-approve, ${config.alwaysAsk.length} always-ask`)
  say(`  ${c.bold('config')}     ${config._source === 'defaults' ? c.dim('built-in defaults') : CONFIG_PATH}`)
  say('')
  if (config._error) say(c.red(`  ${config._error}`))
}

function cmdDoctor() {
  const config = loadConfig()
  const problems = []

  try {
    if (!isInstalled(readSettings())) problems.push(`hook not registered — run ${c.cyan('claude-autoyes install')}`)
  } catch (error) {
    problems.push(`${SETTINGS_PATH} is not valid JSON: ${error.message}`)
  }

  if (!config.enabled) problems.push(`disabled — run ${c.cyan('claude-autoyes on')}`)
  if (config.mode === 'off') problems.push(`mode is "off" — run ${c.cyan('claude-autoyes mode safe')}`)

  const terminal = detectTerminal()
  if (!terminal) {
    problems.push('TERM_PROGRAM is unset, so the terminal cannot be identified (auto-approval fails closed)')
  } else if (!config.terminals.includes('*') && !config.terminals.some((t) => t.toLowerCase() === terminal.toLowerCase())) {
    problems.push(`terminal "${terminal}" is not in terminals: [${config.terminals.join(', ')}]`)
  }

  if (config.unsafeDisableBuiltinGuards) {
    problems.push(c.red('built-in guards are DISABLED — destructive commands will be auto-approved'))
  }
  if (config._error) problems.push(config._error)

  say('')
  if (problems.length === 0) {
    say(c.green('✓ everything checks out — routine prompts will be auto-approved'))
  } else {
    for (const problem of problems) say(`  ${c.yellow('•')} ${problem}`)
  }
  say('')
}

function cmdExplain(argv) {
  const toolName = argv[0]
  if (!toolName) fail('usage: claude-autoyes explain <tool> [subject]')
  const subject = argv.slice(1).join(' ')

  const fieldByTool = {
    Bash: 'command',
    Read: 'file_path',
    Write: 'file_path',
    Edit: 'file_path',
    Glob: 'pattern',
    Grep: 'pattern',
    WebFetch: 'url',
  }
  const toolInput = subject ? { [fieldByTool[toolName] ?? 'command']: subject } : {}

  const result = decide({ toolName, toolInput, config: loadConfig() })
  const label = result.decision === 'allow' ? c.green('ALLOW (no prompt)') : c.yellow('ASK  (prompt shown)')

  say('')
  say(`  ${c.bold(toolName)}${subject ? ` ${c.dim(subject)}` : ''}`)
  say(`  ${label}`)
  say(`  ${c.dim(result.reason)}`)
  say('')
}

function appendRule(key, rule) {
  if (!rule) fail(`usage: claude-autoyes ${key === 'autoApprove' ? 'allow' : 'ask'} '<rule>'`)
  const config = loadConfig()
  if (config[key].includes(rule)) {
    say(c.yellow(`already present: ${rule}`))
    return
  }
  config[key] = [...config[key], rule]
  saveConfig(config)
  say(c.green(`✓ added to ${key}: ${rule}`))
}

/**
 * Rewrites the rule lists from the built-in defaults. Upgrading the package
 * cannot change a config file that already exists, so without this an old
 * install keeps yesterday's rules — including any that a later release
 * tightened.
 */
function cmdReset() {
  const current = loadConfig()
  const backup = `${CONFIG_PATH}.bak`
  if (existsSync(CONFIG_PATH)) {
    writeFileSync(backup, readFileSync(CONFIG_PATH, 'utf8'))
  }

  // Personal switches are preserved; only the rule lists are refreshed.
  saveConfig({
    ...DEFAULT_CONFIG,
    enabled: current.enabled,
    mode: current.mode,
    terminals: current.terminals,
    log: current.log,
    logPath: current.logPath,
  })

  say(c.green('✓ rules reset to the built-in defaults'))
  say(c.dim(`  previous config saved to ${backup}`))
  say(c.dim(`  ${DEFAULT_CONFIG.autoApprove.length} auto-approve, ${DEFAULT_CONFIG.alwaysAsk.length} always-ask`))
}

function cmdRules() {
  const config = loadConfig()
  say('')
  say(c.bold('  alwaysAsk') + c.dim('  (checked first — these always prompt)'))
  for (const rule of config.alwaysAsk) say(`    ${c.yellow('?')} ${rule}`)
  say('')
  say(c.bold('  autoApprove'))
  for (const rule of config.autoApprove) say(`    ${c.green('✓')} ${rule}`)
  say('')
}

function cmdGuards() {
  say('')
  say(c.dim('  Built-in guards always win over autoApprove rules.'))
  say('')
  for (const guard of ALL_GUARDS) {
    say(`  ${c.red('!')} ${guard.id.padEnd(24)} ${c.dim(guard.why)}`)
  }
  say(`  ${c.red('!')} ${'protected-path'.padEnd(24)} ${c.dim('writes to .ssh, .env, /etc, credentials, …')}`)
  say('')
}

function cmdLog(argv) {
  const config = loadConfig()
  const entries = readLog(config.logPath, Number(argv[0]) || 20)
  if (entries.length === 0) {
    say(c.dim(`no entries in ${config.logPath}`))
    return
  }
  say('')
  for (const entry of entries) {
    const mark = entry.decision === 'allow' ? c.green('✓') : c.yellow('?')
    const time = (entry.at ?? '').slice(11, 19)
    // Multi-line commands are the norm, so collapse whitespace to keep one
    // decision on one row.
    const subject = (entry.subject ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
    say(`  ${c.dim(time)} ${mark} ${c.bold((entry.tool ?? '?').padEnd(10))} ${c.dim(subject)}`)
  }
  say('')
}

function cmdToggle(enabled) {
  const config = loadConfig()
  config.enabled = enabled
  saveConfig(config)
  say(enabled ? c.green('✓ auto-approval on') : c.yellow('auto-approval off'))
}

function cmdMode(argv) {
  const mode = argv[0]
  if (!['safe', 'aggressive', 'off'].includes(mode)) fail('usage: claude-autoyes mode <safe|aggressive|off>')
  const config = loadConfig()
  config.mode = mode
  saveConfig(config)
  say(c.green(`✓ mode = ${mode}`))
  if (mode === 'aggressive') {
    say(c.yellow('  aggressive approves anything not guarded and not in alwaysAsk.'))
    say(c.yellow(`  Review ${c.cyan('claude-autoyes guards')} before leaving this on.`))
  }
}

const [command, ...argv] = process.argv.slice(2)

try {
  switch (command) {
    case 'install': cmdInstall(); break
    case 'uninstall': cmdUninstall(); break
    case 'status': cmdStatus(); break
    case 'doctor': cmdDoctor(); break
    case 'on': cmdToggle(true); break
    case 'off': cmdToggle(false); break
    case 'mode': cmdMode(argv); break
    case 'explain': cmdExplain(argv); break
    case 'allow': appendRule('autoApprove', argv.join(' ')); break
    case 'ask': appendRule('alwaysAsk', argv.join(' ')); break
    case 'reset': cmdReset(); break
    case 'rules': cmdRules(); break
    case 'guards': cmdGuards(); break
    case 'log': cmdLog(argv); break
    case 'config': say(JSON.stringify(loadConfig(), null, 2)); break
    case undefined:
    case '-h':
    case '--help':
    case 'help': say(USAGE); break
    case '-v':
    case '--version': say(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version); break
    default:
      fail(`unknown command "${command}" — run claude-autoyes --help`)
  }
} catch (error) {
  fail(error.message)
}
