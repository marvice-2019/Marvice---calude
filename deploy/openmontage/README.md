# OpenMontage on aivideo.marvice.tech

Installs [OpenMontage](https://github.com/calesthio/OpenMontage) on an Ubuntu/Debian server and
publishes its Backlot storyboard UI at `https://aivideo.marvice.tech` behind basic auth.

## Prerequisites
- DNS `A` record for `aivideo.marvice.tech` pointing at the server
- Ports 80/443 open, root access

## Option A: deploy with Coolify (recommended for the marvice.tech server)
No SSH needed; everything is done in the Coolify dashboard (https://coolify.marvice.tech).

1. **+ New → Resource → Public Repository**:
   `https://github.com/marvice-2019/Marvice---calude`, branch `main`.
2. Build pack **Docker Compose**, base directory `/deploy/openmontage/docker`,
   compose file `/docker-compose.yml`.
3. On the `openmontage` service set the domain to `https://aivideo.marvice.tech:4750`
   (the `:4750` tells Coolify which container port to route to; visitors use plain https).
4. **Environment variables**: `BACKLOT_PASSWORD` (required), `BACKLOT_USER` (default `admin`).
5. **Deploy**. The first build takes ~10 minutes (image is ~3.3 GB).

The image (`docker/Dockerfile`) contains OpenMontage, FFmpeg, Node 22, Piper TTS, Remotion,
HyperFrames and Claude Code. Projects are kept in the `openmontage-projects` volume.
To make videos, open the service's **Terminal** in Coolify, then `cd /app && claude`.
Provider API keys can be added as environment variables on the service.

## Option B: install directly on the server (SSH)
```bash
git clone https://github.com/marvice-2019/Marvice---calude.git
cd Marvice---calude/deploy/openmontage
sudo DOMAIN=aivideo.marvice.tech EMAIL=yuvarajgs@marvice.in bash install.sh
```
Re-running the script updates OpenMontage (`git pull` + `make setup`).

## What it does
1. Installs git, make, FFmpeg, Python 3 venv, Node.js 22 and Chromium libs
2. Clones OpenMontage to `/opt/OpenMontage` as user `openmontage` and runs `make setup`
3. Runs the Backlot board via systemd (`openmontage-backlot`, port 4750)
4. Publishes it with basic auth (password file `/etc/openmontage/htpasswd`):
   - **Coolify server** (detected via `/data/coolify/proxy`): Backlot binds to the docker0
     gateway and a route is written to `/data/coolify/proxy/dynamic/openmontage.yaml`, so
     Coolify's Traefik serves it with its Let's Encrypt resolver. No nginx is installed.
   - **Plain server**: Backlot binds to `127.0.0.1` behind nginx + certbot.

The `marvice.tech` server (91.108.110.216) runs Coolify, so it uses the first path.

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
