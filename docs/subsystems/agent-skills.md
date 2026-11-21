---
title: Agent skills installed in the repo
type: subsystem
created: 2026-11-21
updated: 2026-11-21
sources:
  - code: skills-lock.json
  - code: .agents/skills/reverse-api-engineer/SKILL.md
  - ext:  https://github.com/kalil0321/reverse-api-engineer
verified_at: 7b721e1
---

Agent skills that are installed with the `skills` CLI (`npx skills add <owner>/<repo>`) live
in the repository, so every clone and every cloud session gets the same set.

## How it is laid out

- **`.agents/skills/<name>/`** holds the real files of each skill (`SKILL.md`, plus
  `references/` where the skill ships them). This is the one copy shared by all agent
  tools (Claude Code, Codex, Cursor and the rest).
- **`.claude/skills/<name>`** is a symlink to `../../.agents/skills/<name>`, which is how
  Claude Code finds the skill. Ten skills are linked this way today; the other entries in
  `.claude/skills/` are plain folders committed directly, not managed by the CLI.
- **`skills-lock.json`** records each CLI-installed skill: its GitHub source, the path of
  its `SKILL.md`, and a content hash. `skills-lock.json:10` is the `reverse-api-engineer`
  entry, the only one that also pins a source `commit` (`skills-lock.json:12`).

To add a skill: run `npx -y skills add <owner>/<repo> -y` from the repository root, then
commit the three things it changes together: the `.agents/skills/<name>/` folder, the
`.claude/skills/<name>` symlink, and `skills-lock.json`.

> ⚠️ Commit the symlink, the skill folder and `skills-lock.json` in the same commit. A
> symlink without its target is a dead link in Claude Code, and a lock entry without the
> folder makes the next install think the skill is already there.

> ⚠️ This repository is often used from cloud sessions, which are reclaimed when they go
> idle. A skill that is installed but not committed and pushed disappears with the
> container.

> ⚠️ On Windows, git checks the `.claude/skills/*` symlinks out as small text files
> unless symlinks are enabled (`git config core.symlinks true` with Developer Mode on).
> If skills are missing on Windows, check that first.

> ⚠️ Installed skills run with the agent's full permissions. Read a new skill's
> `SKILL.md` before using it, especially any install command it runs.

## reverse-api-engineer

Added 2026-11-21. It turns a website's private HTTP API into a typed client: a browser does
the task while the `rae` CLI records the network traffic, then a model writes the client.
Use it only when the site has no official API or SDK for the job.

> ⚠️ The skill depends on the `rae` CLI, which the install does **not** add. Install it
> first with `uv tool install reverse-api-engineer` (or pipx), see
> `.agents/skills/reverse-api-engineer/SKILL.md:21`. Each run also spends model API
> credits.

> ⚠️ For client work, check the target site's terms of service before promising an
> integration built on its private API. Private endpoints can change or be blocked
> without notice, so do not sell an SLA on one.
