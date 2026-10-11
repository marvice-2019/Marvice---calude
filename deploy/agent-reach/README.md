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

## Web terminal at agent.marvice.tech
Optional: a password-protected browser terminal, so you can run `claude` from a phone or laptop
without SSH. Run it after `install.sh`, on the Coolify server:
```bash
# DNS first: A record agent.marvice.tech -> the server's IP
sudo bash web-terminal.sh
# lock it to office/home IPs (recommended):
sudo ALLOW_IPS="203.0.113.4/32,198.51.100.0/24" bash web-terminal.sh
```
What it does:
1. Installs tmux and the [ttyd](https://github.com/tsl0922/ttyd) 1.7.7 binary (checksum-verified)
2. Runs `agent-terminal` (systemd) as the `agent` user, bound to the docker0 gateway only, port 7681
3. Writes `/data/coolify/proxy/dynamic/agent-terminal.yaml` so Coolify's Traefik serves it on HTTPS
   (Let's Encrypt) with basic auth (`/etc/agent-reach/htpasswd`), a rate limit and, if set, an IP allowlist

The session is a tmux session called `main`: closing the browser keeps work running, reopening
reattaches. Coolify servers only (it exits if `coolify-proxy` isn't a running Traefik).

**Security:** whoever gets past the password has a shell as `agent` (no sudo) with its Claude
login and saved cookies. Use a 16+ character password, set `ALLOW_IPS` where you can, and never
share the login with clients. Turn it off with
`systemctl disable --now agent-terminal && rm /data/coolify/proxy/dynamic/agent-terminal.yaml`.

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
