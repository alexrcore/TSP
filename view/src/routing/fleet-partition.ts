type Candidate = { mask: number; customers: number[]; load: number; cost: number }

/** Find the least-cost exact cover of the customers by depot-to-depot routes. */
export function searchFleetPartition(home: number, neighbors: number[][], demand: number[], capacities: number[],
  cost: (a: number, b: number) => number, deadline: number, bestCost: () => number,
  accept: (routes: number[][]) => void): boolean {
  const count = neighbors.length
  // Beyond this range, the caller searches routes directly without materializing subsets.
  if (count > 30) return false
  const maxStops = count - capacities.length
  const limit = Math.max(...capacities)
  const cheapest = new Map<number, Candidate>()
  const stops: number[] = []
  const start = performance.now()
  const enumerationDeadline = start + (deadline - start) * 0.45
  let interrupted = false
  let iterations = 0

  function enumerate(at: number, mask: number, load: number, spent: number) {
    if ((iterations++ & 127) === 0 && (performance.now() >= enumerationDeadline || cheapest.size > 20000)) {
      interrupted = true
      return
    }
    for (const next of neighbors[at]) {
      if (interrupted) return
      const bit = 1 << next
      if (next === home || (mask & bit)) continue
      const nextLoad = load + demand[next]
      if (nextLoad > limit) continue
      const nextSpent = spent + cost(at, next)
      if (nextSpent >= bestCost()) continue
      const nextMask = mask | bit
      const closedCost = nextSpent + cost(next, home)
      stops.push(next)
      if (closedCost < (cheapest.get(nextMask)?.cost ?? Infinity)) {
        cheapest.set(nextMask, { mask: nextMask, customers: stops.slice(), load: nextLoad, cost: closedCost })
      }
      if (stops.length < maxStops) enumerate(next, nextMask, nextLoad, nextSpent)
      stops.pop()
    }
  }
  enumerate(home, 0, 0, 0)
  if (interrupted) return false

  const candidates = neighbors.map(() => [] as Candidate[])
  for (const route of cheapest.values()) {
    for (const customer of route.customers) candidates[customer].push(route)
  }
  const customers = neighbors.map((_, i) => i).filter(i => i !== home)
    .sort((a, b) => candidates[a].length - candidates[b].length)
  for (const group of candidates) group.sort((a, b) => a.cost / a.customers.length - b.cost / b.customers.length)
  const fleet = capacities.map((capacity, vehicle) => ({ capacity, vehicle })).sort((a, b) => a.capacity - b.capacity)
  const assignment: (Candidate | undefined)[] = Array(capacities.length)
  function cover(mask: number, remaining: number, vehicles: number, spent: number) {
    if (spent >= bestCost() || remaining < vehicles || remaining > maxStops * vehicles) return
    if ((iterations++ & 127) === 0 && performance.now() >= deadline) { interrupted = true; return }
    if (vehicles === 0) {
      accept(assignment.map(route => [home, ...route!.customers, home]))
      return
    }
    const first = customers.find(id => !(mask & (1 << id)))!
    for (const route of candidates[first]) {
      if (interrupted) return
      if ((route.mask & mask) || route.customers.length > remaining - vehicles + 1) continue
      // Using the smallest available vehicle that fits leaves larger vehicles available
      // for every other route. Equivalent vehicle permutations need only one search.
      const fit = fleet.find(v => !assignment[v.vehicle] && v.capacity >= route.load)
      if (!fit) continue
      assignment[fit.vehicle] = route
      cover(mask | route.mask, remaining - route.customers.length, vehicles - 1, spent + route.cost)
      assignment[fit.vehicle] = undefined
    }
  }
  cover(0, customers.length, fleet.length, 0)
  return !interrupted
}
