import { afterAll, describe, expect, test } from 'bun:test'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { families, parseJsonc, plant, probeRules, resolvedConfig } from '../src/guard.ts'

const root = join(import.meta.dir, '..')
const oxlint = join(root, 'node_modules', '.bin', 'oxlint')
const all = join(import.meta.dir, 'fixtures', 'all')
const base = join(import.meta.dir, 'fixtures', 'base')

const scratch = mkdtempSync(join(tmpdir(), 'declick-test-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

// A project in its own folder, with the presets where an install puts them and the JS plugins
// they load beside them.
function project(name: string, presets: string[]) {
  const dir = join(scratch, name)
  const modules = join(dir, 'node_modules')
  mkdirSync(join(modules, '@omnyist'), { recursive: true })
  mkdirSync(join(modules, '@tanstack'), { recursive: true })
  for (const plugin of ['@tanstack/eslint-plugin-query', 'eslint-plugin-storybook']) {
    symlinkSync(join(root, 'node_modules', plugin), join(modules, plugin))
  }
  writeFileSync(join(dir, 'package.json'), '{ "name": "probe", "private": true }\n')
  const config = {
    plugins: [],
    extends: presets.map((preset) => `./node_modules/@omnyist/declick/oxlint/${preset}.json`),
  }
  writeFileSync(join(dir, '.oxlintrc.json'), `${JSON.stringify(config, null, 2)}\n`)
  return dir
}

const everyPreset = ['base', 'react', 'tanstack-query', 'tanstack-router', 'storybook']

describe('parseJsonc', () => {
  test('removes comments and trailing commas outside strings only', () => {
    const text = `{
      // a comment
      "files": ["**/*.stories.{ts,tsx}", "a//b"], /* another */
      "rules": { "x": "error", },
    }`
    expect(parseJsonc(text)).toEqual({ files: ['**/*.stories.{ts,tsx}', 'a//b'], rules: { x: 'error' } })
  })

  test('keeps escaped quotes inside strings', () => {
    expect(parseJsonc('{ "a": "say \\"hi\\" // not a comment" }')).toEqual({ a: 'say "hi" // not a comment' })
  })
})

describe('resolvedConfig', () => {
  test('includes what --print-config leaves out', async () => {
    const config = await resolvedConfig({ cwd: all, oxlint })
    expect(config.jsPlugins).toEqual(['@tanstack/eslint-plugin-query', 'eslint-plugin-storybook'])
    expect(config.categories).toEqual({ correctness: 'off' })
    expect(config.rules['@tanstack/query/no-unstable-deps']).toBe('error')
    expect(config.rules['no-constant-condition']).toEqual(['error', { checkLoops: 'allExceptWhileTrue' }])
    expect(config.options).toEqual({ typeAware: true })
    expect(config.overrides.map((override) => override.files)).toEqual([
      ['src/routes/**/*.tsx'],
      ['**/*.stories.{ts,tsx}'],
      ['**/.storybook/main.ts'],
    ])
  })

  test('is the same when the presets are installed under node_modules', async () => {
    const dir = project('installed', everyPreset)
    symlinkSync(root, join(dir, 'node_modules', '@omnyist', 'declick'))
    expect(await resolvedConfig({ cwd: dir, oxlint })).toEqual(await resolvedConfig({ cwd: all, oxlint }))
  })

  // The per-family probes would still pass with either rule gone; the resolved config doesn't.
  test.each([
    ['tanstack-query', '@tanstack/query/no-unstable-deps'],
    ['base', 'no-var'],
  ])('notices %s losing %s', async (preset, rule) => {
    const dir = project(`dropped-${preset}`, everyPreset)
    const copy = join(dir, 'node_modules', '@omnyist', 'declick')
    cpSync(join(root, 'oxlint'), join(copy, 'oxlint'), { recursive: true })
    const file = join(copy, 'oxlint', `${preset}.json`)
    const config = parseJsonc(readFileSync(file, 'utf8')) as { rules: Record<string, unknown> }
    delete config.rules[rule]
    writeFileSync(file, JSON.stringify(config))

    const before = await resolvedConfig({ cwd: all, oxlint })
    const after = await resolvedConfig({ cwd: dir, oxlint })
    expect(after).not.toEqual(before)
    const { [rule]: _dropped, ...rest } = before.rules
    expect(after).toEqual({ ...before, rules: rest })
  })
})

describe('plant', () => {
  test('every family reports the rules its probe breaks', async () => {
    const fired = await plant(families, { cwd: all, oxlint })
    for (const family of families) {
      expect({ family, fired: fired[family] }).toEqual({
        family,
        fired: expect.arrayContaining([...probeRules[family]]),
      })
    }
  })

  test('reports nothing for a family the config does not turn on', async () => {
    const fired = await plant(['core', 'react', 'tanstackQuery', 'storybook'], { cwd: base, oxlint })
    expect(fired.core).toEqual(expect.arrayContaining([...probeRules.core]))
    expect(fired.react).toEqual([])
    expect(fired.tanstackQuery).toEqual([])
    expect(fired.storybook).toEqual([])
  })

  test('leaves no files behind', async () => {
    const before = new Set(readdirSync(tmpdir()))
    await plant(['core'], { cwd: all, oxlint })
    const left = readdirSync(tmpdir()).filter((name) => name.startsWith('declick-') && !before.has(name))
    expect(left).toEqual([])
  })
})
