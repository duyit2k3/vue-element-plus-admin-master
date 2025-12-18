import type { Warehouse3DData, Rack, PalletLocation, WarehouseZone } from '@/api/warehouse'

export interface Vec2 {
  x: number
  z: number
}

export interface PathfindingOptions {
  cellSize?: number
  safetyMargin?: number
  maxIterations?: number
  avoidZones?: boolean
  allowedZoneId?: number | null
  allowDiagonals?: boolean
}

export type PathPoint = Vec2

export interface PathResult {
  success: boolean
  points: PathPoint[]
  distance: number
  exploredNodes: number
}

interface GridConfig {
  cols: number
  rows: number
  cellSize: number
  originX: number
  originZ: number
}

interface GridCoord {
  xIndex: number
  zIndex: number
  index: number
}

interface HeapNode {
  index: number
  f: number
}

class MinHeap {
  private data: HeapNode[] = []

  get size(): number {
    return this.data.length
  }

  push(node: HeapNode): void {
    this.data.push(node)
    this.bubbleUp(this.data.length - 1)
  }

  pop(): HeapNode | undefined {
    if (this.data.length === 0) return undefined
    const top = this.data[0]
    const end = this.data.pop()!
    if (this.data.length > 0) {
      this.data[0] = end
      this.bubbleDown(0)
    }
    return top
  }

