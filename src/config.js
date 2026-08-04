import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Config location, in precedence order:
 *   AUTOYES_CONFIG        explicit file (used by the test suite)
 *   CLAUDE_CONFIG_DIR     Claude Code's own relocation env var
 *   ~/.claude/autoyes.json
 */
export function claudeDir(env = process.env) {
  return env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
}

export function configPath(env = process.env) {
  return env.AUTOYES_CONFIG || join(claudeDir(env), 'autoyes.json')
}

export const CONFIG_PATH = configPath()
export const DEFAULT_LOG_PATH = join(claudeDir(), 'autoyes.log')

/**
 * `safe`       — approve what matches `autoApprove`, ask about everything else.
 * `aggressive` — approve anything that is not guarded or in `alwaysAsk`.
 * `off`        — approve nothing; every prompt behaves as it does today.
 */
export const DEFAULT_CONFIG = {
  enabled: true,
  mode: 'safe',
  terminals: ['iTerm.app'],
  log: true,
  logPath: DEFAULT_LOG_PATH,
  unsafeDisableBuiltinGuards: false,

  autoApprove: [
    // Navigation and shell no-ops. `cd` matters more than it looks: agents
    // prefix almost every command with `cd <dir> && …`, and because approval
    // requires *every* segment to match, leaving `cd` out would silently
    // reject nearly every real command line.
    'Bash(cd *)',
    'Bash(pwd)',
    'Bash(true)',
    'Bash(:)',

    // Read-only inspection.
    'Read',
    'Glob',
    'Grep',
    'NotebookRead',
    'TodoWrite',
    'Bash(ls *)',
    'Bash(cat *)',
    'Bash(head *)',
    'Bash(tail *)',
    'Bash(wc *)',
    'Bash(file *)',
    'Bash(stat *)',
    'Bash(du *)',
    'Bash(df *)',
    'Bash(which *)',
    'Bash(type *)',
    'Bash(command -v *)',
    'Bash(readlink *)',
    'Bash(basename *)',
    'Bash(dirname *)',
    'Bash(realpath *)',
    'Bash(echo *)',
    'Bash(printf *)',
    'Bash(tree *)',
    'Bash(find *)',
    'Bash(rg *)',
    'Bash(grep *)',
    'Bash(diff *)',
    'Bash(sort *)',
    'Bash(uniq *)',
    'Bash(cut *)',
    'Bash(tr *)',
    'Bash(nl *)',
    'Bash(sed -n *)',
    'Bash(sleep *)',
    'Bash(export *)',
    'Bash(jq *)',
    'Bash(date *)',
    'Bash(whoami)',
    'Bash(uname *)',
    'Bash(env)',

    // Git, read-only or additive only.
    'Bash(git status*)',
    'Bash(git diff*)',
    'Bash(git log*)',
    'Bash(git show*)',
    'Bash(git branch)',
    'Bash(git branch -v*)',
    'Bash(git remote*)',
    'Bash(git stash list*)',
    'Bash(git rev-parse*)',
    'Bash(git ls-files*)',
    'Bash(git blame*)',
    'Bash(git describe*)',
    'Bash(git config --get*)',
    'Bash(git add *)',
    'Bash(git fetch*)',
    'Bash(git pull*)',

    // gh, read-only subcommands only. `gh api` is absent on purpose: it can
    // POST and DELETE, so it stays a prompt.
    'Bash(gh repo view*)',
    'Bash(gh pr view*)',
    'Bash(gh pr list*)',
    'Bash(gh pr diff*)',
    'Bash(gh issue view*)',
    'Bash(gh issue list*)',
    'Bash(gh run list*)',
    'Bash(gh run view*)',
    'Bash(gh run watch*)',
    'Bash(gh auth status*)',

    // Build, test, lint — the loop you actually want uninterrupted.
    'Bash(npm run *)',
    'Bash(npm test*)',
    'Bash(npm ci)',
    'Bash(npm install)',
    'Bash(pnpm *)',
    'Bash(yarn *)',
    'Bash(bun *)',
    'Bash(node *)',
    'Bash(npx *)',
    'Bash(make *)',
    'Bash(cargo *)',
    'Bash(go *)',
    'Bash(swift *)',
    'Bash(pytest *)',
    'Bash(python *)',
    'Bash(python3 *)',
    'Bash(uv *)',
    'Bash(ruff *)',
    'Bash(eslint *)',
    'Bash(prettier *)',
    'Bash(tsc *)',
    'Bash(mkdir -p *)',
  ],

  // Matched before autoApprove: these always fall through to the normal prompt.
  alwaysAsk: [
    'Bash(git commit*)',
    'Bash(git push*)',
    'Bash(gh pr *)',
    'Bash(gh release *)',
    'Bash(gh repo delete*)',
    'Bash(docker *)',
    'Bash(ssh *)',
    'Bash(scp *)',
  ],
}

/** Config is user-authored, so a malformed file must not break the hook. */
export function loadConfig(path = configPath()) {
  let raw
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return { ...DEFAULT_CONFIG, _source: 'defaults' }
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return { ...DEFAULT_CONFIG, _source: 'defaults', _error: `invalid JSON in ${path}: ${error.message}` }
  }

  return mergeConfig(parsed, path)
}

export function mergeConfig(partial, source = 'inline') {
  const merged = { ...DEFAULT_CONFIG, ...partial, _source: source }

  // Arrays replace rather than concatenate, so a user can genuinely narrow the
  // defaults. `extendAutoApprove` covers the additive case.
  for (const key of ['autoApprove', 'alwaysAsk', 'terminals']) {
    if (!Array.isArray(merged[key])) merged[key] = [...DEFAULT_CONFIG[key]]
  }
  if (Array.isArray(partial?.extendAutoApprove)) {
    merged.autoApprove = [...merged.autoApprove, ...partial.extendAutoApprove]
  }
  if (Array.isArray(partial?.extendAlwaysAsk)) {
    merged.alwaysAsk = [...merged.alwaysAsk, ...partial.extendAlwaysAsk]
  }
  if (!['safe', 'aggressive', 'off'].includes(merged.mode)) merged.mode = 'safe'

  return merged
}

export function saveConfig(config, path = configPath()) {
  const { _source, _error, ...clean } = config
  writeFileSync(path, `${JSON.stringify(clean, null, 2)}\n`, 'utf8')
  return path
}
