import assert from 'node:assert/strict'
import test from 'node:test'
import { solveTsp, solveVrp } from '../src/routing/solver.ts'
import { solveGraph } from '../src/routing/or-tools.ts'
import { runSolver } from '../src/routing/compare.ts'

function instance(weights, roads) {
  return {
    start: '0',
    nodes: weights.map((weight, i) => ({ id: String(i), weight })),
    edges: roads.map(([a, b, weight]) => ({ source: String(a), target: String(b), weight })),
  }
}

test('an expensive starting tour can be improved using the cheapest parallel road', () => {
  const graph = instance([0, 1, 1, 1], [[0,1,8],[1,2,1],[2,3,8],[3,0,1],[0,2,1],[1,3,1],[0,2,0.25]])
  const result = solveTsp(graph, { initialRoutes: [['0','1','2','3','0']] })
  assert.equal(result.status, 'optimal')
  assert.equal(result.cost, 3.25)
  assert.ok(result.routes[0].edges.includes(6))
})

test('two vehicles can serve a star even when it has no TSP tour', () => {
  const graph = instance([0, 1, 5], [[0,1,0],[2,0,3]])
  assert.equal(solveTsp(graph).status, 'infeasible')
  const result = solveVrp(graph, 2, { capacities: [5, 1] })
  assert.deepEqual(result.routes.map(route => route.stops), [['0','2','0'],['0','1','0']])
  assert.equal(result.cost, 6)
  assert.equal(solveVrp(graph, 2, { capacities: [3, 3] }).status, 'infeasible')
})

test('OR-Tools respects decimal costs, capacities and fleet order on a return trip', async () => {
  const graph = instance([0, 1.5, 4.75], [[0, 1, 0.25], [2, 0, 3], [0, 2, 1.25]])
  const request = { graph, capacities: [5, 2] }
  const result = await solveGraph(request)
  assert.equal(result.status, 'optimal')
  assert.deepEqual(result.routes.map(route => route.edges), [[2, 2], [0, 0]])
  assert.equal(result.cost, 3)
  const initialRoutes = result.routes.map(route => route.stops)
  assert.equal((await solveGraph({ ...request, initialRoutes }, 0)).cost, 3)
  assert.equal((await solveGraph({ ...request, capacities: [4, 4] })).status, 'infeasible')
})

test('timed search distinguishes a feasible initial plan, a bad seed and a proof', () => {
  const graph = instance([0, 1, 1, 1], [[0,1,5],[1,2,4],[2,3,3],[3,0,2],[0,2,1]])
  const good = [['0','3','2','1','0']]
  assert.equal(solveTsp(graph, { timeLimitMs: 0, initialRoutes: good }).status, 'feasible')
  assert.equal(solveTsp(graph, { timeLimitMs: 0, initialRoutes: [['0','2','0']] }).status, 'unknown')
  assert.equal(solveTsp(graph, { initialRoutes: good }).cost, 14)
})

test('comparison distinguishes a heuristic, a retained starting plan and a proven large tour', async () => {
  const graph = instance([0, 1, 1, 1], [[0,1,8],[1,2,1],[2,3,8],[3,0,1],[0,2,1],[1,3,1]])
  const guided = await runSolver('guided', { graph, initialRoutes: [['0','1','2','3','0']] }, 80)
  assert.equal(guided.status, 'feasible')
  assert.equal(guided.cost, 4)
  const star = instance([0, 2, 4], [[0,1,3],[2,0,7]])
  const fleet = await runSolver('savings', { graph: star, capacities: [4, 2], initialRoutes: [['0','2','0'],['0','1','0']] })
  assert.equal(fleet.startingPlan, true)
  assert.deepEqual(fleet.routes.map(route => route.cost), [14,6])
  const cycle = instance(Array(512).fill(1), Array.from({length:512}, (_,i) => [i,(i+1)%512,1]))
  const large = await runSolver('held-karp', {graph:cycle})
  assert.equal(large.status, 'optimal')
  assert.equal(large.cost, 512)
})

test('a shared feasibility check distinguishes a depot junction from a customer junction', async () => {
  const graph = instance([0,1,1,1,1], [[0,1,1],[1,2,1],[2,0,1],[0,3,1],[3,4,1],[4,0,1]])
  assert.equal((await runSolver('guided', { graph }, 0)).status, 'infeasible')
  assert.equal((await runSolver('savings', { graph, capacities: [4] }, 0)).status, 'infeasible')
  assert.equal((await runSolver('custom', { graph, capacities: [2,2] })).cost, 6)
  graph.start = '1'
  assert.equal((await runSolver('savings', { graph, capacities: [4,4] }, 0)).status, 'infeasible')
  const disconnected = instance(Array(6).fill(1), [[0,1,1],[1,2,1],[2,0,1],[3,4,1],[4,5,1],[5,3,1]])
  assert.equal((await runSolver('guided', { graph: disconnected }, 0)).status, 'infeasible')
})