  private bubbleUp(index: number): void {
    const node = this.data[index]
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2)
      const parent = this.data[parentIndex]
      if (node.f >= parent.f) break
      this.data[parentIndex] = node
      this.data[index] = parent
      index = parentIndex
    }
  }

  private bubbleDown(index: number): void {
    const length = this.data.length
    const node = this.data[index]

    while (true) {
      const leftIndex = index * 2 + 1
      const rightIndex = index * 2 + 2
      let smallest = index

      if (leftIndex < length && this.data[leftIndex].f < this.data[smallest].f) {
        smallest = leftIndex
      }
      if (rightIndex < length && this.data[rightIndex].f < this.data[smallest].f) {
        smallest = rightIndex
      }

      if (smallest === index) break

      this.data[index] = this.data[smallest]
      this.data[smallest] = node
      index = smallest
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}

function worldToGrid(x: number, z: number, cfg: GridConfig): GridCoord {
  const relX = x - cfg.originX
  const relZ = z - cfg.originZ

  let xIndex = Math.floor(relX / cfg.cellSize)
  let zIndex = Math.floor(relZ / cfg.cellSize)

  xIndex = clamp(xIndex, 0, cfg.cols - 1)
  zIndex = clamp(zIndex, 0, cfg.rows - 1)

  const index = zIndex * cfg.cols + xIndex
  return { xIndex, zIndex, index }
}

function gridToWorld(xIndex: number, zIndex: number, cfg: GridConfig): Vec2 {
  const x = cfg.originX + (xIndex + 0.5) * cfg.cellSize
  const z = cfg.originZ + (zIndex + 0.5) * cfg.cellSize
  return { x, z }
}

function indexToCoord(index: number, cfg: GridConfig): { xIndex: number; zIndex: number } {
  const zIndex = Math.floor(index / cfg.cols)
  const xIndex = index - zIndex * cfg.cols
  return { xIndex, zIndex }
}

function heuristicIndex(aIndex: number, bIndex: number, cfg: GridConfig, cellSize: number): number {
  const a = indexToCoord(aIndex, cfg)
  const b = indexToCoord(bIndex, cfg)
  const dx = Math.abs(a.xIndex - b.xIndex)
  const dz = Math.abs(a.zIndex - b.zIndex)
  const minD = dx < dz ? dx : dz
  const maxD = dx > dz ? dx : dz
  return (Math.SQRT2 * minD + (maxD - minD)) * cellSize
}

function buildObstacleGrid(
  data: Warehouse3DData,
  cfg: GridConfig,
  safetyMargin: number,
  startIndex: number,
  goalIndex: number,
  options?: PathfindingOptions
): Uint8Array {
  const blocked = new Uint8Array(cfg.cols * cfg.rows)
  const margin = Math.max(0, safetyMargin)
  const avoidZones = !!options?.avoidZones
  const allowedZoneId =
    options && typeof options.allowedZoneId === 'number' ? options.allowedZoneId : null

  const markRectangle = (minX: number, maxX: number, minZ: number, maxZ: number) => {
    const fromX = clamp(Math.floor((minX - cfg.originX) / cfg.cellSize), 0, cfg.cols - 1)
    const toX = clamp(Math.ceil((maxX - cfg.originX) / cfg.cellSize) - 1, 0, cfg.cols - 1)
    const fromZ = clamp(Math.floor((minZ - cfg.originZ) / cfg.cellSize), 0, cfg.rows - 1)
    const toZ = clamp(Math.ceil((maxZ - cfg.originZ) / cfg.cellSize) - 1, 0, cfg.rows - 1)

    for (let zIndex = fromZ; zIndex <= toZ; zIndex++) {
      const rowOffset = zIndex * cfg.cols
      for (let xIndex = fromX; xIndex <= toX; xIndex++) {
        const idx = rowOffset + xIndex
        blocked[idx] = 1
      }
    }
  }
  if (avoidZones && Array.isArray(data.zones)) {
    const zoneMargin = margin > 0 ? margin : 0
    const zones = data.zones as WarehouseZone[]
    zones.forEach((zone: WarehouseZone) => {
      if (allowedZoneId !== null && zone.zoneId === allowedZoneId) {
        return
      }
      const minX = zone.positionX - zoneMargin
      const maxX = zone.positionX + zone.length + zoneMargin
      const minZ = zone.positionZ - zoneMargin
      const maxZ = zone.positionZ + zone.width + zoneMargin
      markRectangle(minX, maxX, minZ, maxZ)
    })
  }

  if (margin > 0) {
    const racks = data.racks || []
    racks.forEach((rack: Rack) => {
      const minX = rack.positionX - margin
      const maxX = rack.positionX + rack.length + margin
      const minZ = rack.positionZ - margin
      const maxZ = rack.positionZ + rack.width + margin
      markRectangle(minX, maxX, minZ, maxZ)
    })

    const pallets = data.pallets || []
    pallets.forEach((pallet: PalletLocation) => {
      const minX = pallet.positionX - margin
      const maxX = pallet.positionX + pallet.palletLength + margin
      const minZ = pallet.positionZ - margin
      const maxZ = pallet.positionZ + pallet.palletWidth + margin
      markRectangle(minX, maxX, minZ, maxZ)
    })
  }

  blocked[startIndex] = 0
  blocked[goalIndex] = 0

  const clearNeighborhood = (centerIndex: number, radius: number) => {
    if (radius <= 0) return
    const { xIndex, zIndex } = indexToCoord(centerIndex, cfg)
    for (let dz = -radius; dz <= radius; dz++) {
      const nz = zIndex + dz
      if (nz < 0 || nz >= cfg.rows) continue
      const rowOffset = nz * cfg.cols
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = xIndex + dx
        if (nx < 0 || nx >= cfg.cols) continue
        const idx = rowOffset + nx
        blocked[idx] = 0
      }
    }
  }

  clearNeighborhood(startIndex, 1)
  clearNeighborhood(goalIndex, 1)

  return blocked
}

function reconstructPath(cameFrom: Int32Array, currentIndex: number, cfg: GridConfig): Vec2[] {
  const path: Vec2[] = []
  let idx = currentIndex
  while (idx !== -1) {
    const { xIndex, zIndex } = indexToCoord(idx, cfg)
    path.push(gridToWorld(xIndex, zIndex, cfg))
    idx = cameFrom[idx]
  }
  path.reverse()
  return path
}

function compressPath(points: Vec2[]): Vec2[] {
  if (points.length <= 2) return points

  const result: Vec2[] = []
  result.push(points[0])

  let prevDx = Math.sign(points[1].x - points[0].x)
  let prevDz = Math.sign(points[1].z - points[0].z)

  for (let i = 1; i < points.length - 1; i++) {
    const dx = Math.sign(points[i + 1].x - points[i].x)
    const dz = Math.sign(points[i + 1].z - points[i].z)
    if (dx !== prevDx || dz !== prevDz) {
      result.push(points[i])
      prevDx = dx
      prevDz = dz
    }
  }

  result.push(points[points.length - 1])
  return result
}

