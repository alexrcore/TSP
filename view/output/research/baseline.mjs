// src/routing/fleet-partition.ts
function searchFleetPartition(home, neighbors, demand, capacities, cost, deadline, bestCost, accept) {
  const count = neighbors.length;
  if (count > 30) return false;
  const maxStops = count - capacities.length;
  const limit = Math.max(...capacities);
  const cheapest = /* @__PURE__ */ new Map();
  const stops = [];
  const start = performance.now();
  const enumerationDeadline = start + (deadline - start) * 0.45;
  let interrupted = false;
  let iterations = 0;
  function enumerate(at, mask, load, spent) {
    if ((iterations++ & 127) === 0 && (performance.now() >= enumerationDeadline || cheapest.size > 2e4)) {
      interrupted = true;
      return;
    }
    for (const next of neighbors[at]) {
      if (interrupted) return;
      const bit = 1 << next;
      if (next === home || mask & bit) continue;
      const nextLoad = load + demand[next];
      if (nextLoad > limit) continue;
      const nextSpent = spent + cost(at, next);
      if (nextSpent >= bestCost()) continue;
      const nextMask = mask | bit;
      const closedCost = nextSpent + cost(next, home);
      stops.push(next);
      if (closedCost < (cheapest.get(nextMask)?.cost ?? Infinity)) {
        cheapest.set(nextMask, { mask: nextMask, customers: stops.slice(), load: nextLoad, cost: closedCost });
      }
      if (stops.length < maxStops) enumerate(next, nextMask, nextLoad, nextSpent);
      stops.pop();
    }
  }
  enumerate(home, 0, 0, 0);
  if (interrupted) return false;
  const candidates = neighbors.map(() => []);
  for (const route of cheapest.values()) {
    for (const customer of route.customers) candidates[customer].push(route);
  }
  const customers = neighbors.map((_, i) => i).filter((i) => i !== home).sort((a, b) => candidates[a].length - candidates[b].length);
  for (const group of candidates) group.sort((a, b) => a.cost / a.customers.length - b.cost / b.customers.length);
  const fleet = capacities.map((capacity, vehicle) => ({ capacity, vehicle })).sort((a, b) => a.capacity - b.capacity);
  const assignment = Array(capacities.length);
  function cover(mask, remaining, vehicles, spent) {
    if (spent >= bestCost() || remaining < vehicles || remaining > maxStops * vehicles) return;
    if ((iterations++ & 127) === 0 && performance.now() >= deadline) {
      interrupted = true;
      return;
    }
    if (vehicles === 0) {
      accept(assignment.map((route) => [home, ...route.customers, home]));
      return;
    }
    const first = customers.find((id) => !(mask & 1 << id));
    for (const route of candidates[first]) {
      if (interrupted) return;
      if (route.mask & mask || route.customers.length > remaining - vehicles + 1) continue;
      const fit = fleet.find((v) => !assignment[v.vehicle] && v.capacity >= route.load);
      if (!fit) continue;
      assignment[fit.vehicle] = route;
      cover(mask | route.mask, remaining - route.customers.length, vehicles - 1, spent + route.cost);
      assignment[fit.vehicle] = void 0;
    }
  }
  cover(0, customers.length, fleet.length, 0);
  return !interrupted;
}

