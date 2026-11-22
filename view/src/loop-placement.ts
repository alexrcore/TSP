import type { Point, PositionedNode } from './layout'
import type { Spring } from './placement'

const turn = 2 * Math.PI
const wrap = (index: number, count: number) => (index + count) % count
const square = (point: Point) => point.x ** 2 + point.y ** 2

function circleRadius(chords: number[]) {
  const angleSum = (r: number) => chords.reduce((sum, length) => sum + 2 * Math.asin(Math.min(1, length / (2 * r))), 0)
  let low = chords.reduce((max, chord) => Math.max(max, chord), 0) / 2
  let high = chords.reduce((sum, chord) => sum + chord, 0)
  if (angleSum(low) <= turn) return
  for (let step = 0; step < 55; step++) {
    const middle = (low + high) / 2
    if (angleSum(middle) > turn) low = middle
    else high = middle
  }
  return (low + high) / 2
}

function translation(bridges: { difference: Point; length: number }[]) {
  const first = bridges[0]
  const equations = bridges.slice(1).map(({ difference, length }) => ({
    x: difference.x - first.difference.x,
    y: difference.y - first.difference.y,
    sum: (square(difference) - square(first.difference) - length ** 2 + first.length ** 2) / 2,
  }))
  let best = 0
  let result: Point | undefined
  for (let i = 0; i < equations.length; i++) {
    const a = equations[i]
    for (let j = 0; j < i; j++) {
      const b = equations[j]
      const det = a.x * b.y - a.y * b.x
      if (Math.abs(det) <= Math.max(1e-12, best)) continue
      best = Math.abs(det)
      result = { x: (a.sum * b.y - a.y * b.sum) / det, y: (a.x * b.sum - a.sum * b.x) / det }
    }
  }
  return result
}

function crossings(links: Spring[], positions: Map<PositionedNode, Point>) {
  const side = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  return links.some(({ source: a, target: b }, index) => {
    const p = positions.get(a)!, q = positions.get(b)!
    for (let i = 0; i < index; i++) {
      const { source: c, target: d } = links[i]
      if (a === c || a === d || b === c || b === d) continue
      const r = positions.get(c)!, s = positions.get(d)!
      if (side(p, q, r) * side(p, q, s) < 0 && side(r, s, p) * side(r, s, q) < 0) return true
    }
    return false
  })
}

export function placeCycle(nodes: PositionedNode[], links: Spring[], typical: number) {
  if (nodes.length < 3 || links.length !== nodes.length || links.some((link) => link.weight <= 0)) return false
  const adjacent = new Map(nodes.map((node) => [node, new Map<PositionedNode, number>()]))
  for (const { source, target, weight } of links) {
    adjacent.get(source)!.set(target, weight / typical)
    adjacent.get(target)!.set(source, weight / typical)
  }
  if (nodes.some((node) => adjacent.get(node)!.size !== 2)) return false
  const ring = [nodes.find(({ isStart }) => isStart) ?? nodes[0]]
  const seen = new Set(ring)
  const chords: number[] = []
  for (const at of ring) {
    const next = [...adjacent.get(at)!].find(([node]) => !seen.has(node))
    if (!next) break
    ring.push(next[0])
    seen.add(next[0])
    chords.push(next[1])
  }
  const closing = adjacent.get(ring.at(-1)!)!.get(ring[0])
  if (ring.length !== nodes.length || !closing) return false
  chords.push(closing)
  if (chords.some((chord) => chord < 0.03 || chord > 8)) return false
  const radius = circleRadius(chords)
  if (radius === undefined) return false
  let angle = Math.PI * 1.06
  ring.forEach((node, index) => {
    node.x = radius * 88 * Math.cos(angle)
    node.y = radius * 88 * Math.sin(angle)
    angle += 2 * Math.asin(chords[index] / (2 * radius))
  })
  return true
}

