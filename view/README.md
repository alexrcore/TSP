# Graph visualizer

Run `npm install` and `npm run dev`. The app opens with a randomly generated weighted traveling salesman example. The route button builds and checks a closed tour through every node before showing the graph. Every node, including the red start node, has at least two distinct neighbors. Many generated graphs have multiple tours.

The truck button generates a capacitated vehicle routing instance. The depot, customer locations, demands, fleet size, road connections, and each vehicle’s capacity vary. The red **D** is the common depot. The generator checks that its route plan visits every customer once and stays within each vehicle's capacity. The fleet pill shows the vehicle count. The file icon accepts graphs that may have no route plan.

```json
{
  "start": "a",
  "nodes": [
    { "id": "a", "weight": 2 },
    { "id": "b", "weight": 5, "label": "Node B" },
    { "id": "c", "weight": 1 }
  ],
  "edges": [
    { "source": "a", "target": "b", "weight": 1 },
    { "source": "b", "target": "c", "weight": 8 }
  ]
}
```

Node IDs must be unique strings or numbers. Edges use those IDs and must have nonnegative weights. Missing weights default to `1`. Set `start` to a node ID to mark it with a red **S**. If omitted, the first node is the start. Imported graphs are undirected and get an automatic layout based on their connections and weights. Generated graphs open without edge crossings and use integer edge weights rounded from their drawn lengths. JSON imports can still use decimal weights. Arbitrary imported weights can require a best fit in two dimensions.

Drag the canvas to pan, and scroll or pinch to zoom. Click the percentage field to type a zoom level and press Enter to apply it. Drag a node to flex the graph without stretching its edges. Connected nodes may move to keep the lengths fixed. Position changes stay in the current view until you reload, generate a graph, or open another file. Hover over a node or edge to inspect it. Click to pin its details and click the canvas to dismiss them. The node and edge icons toggle their weight labels independently. The theme switch remembers your choice.

With the canvas focused, arrow keys pan, `+` and `-` zoom, and `0` fits the graph. Press `Enter` to navigate nodes or `E` to navigate edges with the arrow keys. Press `Escape` to return to the canvas.

### Route playback

Press Play to solve the current graph. Pause and resume at any point, or press Replay after the routes finish. Click the speed multiplier to cycle through 0.5×, 1×, 2×, 4× and 8×. Vehicles depart together in individual colors.

The bottom-left statistics show total node weight for TSP or total customer packages for VRP. After solving, the route icon shows the cost of every road traversal in the solution, including the return trips. A plain cost is a proven minimum. A cost marked ≤ is an upper bound on the minimum. Hover over or tap the fleet count to see each truck's capacity. After solving, each row shows assigned packages / capacity and the driver's round-trip cost. Keyboard users can focus the count and press Enter to open the breakdown or Escape to dismiss it.

### Comparing solvers

Use the upward arrow beside Play to compare the five solvers for the current graph. Opening it starts the searches in local workers. Results arrive independently and are cached for that graph. Every award marks the lowest cost found so far, including ties. Select a row and press Play to animate its routes. Switching during playback starts the selected route from the depot. TSP and VRP remember their selections separately.

| Choice | Applies to | Method |
| --- | --- | --- |
| OR-Tools CP-SAT | Both | Circuit constraints with Boolean road and customer assignments. [Google OR-Tools](https://developers.google.com/optimization/cp/cp_solver) |
| HiGHS MIP | Both | A mixed-integer model over directed roads with flow conservation and subtour elimination. [HiGHS](https://github.com/ERGO-Code/HiGHS) |
| Held–Karp | TSP | Exact subset dynamic programming over reachable states, subject to the search budget. [Held and Karp](https://doi.org/10.1137/0110015) |
| Clarke–Wright savings | VRP | A savings heuristic adapted to missing roads and different truck capacities. [Clarke and Wright](https://doi.org/10.1287/opre.12.4.568) |
| Guided local search | Both | A local implementation using road penalties, segment reversals and customer transfers to escape local minima. [Routing search methods](https://developers.google.com/optimization/routing/routing_options) |
| Custom search | Both | Branch and bound with state dominance and fleet set partitioning. |

The comparison entry point is `runSolver(id, request, timeLimitMs?)` in `src/routing/compare.ts`. The default search budget is 1.5 seconds per solver, excluding engine startup. All minimize total road cost on the same graph. Fleet routes must use every vehicle, serve each customer once, return to the depot, and respect each truck's capacity. The app validates a returned route against the original roads and recomputes its score before displaying it. “Starting plan” identifies a generated feasible plan retained when a solver produces no cheaper route and no proof. Imported graphs have no starting plan. If a numeric engine cannot represent an input precisely, its row reports a precision limit. The numeric engines scale decimal inputs only when the coefficients round-trip safely. WebAssembly assets load locally on demand.

Each shuffle samples a fresh size and node cloud. The size distribution gives larger graphs progressively lower probability and has no configured maximum node count. TSP starts at three nodes. VRP can start with one customer and a single truck. Generation and file layout run in a background worker. Another shuffle or import supersedes a pending request. TSP builds a tour either by uncrossing a random polygon or by an angular sweep or by joining two monotone chains. VRP groups customers by splitting a tour at visible depot links or by angular sectors. Both consider triangulation edges and random chords, using spatial indexes to check road crossings and clearance around nodes. Fleets can have tight, spare, mixed or uniform capacities. Very small instances and pure cycles can legitimately repeat a topology; most draws use a wider range of graph sizes.