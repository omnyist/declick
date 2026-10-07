// @ts-ignore
export const anything: any = 1
export type Empty = {}

async function load() {
  return 1
}

export function start(name: string) {
  load()
  return name as string
}
