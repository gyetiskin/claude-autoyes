# claude-autoyes

Auto-approve the routine **"Do you want to proceed?"** prompts in Claude Code — while destructive commands still stop and ask you.

```
$ claude-autoyes explain Bash "git status --short"

  Bash git status --short
  ALLOW (no prompt)
  matched autoApprove rule Bash(git status*)

$ claude-autoyes explain Bash "git status && rm -rf ~/projects"

  Bash git status && rm -rf ~/projects
  ASK  (prompt shown)
  built-in guard "recursive-delete": recursive delete
```

## Why not just `--dangerously-skip-permissions`?

Because that flag is all-or-nothing. `rm -rf`, `git push --force`, `curl … | sh` and a write to `~/.ssh/config` are approved just as silently as `ls`.

`claude-autoyes` sits in between:

| | prompts for `ls` | prompts for `rm -rf ~` | audit log |
|---|---|---|---|
| default Claude Code | yes | yes | no |
| `--dangerously-skip-permissions` | no | **no** | no |
| **claude-autoyes** | no | **yes** | yes |

It runs as a [`PreToolUse` hook](https://docs.claude.com/en/docs/claude-code/hooks), so it decides *before* the prompt would appear. It never denies anything — the worst it does is let the normal prompt through.

## Install

```bash
npm install -g claude-autoyes
claude-autoyes install
```

Then restart Claude Code (or open `/hooks` once) so the hook is picked up.

To run from a clone instead:

```bash
git clone https://github.com/gyetiskin/claude-autoyes.git
cd claude-autoyes && node bin/cli.js install
```

## How the decision is made

Each pending tool call runs through five checks, in order. The first one that matches wins:

1. **Off switch** — `enabled: false` or `mode: "off"` → prompt as usual.
2. **Terminal** — not in `terminals` → prompt as usual. Fails closed: an unidentifiable terminal never auto-approves.
3. **Built-in guards** — destructive or irreversible → prompt as usual. Guards beat every rule you can write.
4. **`alwaysAsk` rules** → prompt as usual.
5. **`autoApprove` rules** → approved, no prompt.

Anything reaching the end is decided by `mode`: `safe` prompts, `aggressive` approves.

### Command chains are split first

A rule like `Bash(git status*)` would otherwise approve `git status && rm -rf ~`, since the whole line still starts with `git status`. So command lines are split on `&&`, `||`, `;`, `|` and newlines (respecting quotes), and:

- **approving requires *every* segment to match a rule** — different segments may match different rules, so `git add . && git status` is fine;
- **asking requires only *one* segment to match** a guard or an `alwaysAsk` rule.

Before matching, each segment is reduced to the command it actually runs:

- leading `FOO=1` assignments and `env`/`command`/`nohup`/`time`/`exec` wrappers are stripped, so `env X=1 sudo rm -rf /` cannot hide behind them;
- shell keywords and grouping (`if`, `then`, `do`, `{`, `(`, …) are stripped. This is not cosmetic: `if sudo rm -rf /; then` produces a segment beginning with `if`, and the privilege-escalation guard is anchored at `^sudo`, so without it the guard would never fire;
- git's global options are folded away, so `git -C /repo commit` and `git -c user.name=x commit` still meet the `Bash(git commit*)` rule instead of slipping past it;
- `sh -c "…"` script arguments are unpacked and checked, so approving `bash *` does not become a way to run anything;
- `$( … )` and backtick substitutions are pulled out and checked as commands in their own right. Skipping them was a guard bypass: `sudo apt-get install x` is caught, but `echo $(sudo apt-get install x)` used to be approved by the `echo` rule alone;
- heredoc bodies are masked. `cat > f <<'EOF' … EOF` is data, not commands — otherwise a file whose contents mention `sort` would be matched as if the shell were running `sort`.

## Why iTerm2?

The gate exists so auto-approval is scoped to the terminal where *you* are sitting and watching. A cron job, a CI runner, or an SSH session inherits a different `TERM_PROGRAM` and keeps prompting.

If you want it everywhere, opt in explicitly:

```jsonc
{ "terminals": ["*"] }              // any terminal
{ "terminals": ["iTerm.app", "Ghostty", "WezTerm"] }
```

Detection reads `LC_TERMINAL` first, then `TERM_PROGRAM`, because iTerm2 forwards `LC_TERMINAL` over SSH.

## Configuration

`~/.claude/autoyes.json` — created on install, safe to edit by hand. A malformed file falls back to the built-in defaults rather than breaking your session.

```jsonc
{
  "enabled": true,
  "mode": "safe",                    // safe | aggressive | off
  "terminals": ["iTerm.app"],
  "log": true,
  "logPath": "~/.claude/autoyes.log",

  "autoApprove": ["Read", "Grep", "Bash(git status*)", "Bash(npm run *)"],
  "alwaysAsk":   ["Bash(docker *)", "Bash(ssh *)"],

  "unsafeDisableBuiltinGuards": false
}
```

`autoApprove`, `alwaysAsk` and `terminals` **replace** the defaults when you set them. To add to the defaults instead, use `extendAutoApprove` / `extendAlwaysAsk`.

### Rule syntax

Identical to Claude Code's own permission rules:

| Rule | Matches |
|---|---|
| `Read` | every `Read` call |
| `Bash(git status*)` | `Bash` whose command matches the glob |
| `Edit(src/*)` | `Edit` whose `file_path` matches |
| `WebFetch(https://docs.*)` | `WebFetch` whose URL matches |
| `*` | any tool |

`*` matches any run of characters, `?` matches one, everything else is literal.

A trailing `" *"` means "arguments", and arguments are optional: `Bash(sort *)` covers both `sort -u file` and the bare `sort` in `… | sort | uniq -c`. Write rules this way rather than as `Bash(sort*)` — the latter would also match `sortfoo`, which is how an `ls*` rule ends up approving `lsof`.

### File edits

`Edit`, `Write` and `NotebookEdit` are auto-approved, because the protected-path guard already covers what actually matters: credentials, git hooks, and the settings files that decide what gets auto-approved in the first place. A tool that can silently rewrite its own permission rules is not one you could audit, so those edits always surface a prompt.

To review every edit instead, narrow the rule to the directories you trust:

```bash
claude-autoyes ask 'Edit'                            # back to prompting for all edits
claude-autoyes allow 'Edit(/Users/me/projects/*)'    # or scope it
```

### Modes

| Mode | Unmatched call |
|---|---|
| `safe` *(default)* | prompts — you opt in rule by rule |
| `aggressive` | approved — you opt *out* via guards and `alwaysAsk` |
| `off` | nothing is auto-approved |

`aggressive` still honours every guard. It suits throwaway repos, not your production checkout.

## Built-in guards

These always fall through to a prompt, whatever your rules say. Run `claude-autoyes guards` for the live list.

`recursive-delete` · `mass-delete` · `root-delete` · `privilege-escalation` · `pipe-to-shell` · `force-push` · `history-rewrite` · `branch-delete` · `disk-write` · `permission-change` · `ownership-change` · `fork-bomb` · `process-kill` · `system-power` · `publish` · `infra-apply` · `api-write` · `config-write` · `credential-read` · `history-clear` · `protected-path`

The guards draw the line at *scope*, not at the command name: `rm -f build.zip` is routine cleanup and is approved, while `rm -f *.zip` deletes an unknown number of files and prompts. Likewise `git push` is approved but `git push --force` is guarded, and `git push --force-with-lease` is not.

Guards can be switched off with `unsafeDisableBuiltinGuards: true`. At that point you have rebuilt `--dangerously-skip-permissions` with extra steps, so please don't.

## Commands

```
claude-autoyes install            Register the hook in ~/.claude/settings.json
claude-autoyes uninstall          Remove the hook (config is kept)
claude-autoyes status             Installation, terminal and config state
claude-autoyes doctor             Diagnose why prompts are/aren't auto-approved
claude-autoyes on | off           Toggle without uninstalling
claude-autoyes mode safe          safe | aggressive | off
claude-autoyes explain <tool> [subject]
                                  Dry-run one call and print the decision
claude-autoyes allow '<rule>'     Append to autoApprove
claude-autoyes ask '<rule>'       Append to alwaysAsk
claude-autoyes reset              Refresh rule lists from the built-in defaults
claude-autoyes rules              List active rules
claude-autoyes guards             List built-in guards
claude-autoyes log [n]            Last n decisions
claude-autoyes config             Print the resolved config
```

`explain` runs the exact code path the hook runs, so it is the fastest way to test a rule before trusting it.

Upgrading the package does not touch an existing `~/.claude/autoyes.json`, so a new release's rules are not picked up automatically. Run `claude-autoyes reset` after upgrading to refresh the rule lists (your mode, terminals and log settings are kept, and the old file is saved as `autoyes.json.bak`).

## Audit log

Auto-approval is only trustworthy if you can check what happened. Every decision — approved *and* prompted — is appended to `~/.claude/autoyes.log` as one JSON line:

```json
{"at":"2026-08-04T09:14:02.001Z","session":"a1b2","tool":"Bash","subject":"git status --short","decision":"allow","reason":"matched autoApprove rule Bash(git status*)"}
```

```bash
claude-autoyes log 50
```

Set `"log": false` to turn it off.

## Safety design

- **Never denies.** The hook emits `allow` or nothing at all. It cannot block a tool call.
- **Fails closed.** Bad JSON on stdin, a corrupt config, an unknown terminal, an unexpected exception — all end in "emit nothing, exit 0", which just shows you the normal prompt.
- **Guards outrank rules.** No `autoApprove` entry and no `aggressive` mode can override a guard.
- **Backs up settings.** `install` and `uninstall` copy `settings.json` to `settings.json.autoyes-backup` first, and merge into your existing hooks rather than replacing them.
- **Fast.** ~30 ms per call, no dependencies.

## Uninstall

```bash
claude-autoyes uninstall     # removes the hook, leaves other hooks untouched
rm ~/.claude/autoyes.json    # optional
```

## Development

```bash
npm test        # 55 tests, node:test, no dependencies
```

`src/decide.js` is a pure function over `{ toolName, toolInput, config, env }`, so the whole policy is testable without touching the filesystem.

## License

MIT