// src/routing/problem.ts
function indexRoads(graph) {
  const ids = new Map(graph.nodes.map((node, i) => [node.id, i]));
  const depot = ids.get(graph.start ?? graph.nodes[0]?.id);
  if (depot === void 0) throw new Error("Unknown start node.");
  const neighbors = graph.nodes.map(() => /* @__PURE__ */ new Map());
  graph.edges.forEach(({ source, target, weight: weight2 }, i) => {
    const a = ids.get(source), b = ids.get(target);
    if (a === void 0 || b === void 0 || !Number.isFinite(weight2) || weight2 < 0) throw new Error("Invalid road.");
    const prior = neighbors[a].get(b);
    if (a === b || prior !== void 0 && graph.edges[prior].weight <= weight2) return;
    neighbors[a].set(b, i);
    neighbors[b].set(a, i);
  });
  const weight = (a, b) => graph.edges[neighbors[a].get(b) ?? -1]?.weight ?? Infinity;
  return { graph, ids, depot, neighbors, weight };
}
function evaluate(roads, paths, capacities) {
  const { depot, graph, neighbors } = roads;
  if (paths.length !== (capacities?.length ?? 1)) return;
  const seen = /* @__PURE__ */ new Set();
  const routes = [];
  let total = 0;
  for (const [v, path] of paths.entries()) {
    if (path.length < (capacities ? 3 : 4) || path[0] !== depot || path.at(-1) !== depot) return;
    let load = 0, cost = 0;
    const edges = [];
    for (let i = 1; i < path.length; i++) {
      const node = path[i], edge = neighbors[path[i - 1]]?.get(node);
      if (edge === void 0) return;
      edges.push(edge);
      cost += graph.edges[edge].weight;
      if (i < path.length - 1) {
        if (node === depot || seen.has(node)) return;
        seen.add(node);
        load += graph.nodes[node].weight;
      }
    }
    if (capacities && load > capacities[v]) return;
    routes.push({ stops: path.map((i) => graph.nodes[i].id), edges, cost });
    total += cost;
  }
  if (seen.size === graph.nodes.length - 1 && Number.isFinite(total)) return { routes, cost: total };
}

