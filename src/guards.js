/**
 * Built-in safety guards.
 *
 * These are the reason claude-autoyes exists instead of
 * `--dangerously-skip-permissions`: everything routine gets approved, and the
 * genuinely destructive or irreversible actions still stop and ask you.
 *
 * Guards win over every allow-rule. They can only be turned off wholesale with
 * `unsafeDisableBuiltinGuards: true`, which the CLI warns loudly about.
 */

import { splitCommand, normalizeSegment } from './shell.js'

/**
 * Guards evaluated against a single command segment.
 * @type {{id: string, why: string, test: RegExp}[]}
 */
export const BASH_GUARDS = [
  { id: 'recursive-delete', why: 'recursive delete', test: /\brm\s+(-\w*[rR]\w*\s+)*-\w*[rR]/ },
  // `rm -f build.zip` is routine cleanup; `rm -f *.zip` is not. Guarding every
  // -f made deploy scripts prompt constantly, which trains you to stop reading
  // the prompts. Guard the shape that deletes an unknown number of files.
  { id: 'mass-delete', why: 'deletes a wildcard set of files', test: /\brm\s(?:[^|;&]*\s)?-?\S*[*?]/ },
  { id: 'root-delete', why: 'deletes a root or home path', test: /\brm\s+(?:-\S+\s+)*(?:\/|~|\$HOME)\/?\s*$/ },
  { id: 'privilege-escalation', why: 'runs as root', test: /^(sudo|doas|su)\b/ },
  { id: 'force-push', why: 'rewrites remote history', test: /\bgit\s+push\b[\s\S]*(--force(?!-with-lease)|(?:^|\s)-f(?=\s|$))/ },
  { id: 'history-rewrite', why: 'destroys local commits', test: /\bgit\s+(reset\s+--hard|clean\s+-\w*[fd]|filter-branch|rebase\s+(-i|--interactive))/ },
  { id: 'branch-delete', why: 'deletes a branch', test: /\bgit\s+(branch\s+-\w*D|push\s+\S+\s+--delete)/ },
  { id: 'disk-write', why: 'writes to a raw device', test: /\b(dd\s+[\s\S]*of=|mkfs(\.\w+)?|fdisk|diskutil\s+(erase|reformat))\b/ },
  { id: 'permission-change', why: 'weakens file permissions', test: /\bchmod\s+(-\w+\s+)*(777|a\+w|o\+w)/ },
  { id: 'ownership-change', why: 'changes file ownership', test: /\bchown\b/ },
  { id: 'fork-bomb', why: 'fork bomb', test: /:\(\)\s*\{.*\|.*&.*\}/ },
  { id: 'process-kill', why: 'kills processes broadly', test: /\b(killall|pkill)\b|\bkill\s+-9\b/ },
  { id: 'system-power', why: 'shuts the machine down', test: /\b(shutdown|reboot|halt)\b/ },
  { id: 'publish', why: 'publishes a release publicly', test: /\b(npm|pnpm|yarn)\s+publish\b|\btwine\s+upload\b|\bcargo\s+publish\b|\bgem\s+push\b/ },
  { id: 'infra-apply', why: 'mutates live infrastructure', test: /\b(terraform\s+(apply|destroy)|kubectl\s+delete|helm\s+(delete|uninstall)|aws\s+\S+\s+delete)/ },
  { id: 'credential-read', why: 'reads credentials', test: /(~|\$HOME)?\/?\.(ssh|aws|gnupg)\/|\bsecurity\s+find-(generic|internet)-password\b|\.env(\.|\s|$)/ },
  { id: 'history-clear', why: 'erases shell history', test: /\bhistory\s+-c\b|>\s*~?\/?\.(bash|zsh)_history/ },
]

/**
 * Guards evaluated against the whole command line. These describe a
 * *relationship between* segments, so they would be invisible to a
 * segment-by-segment scan — splitting `curl … | sh` on the pipe leaves two
 * individually innocuous halves.
 *
 * @type {{id: string, why: string, test: RegExp}[]}
 */
export const COMMAND_GUARDS = [
  {
    id: 'pipe-to-shell',
    why: 'executes downloaded code',
    test: /\b(curl|wget|fetch)\b[\s\S]*\|\s*(sudo\s+|xargs\s+)?(ba|z|k|da)?sh\b/,
  },
  {
    id: 'pipe-to-interpreter',
    why: 'pipes downloaded code into an interpreter',
    test: /\b(curl|wget|fetch)\b[\s\S]*\|\s*(sudo\s+)?(python3?|perl|ruby|node)\b/,
  },
]

/** Every guard, for display purposes. */
export const ALL_GUARDS = [...COMMAND_GUARDS, ...BASH_GUARDS]

/**
 * Paths that must never be silently written to.
 *
 * Includes the files that decide what gets auto-approved — Claude Code's
 * settings, this tool's own config, and anything that executes on its own
 * (git hooks). A tool that can silently rewrite its own permission rules is
 * not one you can audit, so those edits always surface a prompt.
 */
export const PROTECTED_PATH = new RegExp(
  [
    String.raw`(^|/)\.(env|ssh|aws|npmrc|netrc|gnupg)(/|$)`,
    String.raw`(^|/)\.git/(config|hooks/)`,
    String.raw`(^|/)\.claude/settings(\.local)?\.json$`,
    String.raw`(^|/)autoyes\.json$`,
    String.raw`(^|/)(id_rsa|id_ed25519|credentials)$`,
    String.raw`^/(etc|usr|bin|sbin|System|Library)/`,
  ].join('|'),
)

/**
 * @param {string} toolName
 * @param {Record<string, any>} toolInput
 * @returns {{id: string, why: string}|null} the guard that tripped, if any
 */
export function checkGuards(toolName, toolInput = {}) {
  if (toolName === 'Bash' || toolName === 'BashOutput') {
    const command = toolInput.command
    if (typeof command !== 'string') return null

    const wholeLine = COMMAND_GUARDS.find((g) => g.test.test(command))
    if (wholeLine) return { id: wholeLine.id, why: wholeLine.why }

    for (const segment of splitCommand(command)) {
      const normalized = normalizeSegment(segment)
      const hit = BASH_GUARDS.find((g) => g.test.test(normalized))
      if (hit) return { id: hit.id, why: hit.why }
    }
    return null
  }

  if (['Write', 'Edit', 'NotebookEdit', 'MultiEdit'].includes(toolName)) {
    const path = toolInput.file_path ?? toolInput.notebook_path
    if (typeof path === 'string' && PROTECTED_PATH.test(path)) {
      return { id: 'protected-path', why: 'writes to a protected path' }
    }
  }

  return null
}
