"""Marvice voice bot: Deepgram (speech-to-text) -> OpenAI (LLM) -> Cartesia (text-to-speech).

Runs on Pipecat's development runner, which serves a browser test client at /client
and connects callers over WebRTC.

    python bot.py --host 0.0.0.0 --port 7860
"""

import os

from dotenv import load_dotenv
from loguru import logger
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.frames.frames import LLMRunFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineParams, PipelineWorker
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.runner.types import RunnerArguments
from pipecat.runner.utils import create_transport
from pipecat.services.cartesia.tts import CartesiaTTSService
from pipecat.services.deepgram.stt import DeepgramSTTService
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.transports.base_transport import BaseTransport, TransportParams
from pipecat.workers.runner import WorkerRunner

load_dotenv(override=True)

SYSTEM_PROMPT = os.getenv(
    "BOT_SYSTEM_PROMPT",
    "You are the voice assistant for Marvice Media, a digital agency in Bengaluru. "
    "Your replies are spoken aloud, so keep them short and conversational, "
    "and never use lists, markdown, emojis or special characters. "
    "If someone wants a quote or a call back, take their name, company and phone number.",
)

# Each transport the runner supports needs its parameters here; this bot uses WebRTC only.
transport_params = {
    "webrtc": lambda: TransportParams(audio_in_enabled=True, audio_out_enabled=True),
}


def require_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


async def run_bot(transport: BaseTransport, runner_args: RunnerArguments):
    stt = DeepgramSTTService(
        api_key=require_env("DEEPGRAM_API_KEY"),
        settings=DeepgramSTTService.Settings(
            model=os.getenv("DEEPGRAM_MODEL", "nova-3-general")
        ),
    )
    llm = OpenAILLMService(
        api_key=require_env("OPENAI_API_KEY"),
        settings=OpenAILLMService.Settings(
            model=os.getenv("OPENAI_MODEL", "gpt-4.1-mini"),
            system_instruction=SYSTEM_PROMPT,
        ),
    )
    tts = CartesiaTTSService(
        api_key=require_env("CARTESIA_API_KEY"),
        settings=CartesiaTTSService.Settings(voice=require_env("CARTESIA_VOICE_ID")),
    )

    context = LLMContext()
    aggregators = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(vad_analyzer=SileroVADAnalyzer()),
    )

    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            aggregators.user(),
            llm,
            tts,
            transport.output(),
            aggregators.assistant(),
        ]
    )

    worker = PipelineWorker(
        pipeline,
        params=PipelineParams(enable_metrics=True, enable_usage_metrics=True),
        idle_timeout_secs=runner_args.pipeline_idle_timeout_secs,
    )

    @transport.event_handler("on_client_connected")
    async def on_client_connected(transport, client):
        logger.info("Client connected")
        context.add_message(
            {
                "role": "developer",
                "content": "Greet the caller briefly and ask how you can help.",
            }
        )
        await worker.queue_frames([LLMRunFrame()])

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport, client):
        logger.info("Client disconnected")
        await worker.cancel()

    runner = WorkerRunner(
        handle_sigint=runner_args.handle_sigint,
        handle_sigterm=runner_args.handle_sigterm,
    )
    await runner.add_workers(worker)
    await runner.run()


async def bot(runner_args: RunnerArguments):
    """Entry point the Pipecat runner calls for every new session."""
    transport = await create_transport(runner_args, transport_params)
    await run_bot(transport, runner_args)


if __name__ == "__main__":
    from pipecat.runner.run import main

    main()
