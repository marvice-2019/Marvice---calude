# Marvice---calude -- documentation

Marvice Media's working repo: app subdomains (`aistudio`, `aivideo`, `video`), the `voice-bot`, deploy scripts and the agent skills the team works with.

This directory is a wiki maintained by an LLM: linked markdown pages, nothing outside the
repository. The rules are in [`CLAUDE.md`](CLAUDE.md).

## Start here

Grow mode: pages are added as work touches each area.

1. [[agent-skills]] -- how agent skills are installed and committed here

---

## concepts

<!-- TODO: pages under Domain and product concepts. Mostly survive code changes. `- [[page-name]] -- one line` -->

## architecture

<!-- TODO: pages under System structure, data model, main flows. `- [[page-name]] -- one line` -->

## subsystems

- [[agent-skills]] -- skills CLI layout, lock file, reverse-api-engineer

## decisions

<!-- TODO: pages under Why it was decided that way (ADRs, known defects). `- [[page-name]] -- one line` -->

## reference

<!-- TODO: pages under Schemas, APIs, env vars -- documents you look values up in. `- [[page-name]] -- one line` -->

## operations

<!-- TODO: pages under Install, deploy, checks, incident response. `- [[page-name]] -- one line` -->

## history

<!-- TODO: pages under Development history, lessons, migrated records. `- [[page-name]] -- one line` -->

---

## Using this wiki

```
/docs-sync     right after a deploy or release -- reads only what changed since verified_at
/docs-lint     integrity check (orphans, broken links, broken sources, stale, unverified)
/docs-query    ask the docs. If it is not there, the answer says so
/docs-status   commits not yet reflected, stale pages, recent work
```

Every page carries `verified_at`, the commit it was checked against. Change code, run
`/docs-sync`.
