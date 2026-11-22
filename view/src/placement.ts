import { forceCollide, forceLink, forceManyBody, forceSimulation } from 'd3-force'
import type { Point, PositionedNode } from './layout'

export type Spring = { source: PositionedNode; target: PositionedNode; distance: number; weight: number }

function side(a: Point, b: Point, p: Point) {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
}

function crosses(a: Spring, b: Spring) {
  const { source: p, target: q } = a
  const { source: r, target: s } = b
  if (p === r || p === s || q === r || q === s) return false
  if (Math.max(p.x, q.x) < Math.min(r.x, s.x) || Math.max(r.x, s.x) < Math.min(p.x, q.x) ||
      Math.max(p.y, q.y) < Math.min(r.y, s.y) || Math.max(r.y, s.y) < Math.min(p.y, q.y)) return false
  return side(p, q, r) * side(p, q, s) < 0 && side(r, s, p) * side(r, s, q) < 0
}

function lengthError({ source, target, distance }: Spring) {
  return (Math.hypot(source.x - target.x, source.y - target.y) / distance - 1) ** 2
}

type LayoutScore = { crossings: number; stress: number }

function better(a: LayoutScore, b: LayoutScore) {
  return a.crossings < b.crossings || a.crossings === b.crossings && a.stress < b.stress - 1e-6
}

function layoutCost(links: Spring[], nodes: PositionedNode[]): LayoutScore {
  let crossings = 0, stress = 0
  for (const [index, link] of links.entries()) {
    stress += lengthError(link)
    const { source: a, target: b } = link
    const dx = b.x - a.x, dy = b.y - a.y
    const length = Math.hypot(dx, dy)
    // Leave breathing room between an edge and nodes it does not connect.
    if (length && nodes.length <= 150) {
      for (const node of nodes) {
        if (node === a || node === b) continue
        const along = ((node.x - a.x) * dx + (node.y - a.y) * dy) / length
        if (along <= 0 || along >= length) continue
        const clearance = Math.abs(side(a, b, node)) / length
        if (clearance < 18) stress += 0.12 * (1 - clearance / 18) ** 2
      }
    }
    for (let other = 0; other < index; other++) {
      if (crosses(link, links[other])) crossings++
    }
  }
  return { crossings, stress }
}

function refineCrossings(nodes: PositionedNode[], links: Spring[]) {
  const incident = new Map(nodes.map((node) => [node, [] as Spring[]]))
  for (const link of links) {
    incident.get(link.source)!.push(link)
    incident.get(link.target)!.push(link)
  }

  const directions = Array.from({ length: 8 }, (_, index) => {
    const angle = index * Math.PI / 4
    return { x: Math.cos(angle), y: Math.sin(angle) }
  })

  // Only edges attached to a moving node can change their crossing count.
  for (const step of [32, 22, 14, 8, 4]) {
    for (const node of nodes) {
      const attached = incident.get(node)!
      const cost = () => {
        let crossings = 0, stress = 0
        for (const link of attached) {
          stress += lengthError(link)
          for (const other of links) if (crosses(link, other)) crossings++
        }
        return { crossings, stress }
      }
      const startX = node.x, startY = node.y
      const maxErrors = attached.map((link) => Math.max(0.3, lengthError(link)) + 1e-6)
      let bestX = startX, bestY = startY, bestScore = cost()
      for (const direction of directions) {
        node.x = startX + direction.x * step
        node.y = startY + direction.y * step
        if (nodes.some((other) => other !== node && (other.x - node.x) ** 2 + (other.y - node.y) ** 2 < 21 ** 2)) continue
        if (attached.some((link, index) => lengthError(link) > maxErrors[index])) continue
        const score = cost()
        if (better(score, bestScore)) {
          bestX = node.x
          bestY = node.y
          bestScore = score
        }
      }
      node.x = bestX
      node.y = bestY
    }
  }
}

// Give each branch of a weighted spanning tree a separate angular sector.
function treeSeed(nodes: PositionedNode[], links: Spring[]) {
  const adjacent = new Map(nodes.map((node) => [node, [] as { node: PositionedNode; length: number }[]]))
  for (const { source, target, distance } of links) {
    adjacent.get(source)!.push({ node: target, length: distance })
    adjacent.get(target)!.push({ node: source, length: distance })
  }
  const root = nodes.find(({ isStart }) => isStart) ?? nodes.reduce((best, node) =>
    adjacent.get(node)!.length > adjacent.get(best)!.length ? node : best)
  const tree = new Map([[root, { parent: root, length: 0, leaves: 0 }]])
  const order = [root]
  for (const parent of order) {
    for (const { node, length } of adjacent.get(parent)!) {
      if (tree.has(node)) continue
      tree.set(node, { parent, length, leaves: 0 })
      order.push(node)
    }
  }
  for (let index = order.length - 1; index > 0; index--) {
    const branch = tree.get(order[index])!
    tree.get(branch.parent)!.leaves += Math.max(1, branch.leaves)
  }
  root.x = root.y = 0
  const angles = new Map([[root, { next: -1.33, span: 2.66 }]])
  for (const node of order.slice(1)) {
    const branch = tree.get(node)!
    const parent = angles.get(branch.parent)!
    const span = parent.span * Math.max(1, branch.leaves) / tree.get(branch.parent)!.leaves
    const angle = parent.next + span / 2
    node.x = branch.parent.x + branch.length * Math.cos(angle)
    node.y = branch.parent.y + branch.length * Math.sin(angle)
    angles.set(node, { next: parent.next, span })
    parent.next += span
  }
}