function computeDistance(points: Vec2[]): number {
  if (points.length < 2) return 0
  let dist = 0
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x
    const dz = points[i].z - points[i - 1].z
    dist += Math.sqrt(dx * dx + dz * dz)
  }
  return dist
}

function computeRackStandingPoint(
  source: Vec2,
  rack: Rack,
  palletCenterX: number,
  warehouseLength: number,
  warehouseWidth: number,
  zone?: WarehouseZone
): Vec2 {
  const minX = rack.positionX
  const maxX = rack.positionX + rack.length
  const minZ = rack.positionZ
  const maxZ = rack.positionZ + rack.width

  const standOffset = 0.9
  const sideMargin = 0.4

  let x: number
  let z: number

  // Luôn đứng trước/sau rack theo trục Z, canh dọc theo chiều dài rack trên trục X
  if (source.z <= (minZ + maxZ) / 2) {
    z = minZ - standOffset
  } else {
    z = maxZ + standOffset
  }
  const targetX = palletCenterX != null ? palletCenterX : source.x
  x = clamp(targetX, minX + sideMargin, maxX - sideMargin)

  if (zone) {
    const zMinX = zone.positionX + 0.1
    const zMaxX = zone.positionX + zone.length - 0.1
    const zMinZ = zone.positionZ + 0.1
    const zMaxZ = zone.positionZ + zone.width - 0.1
    x = clamp(x, zMinX, zMaxX)
    z = clamp(z, zMinZ, zMaxZ)
  } else {
    x = clamp(x, 0.1, warehouseLength - 0.1)
    z = clamp(z, 0.1, warehouseWidth - 0.1)
  }

  return { x, z }
}

