// Each fixture is a small project whose .oxlintrc.json extends one or more presets and whose
// source breaks the rules those presets turn on. The tests lint it with the real oxlint and
// compare every reported rule, so a rule that stops reporting, or one that starts, fails here.

import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseJsonc, resolvedConfig } from '../src/guard.ts'

const root = join(import.meta.dir, '..')
const oxlint = join(root, 'node_modules', '.bin', 'oxlint')
const fixture = (name: string) => join(import.meta.dir, 'fixtures', name)

function lint(name: string): Record<string, string[]> {
  const result = spawnSync(oxlint, ['-f', 'json', '.'], { cwd: fixture(name), encoding: 'utf8' })
  const { diagnostics } = JSON.parse(result.stdout) as {
    diagnostics: { code: string | null; filename: string; severity: string }[]
  }
  const reported: Record<string, string[]> = {}
  for (const { code, filename, severity } of diagnostics) {
    ;(reported[filename] ??= []).push(`${code} ${severity}`)
  }
  for (const codes of Object.values(reported)) codes.sort()
  return reported
}

const expected: Record<string, Record<string, string[]>> = {
  base: {
    // The negation in core.ts is left alone: Oxlint's correctness category is off.
    'src/core.ts': [
      'eslint(no-debugger) error',
      'eslint(no-empty) error',
      'eslint(no-var) error',
      'eslint(prefer-const) error',
    ],
    'src/typescript.ts': [
      'typescript(ban-ts-comment) error',
      'typescript(no-empty-object-type) error',
      'typescript(no-explicit-any) warning',
      'typescript(no-floating-promises) warning',
      'typescript(no-unnecessary-type-assertion) warning',
    ],
  },
  react: {
    'src/Hooks.tsx': [
      'react(only-export-components) warning',
      'react(purity) warning',
      'react(rule-suppression) error',
      'react(set-state-in-effect) warning',
      'react-hooks(exhaustive-deps) warning',
      'react-hooks(rules-of-hooks) error',
    ],
  },
  'tanstack-query': {
    'src/Query.tsx': [
      '@tanstack/query(exhaustive-deps) warning',
      '@tanstack/query(infinite-query-property-order) error',
      '@tanstack/query(mutation-property-order) error',
      '@tanstack/query(no-rest-destructuring) warning',
      '@tanstack/query(no-unstable-deps) error',
      '@tanstack/query(stable-query-client) error',
    ],
  },
  // The same file outside src/routes is reported; inside it, it isn't.
  'tanstack-router': {
    'src/Widget.tsx': ['react(only-export-components) warning'],
  },
  // The story's render function calls a hook, which rules-of-hooks would report anywhere else.
  storybook: {
    '.storybook/main.ts': ['storybook(no-uninstalled-addons) error'],
    'src/Button.stories.tsx': [
      'storybook(default-exports) error',
      'storybook(no-redundant-story-name) warning',
      'storybook(no-renderer-packages) error',
      'storybook(prefer-pascal-case) warning',
      'storybook(use-storybook-expect) error',
      'storybook(use-storybook-testing-library) error',
    ],
  },
  all: {},
}

describe.each(Object.keys(expected))('%s', (name) => {
  test('reports exactly the rules its source breaks', () => {
    expect(lint(name)).toEqual(expected[name] as Record<string, string[]>)
  })

  test('resolves to the same config', async () => {
    expect(await resolvedConfig({ cwd: fixture(name), oxlint })).toMatchSnapshot()
  })
})

// Oxlint takes rules, overrides, plugins, jsPlugins, categories and options from an extended
// file. It ignores env, globals, settings and ignorePatterns there, so a preset that set them
// would look as if it did something and not. And a file that leaves out plugins, extended or not,
// adds Oxlint's default plugins (unicorn, typescript, oxc) to the project.
describe.each(readdirSync(join(root, 'oxlint')))('oxlint/%s', (file) => {
  const preset = parseJsonc(readFileSync(join(root, 'oxlint', file), 'utf8')) as Record<string, unknown>

  test('sets only keys Oxlint takes from an extended file', () => {
    const allowed = new Set(['plugins', 'jsPlugins', 'categories', 'options', 'rules', 'overrides'])
    expect(Object.keys(preset).filter((key) => !allowed.has(key))).toEqual([])
  })

  test('names its plugins', () => {
    expect(Array.isArray(preset.plugins)).toBe(true)
  })
})

test('extending every preset turns on only their plugins', async () => {
  const config = await resolvedConfig({ cwd: fixture('all'), oxlint })
  expect(config.plugins).toEqual(['react', 'typescript'])
})
