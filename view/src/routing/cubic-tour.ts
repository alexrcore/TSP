import { evaluate } from './problem.ts'
import type { Roads } from './problem'
import type { Solution } from './solver'

/** In a subcubic graph a tour omits exactly one road at each degree-three
 * vertex. Those omitted roads form a matching. Its complement must be connected. */
export function matchingTour(roads: Roads, deadline: number, initial?: number[][]): Solution | undefined {
  const { depot, graph, neighbors } = roads
  if (neighbors.some(row => row.size > 3)) return
  const vertices: number[] = []
  let roadTotal = 0
  const candidates = neighbors.map((row, i) => {
    if (row.size === 3) vertices.push(i)
    const eligible: { to: number; weight: number }[] = []
    for (const [to, index] of row) {
      const { weight } = graph.edges[index]
      if (to > i) roadTotal += weight
      if (neighbors[to].size === 3) eligible.push({ to, weight })
    }
    return eligible.sort((a, b) => b.weight - a.weight)
  })
  // Comparing integer savings allows an exact upper bound without roundoff.
  if (roadTotal > Number.MAX_SAFE_INTEGER / 2 || !graph.edges.every(e => Number.isSafeInteger(e.weight))) return
  const mate = new Int32Array(neighbors.length).fill(-1)
  let best = initial && evaluate(roads, initial)
  let bestSaving = best ? roadTotal - best.cost : -Infinity
  type Choice = (typeof candidates)[number][number]
  type Frame = { vertex: number; choices: Choice[]; next: number; paired: number; saving: number }
  const stack: Frame[] = []

  function visit(saving: number) {
    let vertex = -1, fewest = Infinity, optimistic = 0
    for (const i of vertices) {
      if (mate[i] !== -1) continue
      let count = 0
      for (const { to, weight } of candidates[i]) {
        if (mate[to] !== -1) continue
        if (count++ === 0) optimistic += weight
      }
      if (count === 0) return
      if (count < fewest) { vertex = i; fewest = count }
    }
    // Every remaining matched edge is counted at both endpoints.
    if (saving + Math.floor(optimistic / 2) <= bestSaving) return
    if (vertex !== -1) {
      stack.push({ vertex, choices: candidates[vertex], next: 0, paired: -1, saving })
      return
    }
    const path = [depot]
    let previous = -1, at = depot
    do {
      let next = -1
      for (const to of neighbors[at].keys()) if (to !== previous && to !== mate[at]) { next = to; break }
      path.push(next)
      previous = at
      at = next
    } while (at !== depot)
    if (path.length !== neighbors.length + 1) return
    const tour = evaluate(roads, [path])
    if (tour) { best = tour; bestSaving = saving }
  }
  visit(0)
  while (stack.length) {
    if (performance.now() >= deadline) return best ? { ...best, status: 'feasible' } : { status: 'unknown' }
    const frame = stack[stack.length - 1]
    if (frame.paired !== -1) {
      mate[frame.vertex] = mate[frame.paired] = -1
      frame.paired = -1
    }
    if (frame.next === frame.choices.length) { stack.pop(); continue }
    const { to, weight } = frame.choices[frame.next++]
    if (mate[to] !== -1) continue
    frame.paired = to
    mate[to] = frame.vertex
    mate[frame.vertex] = to
    visit(frame.saving + weight)
  }
  return best ? { ...best, status: 'optimal' } : { status: 'infeasible' }
}