export function findPathBetweenPoints(
  data: Warehouse3DData,
  start: Vec2,
  goal: Vec2,
  options?: PathfindingOptions
): PathResult {
  const cellSize = options?.cellSize && options.cellSize > 0 ? options.cellSize : 0.5
  const safetyMargin =
    options && typeof options.safetyMargin === 'number' && options.safetyMargin >= 0
      ? options.safetyMargin
      : 0.25
  const maxIterations =
    options?.maxIterations && options.maxIterations > 0 ? options.maxIterations : 200000

  const cols = Math.max(1, Math.ceil(data.length / cellSize))
  const rows = Math.max(1, Math.ceil(data.width / cellSize))

  const cfg: GridConfig = {
    cols,
    rows,
    cellSize,
    originX: 0,
    originZ: 0
  }

  const startCell = worldToGrid(start.x, start.z, cfg)
  const goalCell = worldToGrid(goal.x, goal.z, cfg)

  const startIndex = startCell.index
  const goalIndex = goalCell.index

  const blocked = buildObstacleGrid(data, cfg, safetyMargin, startIndex, goalIndex, options)

  const totalCells = cols * rows
  const gScore = new Float64Array(totalCells)
  const fScore = new Float64Array(totalCells)
  const cameFrom = new Int32Array(totalCells)
  const closed = new Uint8Array(totalCells)

  for (let i = 0; i < totalCells; i++) {
    gScore[i] = Number.POSITIVE_INFINITY
    fScore[i] = Number.POSITIVE_INFINITY
    cameFrom[i] = -1
    closed[i] = 0
  }

  const openSet = new MinHeap()

  gScore[startIndex] = 0
  fScore[startIndex] = heuristicIndex(startIndex, goalIndex, cfg, cellSize)
  openSet.push({ index: startIndex, f: fScore[startIndex] })

  let explored = 0

  const allowDiagonals = options?.allowDiagonals !== false

  const neighbors = allowDiagonals
    ? [
        { dx: 1, dz: 0, cost: 1 },
        { dx: -1, dz: 0, cost: 1 },
        { dx: 0, dz: 1, cost: 1 },
        { dx: 0, dz: -1, cost: 1 },
        { dx: 1, dz: 1, cost: Math.SQRT2 },
        { dx: -1, dz: 1, cost: Math.SQRT2 },
        { dx: 1, dz: -1, cost: Math.SQRT2 },
        { dx: -1, dz: -1, cost: Math.SQRT2 }
      ]
    : [
        { dx: 1, dz: 0, cost: 1 },
        { dx: -1, dz: 0, cost: 1 },
        { dx: 0, dz: 1, cost: 1 },
        { dx: 0, dz: -1, cost: 1 }
      ]

  while (openSet.size > 0 && explored < maxIterations) {
    const current = openSet.pop()!
    const currentIndex = current.index

    if (closed[currentIndex]) {
      continue
    }

    if (currentIndex === goalIndex) {
      const rawPath = reconstructPath(cameFrom, currentIndex, cfg)
      const simplified = compressPath(rawPath)
      const distance = computeDistance(simplified)
      return {
        success: true,
        points: simplified,
        distance,
        exploredNodes: explored
      }
    }

    closed[currentIndex] = 1
    explored++

    const { xIndex, zIndex } = indexToCoord(currentIndex, cfg)

    for (const n of neighbors) {
      const nx = xIndex + n.dx
      const nz = zIndex + n.dz

      if (nx < 0 || nx >= cols || nz < 0 || nz >= rows) {
        continue
      }

      const nIndex = nz * cols + nx
      if (blocked[nIndex]) {
        continue
      }
      if (closed[nIndex]) {
        continue
      }

      let turnPenalty = 0
      const parentIndex = cameFrom[currentIndex]
      if (parentIndex !== -1) {
        const parentCoord = indexToCoord(parentIndex, cfg)
        const prevDx = Math.sign(xIndex - parentCoord.xIndex)
        const prevDz = Math.sign(zIndex - parentCoord.zIndex)
        if ((prevDx !== 0 || prevDz !== 0) && (n.dx !== prevDx || n.dz !== prevDz)) {
          turnPenalty = cellSize * 1.5
        }
      }

      const tentativeG = gScore[currentIndex] + n.cost * cellSize + turnPenalty
      if (tentativeG >= gScore[nIndex]) {
        continue
      }

      cameFrom[nIndex] = currentIndex
      gScore[nIndex] = tentativeG
      fScore[nIndex] = tentativeG + heuristicIndex(nIndex, goalIndex, cfg, cellSize)
      openSet.push({ index: nIndex, f: fScore[nIndex] })
    }
  }

  if (typeof console !== 'undefined') {
    try {
      const startCoord = indexToCoord(startIndex, cfg)
      const goalCoord = indexToCoord(goalIndex, cfg)

      const inspectNeighbors = (idx: number) => {
        const { xIndex, zIndex } = indexToCoord(idx, cfg)
        const get = (dx: number, dz: number) => {
          const nx = xIndex + dx
          const nz = zIndex + dz
          if (nx < 0 || nx >= cols || nz < 0 || nz >= rows) return 1
          return blocked[nz * cols + nx]
        }
        return {
          self: blocked[idx],
          left: get(-1, 0),
          right: get(1, 0),
          up: get(0, -1),
          down: get(0, 1)
        }
      }

      const startBlocked = inspectNeighbors(startIndex)
      const goalBlocked = inspectNeighbors(goalIndex)

      console.warn('[Pathfinding] failed to find path', {
        start,
        goal,
        safetyMargin,
        cellSize,
        cols,
        rows,
        explored,
        startCoord,
        goalCoord,
        startBlocked,
        goalBlocked
      })
    } catch {
      // ignore debug error
    }
  }

  return {
    success: false,
    points: [],
    distance: 0,
    exploredNodes: explored
  }
}