export function placeLoops(nodes: PositionedNode[], links: Spring[], typical: number) {
  const size = nodes.length / 2
  if (!Number.isInteger(size) || size < 3 || size > 9 || links.length < nodes.length + 3 || links.length > size * 3) return false
  const maximum = Math.max(...links.map(({ weight }) => weight))
  const scale = 88 / (typical / maximum)
  if (!Number.isFinite(scale) || scale < 8 || scale > 1000) return false
  const adjacent = new Map(nodes.map((node) => [node, new Map<PositionedNode, number>()]))
  for (const { source, target, weight } of links) {
    if (!weight || adjacent.get(source)!.has(target)) return false
    adjacent.get(source)!.set(target, weight / maximum)
    adjacent.get(target)!.set(source, weight / maximum)
  }
  if (nodes.some((node) => adjacent.get(node)!.size < 2 || adjacent.get(node)!.size > 3)) return false

  function realize(first: PositionedNode[]) {
    const seen = new Set(first)
    const other = nodes.filter((node) => !seen.has(node))
    if (nodes.some((node) => [...adjacent.get(node)!.keys()].filter((next) => seen.has(next) === seen.has(node)).length !== 2)) return false

    const bridge = first.map((node) => [...adjacent.get(node)!.keys()].find((next) => !seen.has(next)))
    const index = bridge.findIndex(Boolean)
    if (index < 0) return false
    const second = [bridge[index]!]
    const otherSet = new Set(other)
    for (const at of second) {
      const next = [...adjacent.get(at)!.keys()].find((candidate) => otherSet.has(candidate) && !second.includes(candidate))
      if (!next) break
      second.push(next)
    }
    if (second.length !== size) return false
    const aligned = [1, -1].map((direction) => first.map((_, i) => second[wrap((i - index) * direction, size)]))
      .find((ring) => bridge.every((node, i) => !node || node === ring[i]))
    if (!aligned) return false

    const chordLengths = (ring: PositionedNode[]) => ring.map((node, i) => adjacent.get(node)!.get(ring[(i + 1) % size])!)
    const length = (chords: number[]) => chords.reduce((sum, chord) => sum + chord, 0)
    const [outer, inner] = length(chordLengths(first)) > length(chordLengths(aligned)) ? [first, aligned] : [aligned, first]
    const outerLengths = chordLengths(outer), innerLengths = chordLengths(inner)
    const ratio = length(innerLengths) / length(outerLengths)
    if (ratio < 0.25 || ratio > 0.85 || innerLengths.some((chord, i) => Math.abs(chord - outerLengths[i] * ratio) > 1e-8)) return false
    const radius = circleRadius(outerLengths)
    if (radius === undefined) return false

    let angle = 0
    const angles = outerLengths.map((chord) => {
      const current = angle
      angle += 2 * Math.asin(chord / (2 * radius))
      return current
    })
    const spoke = outer.map((node, i) => adjacent.get(node)!.get(inner[i]))
    const bridgeCount = spoke.filter((value) => value !== undefined).length
    if (bridgeCount < 3) return false
    const middle = spoke.findIndex((value, i) => value && spoke[wrap(i - 1, size)] && spoke[wrap(i + 1, size)])
    // Parallel rings can be nested, or reflected and joined alongside one another.
    for (const paired of [false, true]) {
      if (paired && (bridgeCount !== 3 || middle < 0)) continue
      const origin = paired ? angles[middle] : angles[Math.max(0, outer.findIndex(({ isStart }) => isStart))] + Math.PI * 0.91
      const external = angles.map((current) => ({ x: radius * Math.cos(current - origin), y: radius * Math.sin(current - origin) }))
      const internal = external.map(({ x, y }) => ({ x: x * ratio * (paired ? -1 : 1), y: y * ratio }))
      const differences = external.flatMap(({ x, y }, i) => spoke[i] === undefined ? [] : [{
        difference: { x: x - internal[i].x, y: y - internal[i].y }, length: spoke[i]!,
      }])
      const shift = translation(differences)
      if (!shift || differences.some(({ difference, length }) => Math.abs(Math.hypot(difference.x - shift.x, difference.y - shift.y) - length) > 1e-7)) continue
      if (paired ? shift.x <= radius * (1 + ratio) : Math.hypot(shift.x, shift.y) >= radius * (0.82 - ratio)) continue
      const positions = new Map<PositionedNode, Point>()
      outer.forEach((node, i) => positions.set(node, external[i]))
      inner.forEach((node, i) => positions.set(node, { x: internal[i].x + shift.x, y: internal[i].y + shift.y }))
      if (crossings(links, positions)) continue
      const xs = [...positions.values()].map(({ x }) => x), ys = [...positions.values()].map(({ y }) => y)
      const xCenter = (Math.min(...xs) + Math.max(...xs)) / 2
      const yCenter = (Math.min(...ys) + Math.max(...ys)) / 2
      for (const [node, position] of positions) {
        node.x = (position.x - xCenter) * scale
        node.y = (position.y - yCenter) * scale
      }
      return true
    }
    return false
  }

  // Discover two disjoint cycles from connectivity alone. Graph input contains only weights.
  const root = nodes[0]
  const path = [root]
  let budget = 6000
  function search(at: PositionedNode): boolean {
    if (--budget < 0) return false
    if (path.length === size) return adjacent.get(at)!.has(root) && realize(path)
    for (const next of adjacent.get(at)!.keys()) {
      if (path.includes(next)) continue
      path.push(next)
      if (search(next)) return true
      path.pop()
    }
    return false
  }
  return search(root)
}

