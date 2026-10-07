// A lint config fails silently. A rule that is dropped, a glob that never matches, or a JS plugin
// that doesn't load just stops reporting, and nothing goes red. These two helpers give a test
// something to assert on: resolvedConfig() returns the config Oxlint will use, for a snapshot, and
// plant() lints code that breaks known rules and returns what was reported.
//
// Both run the project's own oxlint and use only Node's standard library, so they work under
// bun test, node --test, Vitest or Jest.

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'

export type Severity = 'off' | 'warn' | 'error'
export type RuleSetting = Severity | [Severity, ...unknown[]]

export interface ResolvedOverride {
  files: string[]
  rules: Record<string, RuleSetting>
  plugins?: string[]
  jsPlugins?: string[]
  env?: Record<string, unknown>
  globals?: Record<string, unknown>
}

export interface ResolvedConfig {
  plugins: string[]
  jsPlugins: string[]
  categories: Record<string, Severity>
  options: Record<string, unknown>
  env: Record<string, unknown>
  globals: Record<string, unknown>
  ignorePatterns: string[]
  rules: Record<string, RuleSetting>
  overrides: ResolvedOverride[]
}

export interface GuardOptions {
  /** The project directory, where its config and node_modules are. Defaults to process.cwd(). */
  cwd?: string
  /** The Oxlint config file, relative to cwd. Defaults to .oxlintrc.json. */
  config?: string
  /** The oxlint executable. Defaults to node_modules/.bin/oxlint under cwd. */
  oxlint?: string
}

interface Run {
  code: number | null
  stdout: string
  stderr: string
}

function setup(options: GuardOptions) {
  const cwd = resolve(options.cwd ?? process.cwd())
  const config = resolve(cwd, options.config ?? '.oxlintrc.json')
  if (!existsSync(config)) throw new Error(`No Oxlint config at ${config}.`)
  const oxlint = options.oxlint ? resolve(cwd, options.oxlint) : join(cwd, 'node_modules', '.bin', 'oxlint')
  if (!existsSync(oxlint)) throw new Error(`No oxlint at ${oxlint}. Install oxlint, or pass { oxlint }.`)
  return { cwd, config, oxlint }
}

function run(command: string, args: string[], cwd: string): Promise<Run> {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.on('error', fail)
    child.on('close', (code) =>
      done({
        code,
        stdout: Buffer.concat(stdout).toString(),
        stderr: Buffer.concat(stderr).toString(),
      }),
    )
  })
}

// --- Reading config files ---------------------------------------------------------------------

// Oxlint's JSON configs allow comments and trailing commas. Both are removed outside strings only:
// a glob such as "**/*.stories.{ts,tsx}" contains "/*", and a pattern-based stripper would cut it.
function scan(text: string, visit: (char: string, index: number) => number | string): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    const char = text[i] as string
    if (char === '"') {
      let end = i + 1
      while (end < text.length && text[end] !== '"') end += text[end] === '\\' ? 2 : 1
      out += text.slice(i, end + 1)
      i = end + 1
      continue
    }
    const result = visit(char, i)
    if (typeof result === 'number') {
      i = result
    } else {
      out += result
      i += 1
    }
  }
  return out
}

export function parseJsonc(text: string): unknown {
  const uncommented = scan(text, (char, i) => {
    if (char === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i)
      return end === -1 ? text.length : end
    }
    if (char === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      return end === -1 ? text.length : end + 2
    }
    return char
  })
  const trimmed = scan(uncommented, (char, i) => {
    if (char !== ',') return char
    const next = uncommented.slice(i + 1).trimStart()[0]
    return next === '}' || next === ']' ? i + 1 : char
  })
  return JSON.parse(trimmed)
}

type JsPluginEntry = string | { name: string; specifier: string }

interface Declared {
  jsPlugins: JsPluginEntry[]
  categories: Record<string, unknown>
  rules: Record<string, unknown>
}

interface ConfigFile {
  extends?: string[]
  jsPlugins?: JsPluginEntry[]
  categories?: Record<string, unknown>
  rules?: Record<string, unknown>
}