export function findPathToPallet(
  data: Warehouse3DData,
  palletId: number,
  start?: Vec2 | null,
  options?: PathfindingOptions
): PathResult {
  const pallet = data.pallets.find((p) => p.palletId === palletId)
  if (!pallet) {
    return {
      success: false,
      points: [],
      distance: 0,
      exploredNodes: 0
    }
  }

  let startX: number | null = null
  let startZ: number | null = null

  if (start) {
    startX = start.x
    startZ = start.z
  } else if (
    typeof data.checkinPositionX === 'number' &&
    typeof data.checkinPositionZ === 'number'
  ) {
    if (
      typeof data.checkinLength === 'number' &&
      data.checkinLength > 0 &&
      typeof data.checkinWidth === 'number' &&
      data.checkinWidth > 0
    ) {
      startX = data.checkinPositionX + data.checkinLength / 2
      startZ = data.checkinPositionZ + data.checkinWidth / 2
    } else {
      startX = data.checkinPositionX
      startZ = data.checkinPositionZ
    }
  } else {
    startX = 0
    startZ = 0
  }

  const startVec: Vec2 = { x: startX, z: startZ }

  let rectMinX = pallet.positionX
  let rectMaxX = pallet.positionX + pallet.palletLength
  let rectMinZ = pallet.positionZ
  let rectMaxZ = pallet.positionZ + pallet.palletWidth
  let rackForPallet: Rack | null = null

  if (pallet.shelfId != null) {
    const racks = data.racks || []
    for (const rack of racks) {
      const shelves = (rack.shelves || []) as any[]
      if (shelves.some((s: any) => s.shelfId === pallet.shelfId)) {
        rectMinX = rack.positionX
        rectMaxX = rack.positionX + rack.length
        rectMinZ = rack.positionZ
        rectMaxZ = rack.positionZ + rack.width
        rackForPallet = rack
        break
      }
    }
  }

  const effectiveOptions: PathfindingOptions = {
    ...(options || {}),
    allowDiagonals: false,
    avoidZones: false,
    allowedZoneId: null
  }

  const palletCenterX = pallet.positionX + pallet.palletLength / 2

  if (rackForPallet) {
    const goalVec: Vec2 = computeRackStandingPoint(
      startVec,
      rackForPallet,
      palletCenterX,
      data.length,
      data.width
    )

    return findPathBetweenPoints(data, startVec, goalVec, effectiveOptions)
  }

  const warehouseLength = data.length
  const warehouseWidth = data.width

  const standOffset = 0.9
  const sideMargin = 0.4

  const candidates: Vec2[] = []

  // Left side of pallet
  candidates.push({
    x: clamp(rectMinX - standOffset, 0.1, warehouseLength - 0.1),
    z: clamp(startVec.z, rectMinZ + sideMargin, rectMaxZ - sideMargin)
  })

  // Right side of pallet
  candidates.push({
    x: clamp(rectMaxX + standOffset, 0.1, warehouseLength - 0.1),
    z: clamp(startVec.z, rectMinZ + sideMargin, rectMaxZ - sideMargin)
  })

  // Front side (towards smaller Z)
  candidates.push({
    x: clamp(startVec.x, rectMinX + sideMargin, rectMaxX - sideMargin),
    z: clamp(rectMinZ - standOffset, 0.1, warehouseWidth - 0.1)
  })

  // Back side (towards larger Z)
  candidates.push({
    x: clamp(startVec.x, rectMinX + sideMargin, rectMaxX - sideMargin),
    z: clamp(rectMaxZ + standOffset, 0.1, warehouseWidth - 0.1)
  })

  const uniqueCandidates: Vec2[] = []
  for (const c of candidates) {
    if (!uniqueCandidates.some((u) => Math.abs(u.x - c.x) < 1e-3 && Math.abs(u.z - c.z) < 1e-3)) {
      uniqueCandidates.push(c)
    }
  }

  let best: PathResult | null = null
  let exploredTotal = 0

  for (const goal of uniqueCandidates) {
    const result = findPathBetweenPoints(data, startVec, goal, effectiveOptions)
    exploredTotal += result.exploredNodes

    if (!result.success || result.points.length < 2) {
      continue
    }

    if (!best || result.distance < best.distance) {
      best = result
    }
  }

  if (!best) {
    return {
      success: false,
      points: [],
      distance: 0,
      exploredNodes: exploredTotal
    }
  }

  return {
    success: true,
    points: best.points,
    distance: best.distance,
    exploredNodes: exploredTotal
  }
}
