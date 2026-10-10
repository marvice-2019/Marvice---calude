# Agent Reach on the Coolify VPS

Installs [Agent Reach](https://github.com/Panniantong/Agent-Reach) and Claude Code on an
Ubuntu/Debian server under a dedicated non-root user, so Claude Code on the server can read
web pages, YouTube, GitHub, X and similar sources.

## Prerequisites
- Root access, Ubuntu/Debian with Python 3.10+
- Outbound HTTPS to github.com, pypi.org, deb.nodesource.com and claude.ai
- No DNS or open ports needed: Agent Reach only makes outbound requests

## Install
```bash
git clone https://github.com/marvice-2019/Marvice---calude.git
cd Marvice---calude/deploy/agent-reach
sudo bash install.sh
```
Re-running the script is safe and upgrades Agent Reach. Options:
- `AGENT_USER=name` uses a different user (default `agent`)
- `RUN_SYSTEM=no` only checks the environment; Agent Reach does not install its own
  dependencies or the Claude Code skill

Do not `pip install agent-reach` from PyPI: that package name belongs to a different project.

## What it does
1. Installs Python 3 venv, git, curl and `gh`; installs Node.js 22 if Node is missing or older than 18
2. Creates user `agent` (no password, no sudo)
3. As `agent`: installs Agent Reach into `~/.agent-reach-venv` and Claude Code via the official installer
4. Runs `agent-reach install --env=auto --dry-run`, then `--system` (dependencies + Claude Code skill)
5. Restricts `~/.agent-reach` to the `agent` user (`config.yaml` is mode 600)
6. Prints `agent-reach doctor`

Coolify, Docker and existing services are not touched.

## After install
```bash
su - agent
claude                         # sign in to Claude Code once
agent-reach configure proxy    # recommended: datacenter IPs get blocked by YouTube, Reddit, etc.
agent-reach doctor             # shows which channels work and how to fix the rest
```
Sites that need a logged-in Chrome session (Reddit, Instagram, Facebook, Xiaohongshu) won't work
on a headless server; use them from a desktop install instead.

## Accounts and cookies
Cookies and tokens live only in the `agent` user's `~/.agent-reach/config.yaml`. Use spare
accounts, never client or Marvice main accounts: cookie-based access can get accounts banned.

## Uninstall
```bash
su - agent
agent-reach uninstall    # removes ~/.agent-reach, skill files and its MCP config
rm -rf ~/.agent-reach-venv
```
Then, as root, `deluser --remove-home agent` if the user is no longer needed.