// `oxlint --print-config` leaves out four things that Oxlint does apply when it lints (measured
// with oxlint 1.87): the jsPlugins and categories that come from an extended file, the options of
// a rule set in an extended file, and every top-level rule that belongs to a JS plugin
// (oxc-project/oxc#22117). They are read from the config files instead, following `extends` the
// way Oxlint merges it: each extended file in order, then the file itself, the later one winning.
// A rule is replaced whole, so "warn" written over ["error", { ... }] drops the options, as it does
// in Oxlint.
function declared(file: string, seen: Set<string> = new Set()): Declared {
  if (seen.has(file)) throw new Error(`${file} extends itself.`)
  seen.add(file)
  const config = parseJsonc(readFileSync(file, 'utf8')) as ConfigFile
  const merged: Declared = { jsPlugins: [], categories: {}, rules: {} }
  const layers = (config.extends ?? []).map((entry) => declared(resolve(dirname(file), entry), seen))
  layers.push({
    jsPlugins: config.jsPlugins ?? [],
    categories: config.categories ?? {},
    rules: config.rules ?? {},
  })
  for (const layer of layers) {
    merged.jsPlugins.push(...layer.jsPlugins)
    Object.assign(merged.categories, layer.categories)
    Object.assign(merged.rules, layer.rules)
  }
  seen.delete(file)
  return merged
}

// The prefix a JS plugin's rules carry, by ESLint's naming convention: eslint-plugin-storybook
// is "storybook", @tanstack/eslint-plugin-query is "@tanstack/query", @scope/eslint-plugin is
// "@scope".
function prefix(entry: JsPluginEntry): string {
  if (typeof entry !== 'string') return entry.name
  const scoped = /^(@[^/]+)\/eslint-plugin(?:-(.+))?$/.exec(entry)
  if (scoped) return scoped[2] ? `${scoped[1]}/${scoped[2]}` : (scoped[1] as string)
  const plain = /^eslint-plugin-(.+)$/.exec(entry)
  return plain ? (plain[1] as string) : entry
}