test('regional tours use the right trucks and original parallel roads under a shared budget', () => {
  const graph = instance([0, 7, 1, 2, 2], [[0,1,9],[0,1,2],[0,2,9],[2,3,7],[3,4,5],[4,0,9],[0,3,2],[2,4,1]])
  const initialRoutes = [['0','1','0'], ['0','2','3','4','0']]
  const options = { capacities: [7, 7], initialRoutes }
  const timed = solveVrp(graph, 2, { ...options, timeLimitMs: 0 })
  assert.equal(timed.status, 'feasible')
  assert.equal(timed.cost, 34)
  const result = solveVrp(graph, 2, { capacities: [5, 7] })
  assert.equal(result.status, 'optimal')
  assert.equal(result.cost, 21)
  assert.deepEqual(result.routes[1].edges, [1, 1])
  assert.equal(solveVrp(graph, 2, { capacities: [6, 6] }).status, 'infeasible')
})

test('custom search can traverse a long tour without exhausting the call stack', () => {
  const count = 5000
  const graph = instance(Array(count).fill(1), Array.from({ length: count }, (_, i) => [i, (i + 1) % count, 1]))
  const result = solveTsp(graph, { timeLimitMs: 5000 })
  assert.equal(result.status, 'optimal')
  assert.equal(result.cost, count)
})

// Independent oracle: permute all customers, cut into nonempty routes, and score.
function* orders(customers) {
  if (!customers.length) yield []
  for (const first of customers) {
    for (const rest of orders(customers.filter(id => id !== first))) yield [first, ...rest]
  }
}
function oracle(graph, capacities) {
  const roads = new Map()
  for (const { source, target, weight } of graph.edges) {
    roads.set(source + ',' + target, weight)
    roads.set(target + ',' + source, weight)
  }
  const customers = graph.nodes.filter(node => node.id !== graph.start).map(node => node.id)
  let best = Infinity
  for (const stops of orders(customers)) {
    for (let mask = 0; mask < 2 ** (stops.length - 1); mask++) {
      const parts = [[]]
      stops.forEach((id, i) => {
        if (i && (mask & (1 << (i-1)))) parts.push([])
        parts.at(-1).push(id)
      })
      if (parts.length !== capacities.length) continue
      let cost = 0
      for (const [v, part] of parts.entries()) {
        if (part.reduce((sum, id) => sum + graph.nodes[Number(id)].weight, 0) > capacities[v]) cost = Infinity
        const route = [graph.start, ...part, graph.start]
        for (let i = 1; i < route.length; i++) cost += roads.get(route[i-1] + ',' + route[i]) ?? Infinity
      }
      best = Math.min(best, cost)
    }
  }
  return best
}

test('proven costs match exhaustive enumeration across sparse graphs and fleets', async () => {
  let state = 47
  const random = () => (state = (Math.imul(1664525, state) + 1013904223) >>> 0) / 2 ** 32
  for (let draw = 0; draw < 35; draw++) {
    const weights = Array.from({ length: 6 }, () => Math.floor(random() * 4))
    const roads = []
    for (let i = 0; i < 6; i++) for (let j = 0; j < i; j++) {
      if (random() < 0.7) roads.push([i, j, Math.floor(random() * 12)])
    }
    const graph = instance(weights, roads)
    graph.start = String(draw % 6)
    for (const capacities of [[Infinity], [4, 6], [3, 5, 4]]) {
      const expected = oracle(graph, capacities)
      const result = capacities.length === 1 ? solveTsp(graph) : solveVrp(graph, capacities.length, { capacities })
      assert.equal(result.status, Number.isFinite(expected) ? 'optimal' : 'infeasible')
      assert.equal(result.cost ?? Infinity, expected)
      const cp = await solveGraph({ graph, capacities: capacities.length === 1 ? undefined : capacities })
      assert.equal(cp.status, result.status)
      assert.equal(cp.cost ?? Infinity, expected)
      for (const id of capacities.length === 1 ? ['held-karp', 'highs'] : ['savings', 'highs']) {
        const run = await runSolver(id, { graph, capacities: capacities.length === 1 ? undefined : capacities })
        if (id === 'savings') {
          if ('routes' in run) assert.ok(run.cost >= expected)
          else assert.ok(run.status === 'unknown' || run.status === 'infeasible')
        } else {
          assert.equal(run.status, result.status)
          assert.equal(run.cost ?? Infinity, expected)
        }
      }
    }
  }
})
