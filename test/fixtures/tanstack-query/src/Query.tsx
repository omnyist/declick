import { QueryClient, useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query'
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
