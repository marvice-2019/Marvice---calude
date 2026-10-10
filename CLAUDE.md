# CLAUDE.md

> Adapted from the guidelines in multica-ai/andrej-karpathy-skills (CLAUDE.md). Paraphrased, not a verbatim copy.

These guidelines bias toward caution over speed. For trivial tasks, use judgment on how much of this to apply.

## 1. Think before coding

Don't assume. Don't hide confusion. Surface tradeoffs.

- State your assumptions before you start.
- If a request has more than one reasonable interpretation, lay them out instead of silently picking one.
- If a simpler approach exists, say so.
- If something is unclear, ask.

## 2. Simplicity first

Write the minimum code that solves the problem.

- No speculative features.
- No abstractions that are used only once.
- No configurability nobody asked for.
- No error handling for cases that cannot happen.

## 3. Surgical changes

Touch only what the task requires.

- Don't refactor or reformat adjacent code.
- Match the existing style.
- If you notice unrelated dead code, mention it; don't delete it.
- Remove only the imports or helpers that your own change made unused.

## 4. Goal-driven execution

Turn tasks into verifiable goals.

- For a bug, first write a test that reproduces it, then fix it.
- Before starting, state a short step-by-step plan, with a check for each step.
- A step is done when its check passes, not when the code looks right.
