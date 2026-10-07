# OpenMontage on aivideo.marvice.tech

Installs [OpenMontage](https://github.com/calesthio/OpenMontage) on an Ubuntu/Debian server and
publishes its Backlot storyboard UI at `https://aivideo.marvice.tech` behind basic auth.

## Prerequisites
- DNS `A` record for `aivideo.marvice.tech` pointing at the server
- Ports 80/443 open, root access

## Install
```bash
git clone https://github.com/marvice-2019/Marvice---calude.git
cd Marvice---calude/deploy/openmontage
sudo DOMAIN=aivideo.marvice.tech EMAIL=yuvarajgs@marvice.in bash install.sh
```
Re-running the script updates OpenMontage (`git pull` + `make setup`).

## What it does
1. Installs git, make, FFmpeg, Python 3 venv, Node.js 20, Chromium libs, nginx, certbot
2. Clones OpenMontage to `/opt/OpenMontage` as user `openmontage` and runs `make setup`
3. Runs Backlot (`python -m backlot serve`) on `127.0.0.1:4750` via systemd (`openmontage-backlot`)
4. Puts nginx with basic auth and a Let's Encrypt certificate in front of it

## Making videos
OpenMontage is driven by an AI coding agent, not a web form. On the server:
```bash
sudo -iu openmontage
cd /opt/OpenMontage
claude          # Claude Code (npm i -g @anthropic-ai/claude-code)
# > "Make a 60-second animated explainer about ..."
```
Progress and approvals appear live on https://aivideo.marvice.tech. Optional provider keys
(FAL, ElevenLabs, Pexels, ...) go in `/opt/OpenMontage/.env`.

Note: OpenMontage is AGPLv3.