// Config files may name a built-in rule by its ESLint plugin; --print-config uses Oxlint's name.
const aliases: [RegExp, string][] = [
  [/^eslint\//, ''],
  [/^@typescript-eslint\//, 'typescript/'],
  [/^react-hooks\//, 'react/'],
  [/^react-refresh\//, 'react/'],
]

function canonical(rule: string): string {
  for (const [pattern, replacement] of aliases) if (pattern.test(rule)) return rule.replace(pattern, replacement)
  return rule
}

function pluginLabel(entry: JsPluginEntry): string {
  return typeof entry === 'string' ? entry : `${entry.name}=${entry.specifier}`
}

// --- Normalizing ------------------------------------------------------------------------------

function severity(value: unknown): Severity {
  if (value === 'off' || value === 'allow' || value === 0) return 'off'
  if (value === 'warn' || value === 1) return 'warn'
  if (value === 'error' || value === 'deny' || value === 2) return 'error'
  throw new Error(`Unknown severity ${JSON.stringify(value)}.`)
}

// Config files write a rule as "error" or ["error", options...]. --print-config writes it as
// "deny" or ["deny", [options...]]. Both become "error" or ["error", options...].
function setting(value: unknown, printed: boolean): RuleSetting {
  if (!Array.isArray(value)) return severity(value)
  const [level, ...rest] = value as unknown[]
  const options = printed && rest.length === 1 && Array.isArray(rest[0]) ? (rest[0] as unknown[]) : rest
  return options.length === 0 ? severity(level) : [severity(level), ...options.map(sorted)]
}

function sorted<T>(value: T): T {
  if (Array.isArray(value)) return value.map(sorted) as T
  if (value === null || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) out[key] = sorted((value as Record<string, unknown>)[key])
  return out as T
}

function rulesOf(rules: Record<string, unknown> | null | undefined, printed: boolean) {
  const out: Record<string, RuleSetting> = {}
  for (const key of Object.keys(rules ?? {}).sort()) out[key] = setting(rules?.[key], printed)
  return out
}

interface Printed {
  plugins?: string[] | null
  jsPlugins?: JsPluginEntry[] | null
  categories?: Record<string, unknown> | null
  options?: Record<string, unknown> | null
  env?: Record<string, unknown> | null
  globals?: Record<string, unknown> | null
  ignorePatterns?: string[] | null
  rules?: Record<string, unknown> | null
  overrides?: {
    files: string[]
    rules?: Record<string, unknown> | null
    plugins?: string[] | null
    jsPlugins?: JsPluginEntry[] | null
    env?: Record<string, unknown> | null
    globals?: Record<string, unknown> | null
  }[]
}

/**
 * The config Oxlint resolves for a project, from `oxlint --print-config`, normalized and sorted
 * so it can be snapshotted: severities are "off", "warn" or "error", and rule options follow the
 * severity as they do in a config file. Overrides keep their order, since later ones win.
 *
 * Oxlint 1.87 doesn't print the jsPlugins and categories that come from an extended file, the
 * options of a rule set in an extended file, or the top-level rules of JS plugins
 * (oxc-project/oxc#22117), although it applies all four. They are read from the JSON config files
 * along the `extends` chain and added. `settings` is left out: Oxlint prints every plugin's
 * defaults there, which would churn a snapshot on each upgrade.
 */
export async function resolvedConfig(options: GuardOptions = {}): Promise<ResolvedConfig> {
  const { cwd, config, oxlint } = setup(options)
  const result = await run(oxlint, ['-c', config, '--print-config'], cwd)
  let printed: Printed
  try {
    printed = JSON.parse(result.stdout) as Printed
  } catch {
    throw new Error(`oxlint --print-config did not print JSON (exit ${result.code}): ${result.stderr || result.stdout}`)
  }

  const fromFiles = /\.jsonc?$/.test(config) ? declared(config) : undefined
  const jsPlugins = [...(printed.jsPlugins ?? []), ...(fromFiles?.jsPlugins ?? [])]
  const rules = rulesOf(printed.rules, true)
  if (fromFiles) {
    const prefixes = [...new Set(jsPlugins.map(prefix))]
    for (const [key, value] of Object.entries(fromFiles.rules)) {
      if (prefixes.some((name) => key.startsWith(`${name}/`))) {
        rules[key] = setting(value, false)
        continue
      }
      // Oxlint printed the rule without the options it applies; add them back when the
      // severities agree, which shows the file's setting is the one in force.
      const name = canonical(key)
      const written = setting(value, false)
      if (typeof rules[name] === 'string' && Array.isArray(written) && written[0] === rules[name]) {
        rules[name] = written
      }
    }
  }

  const categories: Record<string, Severity> = {}
  const declaredCategories = fromFiles?.categories ?? printed.categories ?? {}
  for (const key of Object.keys(declaredCategories).sort()) categories[key] = severity(declaredCategories[key])

  return {
    plugins: [...new Set(printed.plugins ?? [])].sort(),
    jsPlugins: [...new Set(jsPlugins.map(pluginLabel))].sort(),
    categories,
    options: sorted(printed.options ?? {}),
    env: sorted(printed.env ?? {}),
    globals: sorted(printed.globals ?? {}),
    ignorePatterns: printed.ignorePatterns ?? [],
    rules: rulesOf(rules, false),
    overrides: (printed.overrides ?? []).map((override) => {
      const out: ResolvedOverride = { files: override.files, rules: rulesOf(override.rules, true) }
      if (override.plugins) out.plugins = [...override.plugins].sort()
      if (override.jsPlugins) out.jsPlugins = override.jsPlugins.map(pluginLabel).sort()
      if (override.env) out.env = sorted(override.env)
      if (override.globals) out.globals = sorted(override.globals)
      return out
    }),
  }
}

// --- Probes -----------------------------------------------------------------------------------

export type Family = 'core' | 'typescript' | 'typeAware' | 'react' | 'compiler' | 'tanstackQuery' | 'storybook'

export const families: readonly Family[] = [
  'core',
  'typescript',
  'typeAware',
  'react',
  'compiler',
  'tanstackQuery',
  'storybook',
]

interface Probe {
  files: Record<string, string>
  rules: readonly string[]
}

const probes: Record<Family, Probe> = {
  core: {
    files: {
      'core.ts': `export function legacy(input: number) {
  var old = input
  let never = 1
  debugger
  try {
    old = 2
  } catch {}
  return old + never
}
`,
    },
    rules: ['eslint(no-debugger)', 'eslint(no-empty)', 'eslint(no-var)', 'eslint(prefer-const)'],
  },
  typescript: {
    files: {
      'typescript.ts': `// @ts-ignore
export const anything: any = 1
export type Empty = {}
`,
    },
    rules: ['typescript(ban-ts-comment)', 'typescript(no-empty-object-type)', 'typescript(no-explicit-any)'],
  },
  typeAware: {
    files: {
      'type-aware.ts': `async function load() {
  return 1
}

export function start(name: string) {
  load()
  return name as string
}
`,
    },
    rules: ['typescript(no-floating-promises)', 'typescript(no-unnecessary-type-assertion)'],
  },
  react: {
    files: {
      'Hooks.tsx': `import { useEffect, useState } from 'react'

export function Hooks({ items }: { items: string[] }) {
  if (items.length > 0) {
    useState(1)
  }

  useEffect(() => {
    console.log(items)
  }, [])
  return null
}

export const helper = () => 1
`,
    },
    rules: ['react-hooks(exhaustive-deps)', 'react-hooks(rules-of-hooks)', 'react(only-export-components)'],
  },
  compiler: {
    files: {
      'Compiled.tsx': `import { useEffect, useState } from 'react'

export function Compiled({ items }: { items: string[] }) {
  const [count, setCount] = useState(0)
  useEffect(() => {
    setCount(items.length)
  }, [items])
  return <div>{count + Math.random()}</div>
}

export function Suppressed({ items }: { items: string[] }) {
  useEffect(() => {
    console.log(items)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}
`,
    },
    rules: ['react(purity)', 'react(rule-suppression)', 'react(set-state-in-effect)'],
  },
  tanstackQuery: {
    files: {
      'Query.tsx': `import { QueryClient, useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'

export function Query({ id }: { id: string }) {
  const client = new QueryClient()
  const { data, ...rest } = useQuery({ queryKey: ['a'], queryFn: () => fetch('/a/' + id) })
  const unstable = useQuery({ queryKey: ['b'], queryFn: async () => 1 })
  useEffect(() => {}, [unstable])
  useMutation({ onError: () => {}, onMutate: () => {}, mutationFn: async () => 1 })
  useInfiniteQuery({
    queryKey: ['c'],
    getNextPageParam: () => 1,
    queryFn: async () => 1,
    initialPageParam: 0,
  })
  return <div>{[data, rest, client].length}</div>
}
`,
    },
    rules: [
      '@tanstack/query(exhaustive-deps)',
      '@tanstack/query(infinite-query-property-order)',
      '@tanstack/query(mutation-property-order)',
      '@tanstack/query(no-rest-destructuring)',
      '@tanstack/query(no-unstable-deps)',
      '@tanstack/query(stable-query-client)',
    ],
  },
  storybook: {
    files: {
      'Probe.stories.tsx': `import { render } from '@storybook/react'
import { expect } from 'vitest'
import { userEvent } from '@testing-library/user-event'
import { within } from 'storybook/test'

const meta = { title: 'Group/Probe', component: render }

export const BadStory = {
  name: 'Bad Story',
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button'))
    expect(meta).toBeDefined()
  },
}

export const bad_case = {}
`,
      '.storybook/main.ts': `export default { stories: [], addons: ['@storybook/addon-not-installed'] }
`,
    },
    rules: [
      'storybook(default-exports)',
      'storybook(no-redundant-story-name)',
      'storybook(no-renderer-packages)',
      'storybook(no-uninstalled-addons)',
      'storybook(prefer-pascal-case)',
      'storybook(use-storybook-expect)',
      'storybook(use-storybook-testing-library)',
    ],
  },
}

/** The rules each family's probe is written to break, as Oxlint reports their codes. */
export const probeRules: Record<Family, readonly string[]> = Object.fromEntries(
  families.map((family) => [family, probes[family].rules]),
) as Record<Family, readonly string[]>

// The type-aware rules find a tsconfig.json beside the files they check.
const tsconfig = `${JSON.stringify(
  {
    compilerOptions: { strict: true, noEmit: true, jsx: 'react-jsx', target: 'ES2022' },
    include: ['*.ts', '*.tsx'],
  },
  null,
  2,
)}\n`

/**
 * Writes code that breaks rules from each family to a temporary folder outside the project, lints
 * it with the project's config, removes it, and returns the rule codes reported in each family's
 * files, sorted. The folder is outside the project so that neither an editor nor a lint running at
 * the same moment sees the broken files; globs anchored to the project, such as src/routes/**,
 * therefore don't apply to it.
 */
export async function plant<F extends Family>(
  chosen: readonly F[],
  options: GuardOptions = {},
): Promise<Record<F, string[]>> {
  const { cwd, config, oxlint } = setup(options)
  // Oxlint reports real paths, and on macOS the temporary folder sits behind a symlink.
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'declick-')))
  const owner = new Map<string, F>()
  try {
    writeFileSync(join(folder, 'tsconfig.json'), tsconfig)
    for (const family of chosen) {
      for (const [name, source] of Object.entries(probes[family].files)) {
        const path = join(folder, name)
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, source)
        owner.set(name, family)
      }
    }

    const result = await run(oxlint, ['-c', config, '-f', 'json', folder], cwd)
    let diagnostics: { code: string; filename: string }[]
    try {
      diagnostics = (JSON.parse(result.stdout) as { diagnostics: { code: string; filename: string }[] }).diagnostics
    } catch {
      throw new Error(`oxlint did not print JSON (exit ${result.code}): ${result.stderr || result.stdout}`)
    }

    const fired = Object.fromEntries(chosen.map((family) => [family, new Set<string>()])) as Record<F, Set<string>>
    for (const { code, filename } of diagnostics) {
      const name = relative(folder, resolve(cwd, filename)).split(sep).join('/')
      const family = owner.get(name)
      if (family) fired[family].add(code)
    }
    return Object.fromEntries(chosen.map((family) => [family, [...fired[family]].sort()])) as Record<F, string[]>
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
}
