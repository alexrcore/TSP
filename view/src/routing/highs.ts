import loadHighs from 'highs'
import { evaluate, integers } from './problem.ts'
import type { Roads } from './problem'
import type { RunResult } from './catalog'

let runtime: ReturnType<typeof loadHighs> | undefined

/** Directed arc assignment with Miller–Tucker–Zemlin ordering to eliminate customer-only subtours. */
export async function solveHighs(roads: Roads, capacities: number[] | undefined, ms: number): Promise<RunResult> {
  const { graph, depot, neighbors } = roads
  const n = graph.nodes.length, fleet = capacities?.length ?? 1
  if (n < (capacities ? 2 : 3) || fleet < 1 || fleet >= n || neighbors.some(row => !row.size)) return { status: 'infeasible' }
  const costs = integers(graph.edges.map(e => e.weight), 2 * fleet)
  const loads = integers([...graph.nodes.map((v, i) => capacities && i !== depot ? v.weight : 0),
    ...(capacities ?? []).map(c => c === Infinity ? 0 : c)])
  if (!costs || !loads) return { status: 'unsupported' }
  const model = await (runtime ??= loadHighs())
  const deadline = performance.now() + ms
  const rows: string[] = [], objective: string[] = [], bounds: string[] = []
  const arcs: { from: number; to: number; vehicle: number; name: string }[] = []
  const visits = graph.nodes.map(() => [] as string[])
  for (let vehicle = 0; vehicle < fleet; vehicle++) {
    const ins = graph.nodes.map(() => [] as string[]), outs = graph.nodes.map(() => [] as string[])
    const cargo: string[] = []
    for (const [from, neighborsOfNode] of neighbors.entries()) {
      if (from % 64 === 0 && performance.now() >= deadline) return { status: 'unknown' }
      for (const [to, edge] of neighborsOfNode) {
        const name = 'x' + arcs.length
        arcs.push({ from, to, vehicle, name })
        outs[from].push(name)
        ins[to].push(name)
        objective.push(costs[edge] + ' ' + name)
        visits[from].push(name)
        if (loads[from]) cargo.push(loads[from] + ' ' + name)
        if (from !== depot && to !== depot) rows.push(`u${from} - u${to} + ${n} ${name} <= ${n - 1}`)
      }
    }
    rows.push(outs[depot].join(' + ') + ' = 1')
    for (let i = 0; i < n; i++) rows.push(outs[i].join(' + ') + ' - ' + ins[i].join(' - ') + ' = 0')
    if (cargo.length && capacities?.[vehicle] !== Infinity) rows.push(cargo.join(' + ') + ' <= ' + loads[n + vehicle])
  }
  for (let i = 0; i < n; i++) {
    if (i === depot) continue
    rows.push(visits[i].join(' + ') + ' = 1')
    bounds.push(`1 <= u${i} <= ${n - 1}`)
  }
  const lp = ['Minimize', ' obj: ' + objective.join(' + '), 'Subject To',
    ...rows.map((row, i) => ` r${i}: ${row}`), 'Bounds', ...bounds, 'Binary', ...arcs.map(a => a.name), 'End'].join('\n')
  const remaining = deadline - performance.now()
  if (remaining <= 0) return { status: 'unknown' }
  const result = model.solve(lp, { time_limit: remaining / 1000, mip_abs_gap: 0, mip_rel_gap: 0, log_to_console: false })
  if (result.Status === 'Infeasible') return { status: 'infeasible' }
  if (!['Optimal', 'Time limit reached'].includes(result.Status)) return { status: 'error' }
  const successors = Array.from({ length: fleet }, () => new Map<number, number>())
  for (const a of arcs) {
    const col = result.Columns[a.name]
    if (col && 'Primal' in col && col.Primal > 0.5) successors[a.vehicle].set(a.from, a.to)
  }
  const paths = successors.map(next => {
    const path = [depot]
    for (let i = 0; i < n; i++) {
      const to = next.get(path.at(-1)!)
      if (to === undefined) break
      path.push(to)
      if (to === depot) break
    }
    return path
  })
  const candidate = evaluate(roads, paths, capacities)
  if (!candidate) return { status: result.Status === 'Optimal' ? 'error' : 'unknown' }
  return { ...candidate, status: result.Status === 'Optimal' ? 'optimal' : 'feasible' }
}
