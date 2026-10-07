import { useState } from 'react'

export const LIMIT = 3

export function Clean() {
  const [count] = useState(0)
  return <div>{Math.min(count, LIMIT)}</div>
}
