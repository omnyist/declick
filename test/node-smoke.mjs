// Runs the built guard under plain Node, through the package's own exports, against the fixture
// that extends every preset. `bun test` covers the source; this covers what a Node project imports.

import assert from 'node:assert/strict'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { families, plant, probeRules, resolvedConfig } from '@omnyist/declick/guard'

const root = fileURLToPath(new URL('..', import.meta.url))
const cwd = join(root, 'test', 'fixtures', 'all')
const oxlint = join(root, 'node_modules', '.bin', 'oxlint')

const config = await resolvedConfig({ cwd, oxlint })
assert.deepEqual(config.jsPlugins, ['@tanstack/eslint-plugin-query', 'eslint-plugin-storybook'])
assert.deepEqual(config.categories, { correctness: 'off' })

const fired = await plant(families, { cwd, oxlint })
for (const family of families) {
  const missing = probeRules[family].filter((rule) => !fired[family].includes(rule))
  assert.deepEqual(missing, [], `${family} did not report ${missing.join(', ')}`)
}

console.log(`guard ok under Node ${process.versions.node}`)
