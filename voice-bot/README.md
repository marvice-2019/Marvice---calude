# Marvice voice bot

Browser voice assistant built on [Pipecat](https://github.com/pipecat-ai/pipecat) 1.12.0:
Deepgram (speech-to-text) → OpenAI (LLM) → Cartesia (text-to-speech), with Silero VAD for
turn detection and barge-in. Callers connect over WebRTC from the built-in test page at `/client`.

## Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `DEEPGRAM_API_KEY` | yes | | console.deepgram.com |
| `OPENAI_API_KEY` | yes | | platform.openai.com |
| `CARTESIA_API_KEY` | yes | | play.cartesia.ai |
| `CARTESIA_VOICE_ID` | yes | | Copy a voice ID from play.cartesia.ai/voices |
| `OPENAI_MODEL` | no | `gpt-4.1-mini` | |
| `DEEPGRAM_MODEL` | no | `nova-3-general` | |
| `BOT_SYSTEM_PROMPT` | no | Marvice receptionist prompt in `bot.py` | |
| `PIPECAT_ICE_SERVERS` | no | | STUN/TURN servers, e.g. `stun:stun.l.google.com:19302` |

For local runs, put them in a `.env` file next to `bot.py` (it is gitignored).

## Run locally

```bash
cd voice-bot
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
python bot.py -t webrtc
```

Open http://localhost:7860/client, allow the microphone, and press Connect.

## Deploy on Coolify

1. New Resource → Public Repository (or your GitHub app) → this repo, branch of choice.
2. Build Pack: **Dockerfile**, Base Directory: `/voice-bot`, Port: `7860`.
3. Add the environment variables above (mark the API keys as secrets).
4. Set a domain such as `https://voice.marvice.tech`. HTTPS is required, because browsers only
   allow the microphone on secure pages.
5. Deploy, then open `https://<domain>/client`.

**WebRTC media needs UDP.** Coolify's proxy only forwards HTTP, so it carries the signalling
but not the audio, which flows over random UDP ports. If the page connects but you hear
nothing, add `--network=host` under Custom Docker Options and open the UDP range in the VPS
firewall, or put a TURN server in `PIPECAT_ICE_SERVERS`. Test this first on the real VPS.

## Notes

- `bot.py` uses Pipecat's development runner. It is fine for a pilot. For many concurrent
  callers, move to a production server or Pipecat Cloud.
- Each session stops after 5 minutes of silence (the runner default).