// src/routing/solver.ts
function solveTsp(graph, options = {}) {
  if (graph.nodes.length < 3) return { status: "infeasible" };
  return optimize(graph, [Infinity], false, options);
}
function solveVrp(graph, vehicleCount, options = {}) {
  if (!Number.isSafeInteger(vehicleCount) || vehicleCount < 1) throw new Error("Use a positive integer fleet size.");
  if (vehicleCount >= graph.nodes.length) return { status: "infeasible" };
  const capacities = options.capacities ?? Array(vehicleCount).fill(Infinity);
  if (capacities.length !== vehicleCount || capacities.some((c) => !(c >= 0))) throw new Error("Check the fleet capacities.");
  return optimize(graph, capacities, true, options);
}
function optimize(graph, capacities, useDemand, options) {
  const deadline = performance.now() + (options.timeLimitMs ?? 1500);
  const { nodes, edges } = graph;
  const indexed = indexRoads(graph);
  const { ids, depot: home, neighbors: roads, weight: cost } = indexed;
  if (roads.some((row) => row.size < (useDemand ? 1 : 2))) return { status: "infeasible" };
  const demand = nodes.map((node, i) => useDemand && i !== home ? node.weight : 0);
  if (demand.some((value) => !Number.isFinite(value) || value < 0)) throw new Error("Customer demands must be nonnegative.");
  const fleet = capacities.length;
  let best = Infinity;
  let winner;
  function accept(routes2) {
    if (routes2.length !== fleet) return;
    const served = /* @__PURE__ */ new Set();
    let total = 0;
    for (const [k, stops] of routes2.entries()) {
      if (stops.length < 3 || stops[0] !== home || stops.at(-1) !== home) return;
      let load = 0;
      for (let i = 1; i < stops.length; i++) {
        const a = stops[i - 1], b = stops[i];
        if (!roads[a]?.has(b)) return;
        total += cost(a, b);
        if (i === stops.length - 1) continue;
        if (b === home || served.has(b)) return;
        served.add(b);
        load += demand[b];
      }
      if (load > capacities[k]) return;
    }
    if (served.size === nodes.length - 1 && total < best) {
      best = total;
      winner = routes2.map((route) => route.slice());
    }
  }
  if (options.initialRoutes) accept(options.initialRoutes.map((route) => route.map((id) => ids.get(id) ?? -1)));
  if (fleet > 1 && demand.every((value) => Number.isSafeInteger(value) && value <= Number.MAX_SAFE_INTEGER / nodes.length)) {
    const regional = solveDepotRegions(indexed, demand, capacities, deadline, winner);
    if (regional) return regional;
  }
  const choices = roads.map((row, i) => [...row.keys()].sort((a, b) => cost(i, a) - cost(i, b)));
  const cheapest = choices.map((row, i) => cost(i, row[0]));
  if (winner) {
    const routes2 = winner.map((route) => route.slice());
    const loads = routes2.map((route) => route.reduce((sum, i) => sum + demand[i], 0));
    let changed = true;
    while (changed && performance.now() < deadline) {
      changed = false;
      for (const [k, r] of routes2.entries()) {
        for (let i = 1; i < r.length - 1 && performance.now() < deadline; i++) {
          for (let j = i + 1; j < r.length - 1; j++) {
            const reversed = cost(r[i - 1], r[j]) + cost(r[i], r[j + 1]);
            const original = cost(r[i - 1], r[i]) + cost(r[j], r[j + 1]);
            if (reversed < original) {
              r.splice(i, j - i + 1, ...r.slice(i, j + 1).reverse());
              changed = true;
            }
          }
          if (r.length <= 3) continue;
          const stop = r[i];
          const saving = cost(r[i - 1], stop) + cost(stop, r[i + 1]) - cost(r[i - 1], r[i + 1]);
          if (!Number.isFinite(saving)) continue;
          let moved = false;
          for (const [v, other] of routes2.entries()) {
            if (v === k || loads[v] + demand[stop] > capacities[v]) continue;
            for (let j = 1; j < other.length; j++) {
              const extra = cost(other[j - 1], stop) + cost(stop, other[j]) - cost(other[j - 1], other[j]);
              if (extra >= saving) continue;
              r.splice(i, 1);
              other.splice(j, 0, stop);
              loads[k] -= demand[stop];
              loads[v] += demand[stop];
              moved = changed = true;
              break;
            }
            if (moved) break;
          }
        }
      }
      if (changed) accept(routes2);
    }
  }
  const integerBound = edges.every((e) => Number.isSafeInteger(e.weight) && e.weight <= Number.MAX_SAFE_INTEGER / (nodes.length + fleet + 1));
  const lower = integerBound ? cheapest : cheapest.map(() => 0);
  const bits = nodes.map((_, i) => 1n << BigInt(i));
  const path = [];
  const memo = /* @__PURE__ */ new Map();
  let expired = false;
  let iterations = 0;
  function search(initialBound) {
    const stack = [];
    function enter(at, visited, left, vehicle, load, spent, bound) {
      if (spent + bound >= best) return;
      const key = visited + ":" + at + ":" + vehicle + ":" + load;
      if ((memo.get(key) ?? Infinity) <= spent) return;
      if (memo.size >= 12e4) memo.clear();
      memo.set(key, spent);
      stack.push({ at, visited, left, vehicle, load, spent, bound: bound - lower[at], choice: 0 });
      path.push(at);
    }
    enter(home, bits[home], nodes.length - 1, 0, 0, 0, initialBound);
    while (stack.length) {
      if ((iterations++ & 255) === 0 && performance.now() >= deadline) {
        expired = true;
        return;
      }
      const frame = stack[stack.length - 1];
      if (frame.choice === choices[frame.at].length) {
        stack.pop();
        path.pop();
        continue;
      }
      const next = choices[frame.at][frame.choice++];
      const nextCost = frame.spent + cost(frame.at, next);
      const later = fleet - frame.vehicle - 1;
      if (next === home) {
        if (frame.left < later || later === 0 && frame.left > 0) continue;
        if (later > 0) enter(home, frame.visited, frame.left, frame.vehicle + 1, 0, nextCost, frame.bound);
        else if (nextCost < best) {
          const routes2 = [];
          let start = 0;
          for (let i = 1; i < path.length; i++) {
            if (path[i] === home) {
              routes2.push(path.slice(start, i + 1));
              start = i;
            }
          }
          routes2.push([...path.slice(start), home]);
          accept(routes2);
        }
      } else if (frame.left > later && !(frame.visited & bits[next]) && frame.load + demand[next] <= capacities[frame.vehicle]) {
        enter(next, frame.visited | bits[next], frame.left - 1, frame.vehicle, frame.load + demand[next], nextCost, frame.bound);
      }
    }
  }
  const covered = useDemand && fleet > 1 && integerBound && demand.every((value) => Number.isSafeInteger(value) && value <= Number.MAX_SAFE_INTEGER / nodes.length) && searchFleetPartition(home, choices, demand, capacities, cost, deadline, () => best, accept);
  if (!covered) {
    const initialBound = lower.reduce((sum, value) => sum + value, 0) + (fleet - 1) * lower[home];
    search(initialBound);
  }
  if (!winner) return { status: expired ? "unknown" : "infeasible" };
  const routes = winner.map((stops) => {
    const indices = stops.slice(1).map((to, i) => roads[stops[i]].get(to));
    return { stops: stops.map((i) => nodes[i].id), edges: indices, cost: indices.reduce((sum, i) => sum + edges[i].weight, 0) };
  });
  return { status: expired ? "feasible" : "optimal", cost: best, routes };
}
function solveDepotRegions(roads, demand, capacities, deadline, seed) {
  const { graph, depot, ids, neighbors } = roads;
  const regionOf = new Int32Array(neighbors.length).fill(-1);
  const regions = [];
  for (let first = 0; first < neighbors.length; first++) {
    if (first === depot || regionOf[first] !== -1) continue;
    if (regions.length === capacities.length) return { status: "infeasible" };
    const customers = [first];
    regionOf[first] = regions.length;
    let load = 0;
    for (const customer of customers) {
      load += demand[customer];
      for (const next of neighbors[customer].keys()) {
        if (next === depot || regionOf[next] !== -1) continue;
        regionOf[next] = regions.length;
        customers.push(next);
      }
    }
    regions.push({ customers, load, edges: [] });
  }
  if (regions.length !== capacities.length) return;
  for (const path of seed ?? []) regions[regionOf[path[1]]].seed = path.map((i) => graph.nodes[i].id);
  for (const edge of graph.edges) {
    const from = ids.get(edge.source), to = ids.get(edge.target);
    if (from !== to) regions[regionOf[from === depot ? to : from]].edges.push(edge);
  }
  regions.sort((a, b) => a.load - b.load);
  const fleet = capacities.map((capacity, vehicle) => ({ capacity, vehicle })).sort((a, b) => a.capacity - b.capacity);
  if (regions.some((region, i) => region.load > fleet[i].capacity)) return { status: "infeasible" };
  const paths = [];
  let optimal = true;
  for (const [i, region] of regions.entries()) {
    const { customers } = region;
    if (customers.length === 1) {
      if (!neighbors[depot].has(customers[0])) return { status: "infeasible" };
      paths[fleet[i].vehicle] = [depot, customers[0], depot];
      continue;
    }
    const subgraph = { start: graph.nodes[depot].id, nodes: [graph.nodes[depot], ...customers.map((j) => graph.nodes[j])], edges: region.edges };
    const result = solveTsp(subgraph, {
      initialRoutes: region.seed && [region.seed],
      timeLimitMs: Math.max(0, deadline - performance.now()) / (regions.length - i)
    });
    if (!("routes" in result)) return result;
    optimal &&= result.status === "optimal";
    paths[fleet[i].vehicle] = result.routes[0].stops.map((id) => ids.get(id));
  }
  const verified = evaluate(roads, paths, capacities);
  if (!verified) throw new Error("Invalid regional route assignment.");
  return { ...verified, status: optimal ? "optimal" : "feasible" };
}
export {
  solveTsp,
  solveVrp
};
