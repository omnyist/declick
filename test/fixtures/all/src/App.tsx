import { useQuery } from '@tanstack/react-query'

export function App({ id }: { id: string }) {
  const { data } = useQuery({ queryKey: ['item', id], queryFn: () => fetch(`/items/${id}`) })
  return <pre>{JSON.stringify(data)}</pre>
}
