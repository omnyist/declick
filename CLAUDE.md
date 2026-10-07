# declick

> Oxlint presets for TypeScript and React projects (`oxlint/*.json`), and a test helper (`src/guard.ts`, published as `@omnyist/declick/guard`) that checks the configured rules still run. Public, MIT, on npm as `@omnyist/declick`. README.md is the user-facing documentation; this file is for working on the package.

## What it is (and refuses to be)

- **Presets are plain JSON** that consumers extend by path (`./node_modules/@omnyist/declick/oxlint/<preset>.json`), because Oxlint's JSON config can't extend a package by name. Don't switch them to `oxlint.config.ts`; that format is experimental and needs Node.
- **Every preset names its `plugins`.** A file that leaves them out makes Oxlint add its defaults. Use brace globs (`{ts,tsx}`), never extglobs (`@(ts|tsx)`), which Oxlint never matches.
- **The guard asserts nothing itself.** `resolvedConfig()` and `plant()` return data; the consumer's test runner asserts. It runs the consumer's own `oxlint` with `spawn` and no shell, and uses only Node's standard library, so it works under Bun, Node, Vitest and Jest.
- **No rules for one project.** A rule belongs here only if every consumer of that preset should have it; a project's exceptions live in its own `.oxlintrc.json`.

## Working here

```sh
bun install          # also builds dist/
bun run typecheck
bun run lint
bun test
node test/node-smoke.mjs
```

- Each folder in `test/fixtures/` extends some presets and breaks their rules. A preset change shows up as a fixture or snapshot change; update `test/__snapshots__/` in the same commit, on purpose.
- Behavior the README describes was measured on a specific Oxlint; when Oxlint changes, re-measure before editing the README's traps.

## Releasing

Bump `version` in `package.json`, commit, tag `v<version>`, push the tag. `.github/workflows/publish.yml` checks the tag matches, runs the checks, and publishes through npm's trusted publishing (no token; provenance). A mismatched tag fails before publishing.

## Commits

Public repo: one line, no body, ending with a period, in Bryan's voice ("Accept eslint-plugin-storybook 10."). No attribution trailers.

Status: 0.1.0 published 2026-10-07; publishing from tags once the npm trusted publisher is set (2026-10-07).
