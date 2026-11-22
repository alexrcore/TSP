// node --experimental-strip-types benchmarks/tsp.mjs [first seed] [baseline module path]
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { solveTsp } from '../src/routing/solver.ts'
import { runSolver } from '../src/routing/compare.ts'
import { evaluate, indexRoads } from '../src/routing/problem.ts'

const firstSeed = Number(process.argv[2] ?? 71)
const baseline = process.argv[3] && await import(pathToFileURL(resolve(process.argv[3])))
const budget = 150
function instance(family, seed) {
  let state = seed
  const random = () => (state = (Math.imul(1664525, state) + 1013904223) >>> 0) / 2 ** 32
  const n = { forced: 72, sparse: 34, cubic: 30, complete: 16 }[family]
  const nodes = Array.from({ length: n }, (_, i) => ({ id: String(i), weight: 1 }))
  const positions = nodes.map(() => [random(), random()])
  const edges = [], used = new Set()
  function add(i, j) {
    const key = Math.min(i, j) * n + Math.max(i, j)
    if (i === j || used.has(key)) return false
    used.add(key)
    const weight = family === 'complete' ? Math.round(1000 * Math.hypot(
      positions[i][0] - positions[j][0], positions[i][1] - positions[j][1])) : 1 + Math.floor(100 * random())
    edges.push({ source: nodes[i].id, target: nodes[j].id, weight })
    return true
  }
  for (let i = 0; i < n; i++) add(i, (i + 1) % n)
  if (family === 'cubic') {
    const second = Array.from({ length: n / 2 }, (_, i) => n / 2 + i)
    for (let i = second.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1))
      ;[second[i], second[j]] = [second[j], second[i]]
    }
    // Avoid matching either of the two ring edges between these halves.
    if (second[0] === n - 1 || second.at(-1) === n / 2) [second[0], second[n / 2 - 1]] = [second.at(-1), second[0]]
    for (let i = 0; i < second.length; i++) add(i, second[i])
  } else {
    for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) {
      if (family === 'complete' || (family === 'sparse' && random() < 2.5 / n) ||
          (family === 'forced' && !(i % 2 || j % 2) && random() < 0.23)) add(i, j)
    }
  }
  return { graph: { nodes, edges, start: '0' }, initialRoutes: [[...nodes.map(node => node.id), '0']] }
}

const engines = {
  ...(baseline && { baseline: req => baseline.solveTsp(req.graph, { initialRoutes: req.initialRoutes, timeLimitMs: budget }) }),
  custom: req => solveTsp(req.graph, { initialRoutes: req.initialRoutes, timeLimitMs: budget }),
  cpSat: req => runSolver('cp-sat', req, budget),
}
await runSolver('cp-sat', instance('sparse', 0), 10) // Exclude one-time WASM startup.
for (const family of ['forced', 'sparse', 'cubic', 'complete']) {
  const summary = Object.fromEntries(Object.keys(engines).map(id => [id, { proven: 0, totalCost: 0, ms: [] }]))
  for (let draw = 0; draw < 8; draw++) {
    const req = instance(family, firstSeed + draw * 104729)
    const roads = indexRoads(req.graph)
    const results = []
    const order = Object.keys(engines)
    for (let j = 0; j < order.length; j++) {
      const id = order[(draw + j) % order.length]
      const before = performance.now()
      const result = await engines[id](req)
      const ms = performance.now() - before
      assert.ok('routes' in result, id + ' lost the feasible starting tour')
      const checked = evaluate(roads, result.routes.map(r => r.stops.map(stop => roads.ids.get(stop))))
      assert.equal(checked?.cost, result.cost)
      summary[id].proven += Number(result.status === 'optimal')
      summary[id].totalCost += result.cost
      summary[id].ms.push(ms)
      results.push(result)
    }
    for (const result of results) {
      if (result.status === 'optimal') assert.equal(result.cost, Math.min(...results.map(r => r.cost)))
    }
  }
  for (const [solver, s] of Object.entries(summary)) {
    s.ms.sort((a, b) => a - b)
    console.log(JSON.stringify({ family, solver, firstSeed, budget, cases: 8, proven: s.proven,
      totalCost: s.totalCost, medianMs: Math.round((s.ms[3] + s.ms[4]) * 5) / 10 }))
  }
}
