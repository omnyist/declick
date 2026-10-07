# declick

Shared [Oxlint](https://oxc.rs/docs/guide/usage/linter) presets for TypeScript and React projects, and a small test helper that checks the rules you configured still run.

The presets are JSON files your `.oxlintrc.json` extends. The helper, `@omnyist/declick/guard`, gives a test two things to assert on: the config Oxlint resolves, and the rules it reports on code written to break them. A lint config fails quietly. A dropped rule, a glob that never matches, or a plugin that doesn't load just stops reporting, and nothing goes red. The guard turns that into a failing test.

## Why Oxlint

- It lints TypeScript of any version. As of October 2026, typescript-eslint supports TypeScript below 6.1 only, so ESLint can't lint a project on TypeScript 7.
- It has the React Compiler's rules built in, beside the Rules of Hooks.
- Its type-aware rules run through tsgolint, which is built on TypeScript's Go port.
- It loads ESLint plugins as JS plugins, which is how these presets use TanStack Query's and Storybook's rules. Biome has no rules for either and takes plugins only in GritQL.

Oxlint's JS plugins are in alpha as of Oxlint 1.87. The guard's `plant` check fails if one of them stops loading.

## Install

```sh
bun add -d @omnyist/declick oxlint oxlint-tsgolint
```

It is published to npm as `@omnyist/declick`. To use a tagged release from GitHub instead, in `package.json`:

```json
"devDependencies": {
  "@omnyist/declick": "github:omnyist/declick#v0.1.0"
},
"trustedDependencies": ["@omnyist/declick"]
```

The guard is built when the package installs. Bun runs that step for a dependency from GitHub only when it's listed in `trustedDependencies`; without it there's no `dist/` and the guard won't import. npm runs it either way.

Then add whatever the presets you use need:

| Preset            | Install beside it                |
| ----------------- | -------------------------------- |
| `base`            | `oxlint`, `oxlint-tsgolint`      |
| `react`           | nothing more                     |
| `tanstack-query`  | `@tanstack/eslint-plugin-query`  |
| `tanstack-router` | nothing more                     |
| `storybook`       | `eslint-plugin-storybook`        |

`oxlint-tsgolint` runs the type-aware rules. Without it, Oxlint stops with "Failed to find tsgolint executable". If you don't want type-aware linting, set `"options": { "typeAware": false }` in your own config and skip the package.

## Usage

Oxlint's JSON config can't extend a package by name, only a path, so each preset is reached through `node_modules`:

```jsonc
// .oxlintrc.json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "extends": [
    "./node_modules/@omnyist/declick/oxlint/base.json",
    "./node_modules/@omnyist/declick/oxlint/react.json",
    "./node_modules/@omnyist/declick/oxlint/tanstack-query.json",
    "./node_modules/@omnyist/declick/oxlint/tanstack-router.json",
    "./node_modules/@omnyist/declick/oxlint/storybook.json"
  ],
  // Without this, Oxlint adds its default plugins (unicorn, oxc) to the presets' own.
  "plugins": [],
  // Oxlint doesn't take env, globals, settings or ignorePatterns from an extended file.
  "env": { "builtin": true, "browser": true, "es2020": true },
  "ignorePatterns": ["dist"],
  "rules": {
    // Your own additions and changes.
  }
}
```

Run it with `oxlint --report-unused-disable-directives`.

### The presets

**`base`** turns on the typescript plugin and type-aware linting, and names every rule it runs: 48 core rules, 17 TypeScript rules and 17 type-aware ones. Oxlint's default `correctness` category is off, so an Oxlint upgrade that adds a rule to the category doesn't change what your lint reports. `no-explicit-any` and the type-aware rules are warnings, because a codebase that adopts them usually has findings already. Promote them in your own config when the count reaches zero.

**`react`** turns on the react plugin: `rules-of-hooks`, `exhaustive-deps`, the React Compiler's rules and `only-export-components` with `allowConstantExport`. `exhaustive-deps` and five of the compiler rules (`purity`, `immutability`, `set-state-in-effect`, `incompatible-library`, `unsupported-syntax`) are warnings, like the type-aware rules in `base`.

**`tanstack-query`** loads `@tanstack/eslint-plugin-query` and turns on six of its rules: `exhaustive-deps` and `no-rest-destructuring` as warnings, and `stable-query-client`, `no-unstable-deps`, `infinite-query-property-order` and `mutation-property-order` as errors.

**`tanstack-router`** turns `only-export-components` off in `src/routes/**/*.tsx`. A file route exports `Route` beside its component; with `autoCodeSplitting`, the component moves to its own chunk and the router plugin handles hot reloading. The glob is relative to your config file. If your routes live somewhere other than the router's default, leave this preset out and write the override yourself.

**`storybook`** loads `eslint-plugin-storybook` and applies the rules its `flat/recommended` config sets to `**/*.stories.{ts,tsx}` and `**/.storybook/main.ts`. In stories it also turns off `rules-of-hooks` (render functions aren't components) and `only-export-components` (Storybook re-renders stories itself).

### Changing a rule

A later setting replaces an earlier one whole. Writing `"no-unused-vars": "warn"` over the preset's `["error", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }]` drops the options, so restate them:

```jsonc
"no-unused-vars": ["warn", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }]
```

The rules in `base` with options are `no-constant-condition`, `no-shadow-restricted-names` and `no-unused-vars`; in `react`, `only-export-components`.

## The guard

`@omnyist/declick/guard` runs your project's own `oxlint` and uses only Node's standard library, so it works under `bun test`, `node --test`, Vitest or Jest. It has two functions, and your test runner does the asserting.

### `resolvedConfig(options?)`

Returns the config Oxlint resolves for the project, normalized and sorted for a snapshot. Severities are `"off"`, `"warn"` or `"error"`, rule options follow the severity as in a config file, and overrides keep their order.

```ts
import { expect, test } from 'bun:test'
import { resolvedConfig } from '@omnyist/declick/guard'

test('the lint config resolves as it did', async () => {
  expect(await resolvedConfig()).toMatchSnapshot()
})
```

A snapshot catches a single rule that goes missing or changes severity. When you change the config on purpose, update the snapshot and review the diff.

The result has `plugins`, `jsPlugins`, `categories`, `options`, `env`, `globals`, `ignorePatterns`, `rules` and `overrides`. It comes from `oxlint --print-config`, which leaves out some things Oxlint does apply (see the traps below). The guard reads those from your JSON config and the files it extends. `settings` is left out, because Oxlint prints every plugin's defaults there and a snapshot would change with each upgrade.

### `plant(families, options?)`

Writes code that breaks known rules to a temporary folder, lints it with your config, deletes it, and returns the rule codes reported for each family. The families are `core`, `typescript`, `typeAware`, `react`, `compiler`, `tanstackQuery` and `storybook`. `probeRules` lists the rules each family's probe is written to break.

```ts
import { expect, test } from 'bun:test'
import { plant, probeRules } from '@omnyist/declick/guard'

const families = ['core', 'typescript', 'typeAware', 'react', 'compiler', 'tanstackQuery'] as const

test('every rule family still reports', async () => {
  const fired = await plant(families)
  for (const family of families) {
    expect(fired[family]).toEqual(expect.arrayContaining([...probeRules[family]]))
  }
})
```

This catches what a config snapshot can't: a JS plugin that fails to load, or tsgolint not running. The probe folder is outside your project, so globs anchored to it (such as the router's `src/routes/**`) don't apply there.

### Options

Both functions take the same options:

| Option   | Default                          |                                       |
| -------- | -------------------------------- | ------------------------------------- |
| `cwd`    | `process.cwd()`                  | The project directory.                |
| `config` | `.oxlintrc.json`                 | The config file, relative to `cwd`.   |
| `oxlint` | `node_modules/.bin/oxlint`       | The oxlint executable, relative to `cwd`. |

## Known traps

- **`@oxlint/migrate` can drop rules.** Older versions lost `no-var` and `prefer-const` without a word and wrote file globs Oxlint never matches. 1.87.0 keeps those two but skips nursery rules such as `no-undef` unless you pass `--with-nursery`. Check a migrated config with the guard before trusting it.
- **Extglob patterns never match.** An override for `**/*.stories.@(ts|tsx)` or `+(…)` silently applies to nothing. Use braces: `**/*.stories.{ts,tsx}`.
- **Suppressing a hooks rule turns off the React Compiler rules for the whole component or hook.** An `eslint-disable` for `exhaustive-deps` or `rules-of-hooks` makes the compiler skip that function, so its rules go quiet there too. `react/rule-suppression` reports these. Restructure the code instead, and lint with `--report-unused-disable-directives`.
- **`--print-config` doesn't show everything Oxlint applies.** As of Oxlint 1.87, it leaves out the `jsPlugins` and `categories` that come from an extended file, the options of rules set in an extended file, and the top-level rules of every JS plugin ([oxc-project/oxc#22117](https://github.com/oxc-project/oxc/issues/22117)). Linting uses all of them. `resolvedConfig` adds them back from your config files.
- **A config file that leaves out `plugins` adds Oxlint's default plugins** (unicorn, typescript, oxc), extended files included. Every preset names its plugins; name yours too, with `"plugins": []` if the presets' plugins are all you want.
- **An extended file only carries some keys.** Oxlint merges `rules`, `overrides`, `plugins`, `jsPlugins`, `categories` and `options` from an extended file, and ignores `env`, `globals`, `settings` and `ignorePatterns` there. Set those in your own config.
- **A subfolder with its own config isn't covered by the root's `ignorePatterns`.** If a folder of fixtures carries its own `.oxlintrc.json`, lint with `--disable-nested-config` to keep it out.
- **Type-aware rules need a `tsconfig.json` that includes the file.** tsgolint looks for the nearest one.

## Compatibility

The presets need `oxlint` 1.87 or later. The behaviour described here was measured with Oxlint 1.87.0 and oxlint-tsgolint 7.0.2003, and the test suite runs against the versions in `bun.lock`. The storybook preset was written against `eslint-plugin-storybook` 11.0.0-alpha.4, and the tanstack-query preset against `@tanstack/eslint-plugin-query` 5.104.1.

## Development

```sh
bun install          # also builds dist/
bun run typecheck
bun run lint
bun test
node test/node-smoke.mjs
```

Each folder in `test/fixtures` is a small project that extends some of the presets and breaks their rules. The tests lint each one and compare every reported rule, and snapshot its resolved config.

## License

MIT. See [LICENSE](LICENSE).
