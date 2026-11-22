import { useEffect, useRef, useState } from 'react'
import type { Layout } from '../layout'
import type { RunResult, RunState, SolverId } from './catalog'
import type { RoutingRequest } from './problem'

/** Mounted once per graph. Separate workers allow one result to play while others finish. */
export function useSolvers(base: Layout) {
  const workers = useRef(new Map<SolverId, Worker>())
  const cache = useRef<RunState>({})
  const request = useRef<RoutingRequest | null>(null)
  const [results, setResults] = useState<RunState>({})
  useEffect(() => {
    const active = workers.current
    return () => { active.forEach(w => w.terminate()); active.clear() }
  }, [])
  function publish(id: SolverId, value: RunState[SolverId]) {
    cache.current = { ...cache.current, [id]: value }
    setResults(cache.current)
  }
  function run(id: SolverId) {
    const cached = cache.current[id]
    if (cached && (cached === 'running' || cached.status !== 'error')) return
    let worker: Worker | undefined
    const finish = (result: RunResult) => {
      if (workers.current.get(id) !== worker) return
      workers.current.delete(id)
      worker?.terminate()
      publish(id, result)
    }
    try {
      worker = new Worker(new URL('./solver.worker.ts', import.meta.url), { type: 'module' })
      workers.current.set(id, worker)
      publish(id, 'running')
      worker.onmessage = (e: MessageEvent<RunResult>) => finish(e.data)
      worker.onerror = () => finish({ status: 'error' })
      request.current ??= {
        graph: { nodes: base.nodes.map(({ id, weight }) => ({ id, weight })),
          edges: base.edges.map(({ source, target, weight }) => ({ source, target, weight })),
          start: base.vrp?.depot ?? base.nodes.find(n => n.isStart)?.id },
        capacities: base.vrp?.vehicles.map(v => v.capacity),
        initialRoutes: base.vrp?.vehicles.map(v => v.route) ?? (base.tour && [base.tour]),
      }
      worker.postMessage({ solver: id, request: request.current })
    } catch { finish({ status: 'error' }) }
  }
  function cancel(id: SolverId) {
    workers.current.get(id)?.terminate()
    workers.current.delete(id)
    publish(id, undefined)
  }
  return { results, run, cancel }
}
