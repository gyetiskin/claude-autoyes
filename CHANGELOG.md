# Changelog

Every entry below came from watching the audit log of real sessions rather than from reasoning about what might go wrong. The pattern repeated: a rule that looked safe on paper approved something it should not have, or prompted on something routine until the prompts stopped being read.

## 0.9.0

- Drop the `process-kill` guard. Stopping a dev server you just started is part of the loop and is recoverable — you restart it — so it does not belong beside `rm -rf` and `git push --force`. `kill`, `pkill`, `killall`, `lsof` and `ps` are approved; `shutdown`/`reboot` still are not.

## 0.8.0

- Guard the pipe that feeds a *program*, not the one that feeds *data*. `curl … | python3 -c '…'` was treated as running downloaded code; it is not, since the program is written out in the command and the pipe carries only the response body. The guard now fires only when the interpreter takes no `-c` and so reads its program from the pipe: `curl … | sh`, `curl … | python3`.
- `pipe-to-shell` and `pipe-to-interpreter` merge into one rule; that distinction was never the one that mattered.

## 0.7.0

- Separate `git config` reads from writes. Approving `git config *` outright would also approve `git config core.hooksPath /tmp/evil`, which makes git execute arbitrary code on the next command. The two differ by one trailing argument, so the new `config-write` guard is what tells them apart.
- Approve `git ls-remote`, `merge-base`, `name-rev`, `symbolic-ref`, `for-each-ref`, `check-ignore`, `diff-tree`.

## 0.6.0

- Approve text filters (`paste`, `awk`, `column`), the remaining script interpreters (`php`, `ruby`, `perl`, `deno`, `bash`, `sh`), and `gh api` used as a read.
- Adding the interpreters opened a hole a test caught immediately: `bash -c "sudo apt-get install evil"` kept the guarded command inside a quoted argument where the `^sudo`-anchored guard could not see it. Script arguments to `sh -c` are now unpacked and checked, as command substitutions already were.
- New `api-write` guard for `gh api` with `-X POST/PUT/PATCH/DELETE` or the `-f`/`--field` flags.

## 0.5.0

- Guard by scope rather than by command name. `force-delete` fired on every `rm -f`, including `rm -f build.zip`, and a tool that prompts on routine work trains you to stop reading the prompts. It is replaced by `mass-delete` (a wildcard argument, so an unknown number of files) and `root-delete` (`rm -f ~`). `rm -rf` stays guarded.
- `git commit` and `git push` move to auto-approve; `git push --force` is still caught by its own guard.
- Approve `zip`, `unzip`, `tar`.

## 0.4.0

- Auto-approve `Edit`, `Write` and `NotebookEdit` — the largest remaining source of prompts.
- That only holds if the tool cannot quietly widen its own permissions, so `protected-path` now also covers `~/.claude/settings.json`, `autoyes.json` and `.git/hooks/`.

## 0.3.0

- Check command substitutions instead of treating them as text. `sudo apt-get install evil` was caught, but `echo $(sudo …)` and `` echo `sudo …` `` were approved by the `echo` rule alone. Bodies are now extracted and checked as peer segments; nesting recurses, single-quoted text stays inert, and `$(( ))` arithmetic is not a command.

## 0.2.0

- Replaying 85 logged decisions showed only 19% of Bash calls were auto-approved. Agents prefix nearly every command with `cd <dir> && …`, and since approval needs *every* segment to match, one missing `cd` rule sank whole chains.
- Shell keywords were never stripped, so `if sudo rm -rf /; then` produced a segment starting with `if` and the `^sudo` guard never fired — a bypass, not just a usability gap.
- `git -C /repo commit` did not match a `Bash(git commit*)` rule; git global options are now folded away.
- Heredoc bodies were split into fake segments, so file *content* was matched as commands.
- `Bash(ls*)` also matched `lsof`. A trailing `" *"` now covers the bare command too, so command heads stay exact.
- Add `reset`, since installing a new version never rewrites an existing `autoyes.json`.

## 0.1.0

Initial release: `PreToolUse` hook, segment-wise matching, built-in guards, iTerm2 gate, JSONL audit log, and the `install`/`doctor`/`explain` CLI.
