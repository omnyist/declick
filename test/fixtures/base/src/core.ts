export function legacy(input: number, key: string, record: object) {
  var old = input
  let never = 1
  debugger
  try {
    old = 2
  } catch {}
  // Oxlint's default correctness category would report this negation; the base turns it off.
  if (!key in record) return 0
  return old + never
}
