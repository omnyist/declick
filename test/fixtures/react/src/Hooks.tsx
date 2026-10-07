import { useEffect, useState } from 'react'

export function Hooks({ items }: { items: string[] }) {
  if (items.length > 0) {
    useState(1)
  }

  useEffect(() => {
    console.log(items)
  }, [])
  return null
}

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

export const helper = () => 1