export function settleComponent(nodes: PositionedNode[], links: Spring[]) {
  const attempts = nodes.length <= 110 && links.length <= 180 ? 9 :
    nodes.length <= 320 && links.length <= 650 ? 3 : 1
  let best: Point[] = []
  let bestScore = { crossings: Infinity, stress: Infinity }
  let seed = 21943

  function consider() {
    const score = layoutCost(links, nodes)
    if (!better(score, bestScore)) return
    bestScore = score
    best = nodes.map(({ x, y }) => ({ x, y }))
  }

  if (links.length === nodes.length - 1 && nodes.length <= 150) {
    treeSeed(nodes, links)
    const crowded = nodes.some((node, index) => nodes.slice(0, index).some((other) =>
      (node.x - other.x) ** 2 + (node.y - other.y) ** 2 < 21 ** 2))
    if (!crowded) return
  }

  for (let attempt = 0; attempt < attempts; attempt++) {
    const order = nodes.slice()
    if (attempt > 1) {
      for (let index = order.length - 1; index > 0; index--) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        const other = Math.floor(seed / 2 ** 32 * (index + 1))
        ;[order[index], order[other]] = [order[other], order[index]]
      }
    }
    for (const node of order) {
      node.x = node.y = NaN
      Object.assign(node, { vx: 0, vy: 0 })
    }
    if (attempt === 1) treeSeed(nodes, links)

    const simulation = forceSimulation(order).stop()
      .velocityDecay(0.45)
      .force('links', forceLink<PositionedNode, Spring>(links).distance((link) => link.distance).strength(0.86).iterations(3))
      .force('charge', forceManyBody().strength(-40).distanceMax(290))
      .force('collision', forceCollide<PositionedNode>(11).iterations(2))
    simulation.tick(300)
    if (attempts === 1) return

    if (nodes.length <= 36 && links.length <= 85) refineCrossings(nodes, links)
    consider()
  }

  if (bestScore.crossings && nodes.length <= 45 && links.length <= 130) {
    tryOuterCycles(nodes, links, () => {
      refineCrossings(nodes, links)
      consider()
      return bestScore.crossings === 0
    })
  }
  nodes.forEach((node, index) => Object.assign(node, best[index]))
  if ((nodes.length > 36 || links.length > 85) && nodes.length <= 150 && links.length <= 240) refineCrossings(nodes, links)
}

// Try short cycles as exterior faces. A convex boundary and barycentric interior
// can reveal planar drawings that a spring simulation flattens into crossings.
function tryOuterCycles(nodes: PositionedNode[], links: Spring[], visit: () => boolean) {
  const neighbors = new Map(nodes.map((node) => [node, new Map<PositionedNode, number>()]))
  const indices = new Map(nodes.map((node, index) => [node, index]))
  for (const { source, target, distance } of links) {
    neighbors.get(source)!.set(target, 1 / distance)
    neighbors.get(target)!.set(source, 1 / distance)
  }

  const tried = new Set<string>()
  for (const { source, target } of links) {
    const parent = new Map([[source, source]])
    const queue = [source]
    for (const node of queue) {
      if (parent.has(target)) break
      for (const next of neighbors.get(node)!.keys()) {
        if (parent.has(next) || node === source && next === target) continue
        parent.set(next, node)
        queue.push(next)
      }
    }
    if (!parent.has(target)) continue
    const outer = [target]
    while (outer.at(-1) !== source) outer.push(parent.get(outer.at(-1)!)!)
    const key = outer.map((node) => indices.get(node)!).sort((a, b) => a - b).join(',')
    if (tried.has(key)) continue
    tried.add(key)

    const boundary = new Set(outer)
    for (const node of nodes) node.x = node.y = 0
    outer.forEach((node, index) => {
      const angle = index * 2 * Math.PI / outer.length
      node.x = Math.cos(angle)
      node.y = Math.sin(angle)
    })
    for (let step = 0; step < 120; step++) {
      for (const node of nodes) {
        if (boundary.has(node)) continue
        let x = 0, y = 0, total = 0
        for (const [neighbor, weight] of neighbors.get(node)!) {
          x += neighbor.x * weight
          y += neighbor.y * weight
          total += weight
        }
        node.x = x / total
        node.y = y / total
      }
    }
    let sum = 0, squareSum = 0
    for (const { source: a, target: b, distance } of links) {
      const ratio = Math.hypot(a.x - b.x, a.y - b.y) / distance
      sum += ratio
      squareSum += ratio ** 2
    }
    const scale = sum / squareSum
    for (const node of nodes) { node.x *= scale; node.y *= scale }
    const crowded = nodes.some((node, index) => nodes.slice(0, index).some((other) =>
      (node.x - other.x) ** 2 + (node.y - other.y) ** 2 < 21 ** 2))
    const edgeThroughNode = !crowded && links.some(({ source: a, target: b }) => {
      const dx = b.x - a.x, dy = b.y - a.y
      const distance = Math.hypot(dx, dy)
      return nodes.some((node) => {
        if (node === a || node === b) return false
        const along = ((node.x - a.x) * dx + (node.y - a.y) * dy) / distance
        return along > 0 && along < distance && Math.abs(side(a, b, node)) / distance < 2
      })
    })
    if (!crowded && !edgeThroughNode && visit()) return
    if (tried.size >= 18) return
  }
}

