<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed } from 'vue'
import { ContentWrap } from '@/components/ContentWrap'
import {
  ElCard,
  ElButton,
  ElRadioGroup,
  ElRadioButton,
  ElCheckbox,
  ElSelect,
  ElOption,
  ElDivider,
  ElMessage,
  ElMessageBox
} from 'element-plus'
import { Icon } from '@/components/Icon'
import { useRouter, useRoute } from 'vue-router'
import warehouseApi, { type Warehouse3DData } from '@/api/warehouse'
import { useUserStore } from '@/store/modules/user'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'

const { push } = useRouter()
const route = useRoute()
const loading = ref(true)
const warehouseData = ref<Warehouse3DData | null>(null)
const container = ref<HTMLDivElement>()
const userStore = useUserStore()

const warehouseId = computed(() => Number(route.params.id))
const userRole = computed(() => userStore.getUserInfo?.role?.toLowerCase() || '')
const canCreateInbound = computed(() => userRole.value === 'customer')
const canViewInbound = computed(() =>
  ['customer', 'warehouse_owner', 'admin'].includes(userRole.value)
)

const goToCreateInbound = () => {
  push({
    path: '/warehouse/inbound-request/create',
    query: { warehouseId: String(warehouseId.value) }
  })
}

const goToViewInbound = () => {
  push({ path: '/warehouse/inbound-request', query: { warehouseId: String(warehouseId.value) } })
}

// 3D Scene variables
let scene: THREE.Scene
let camera: THREE.PerspectiveCamera
let renderer: THREE.WebGLRenderer
let controls: OrbitControls
let raycaster: THREE.Raycaster
let mouse: THREE.Vector2

// UI State
const viewMode = ref<'zones' | 'items' | 'pallets' | 'racks' | ''>('')
const showGrid = ref(true)
const showLabels = ref(false)
const selectedObject = ref<any>(null)
const filterByCustomer = ref<number | undefined>(undefined)
const filterByZone = ref<number | undefined>(undefined)

// Statistics
const stats = computed(() => {
  if (!warehouseData.value) return null
  return {
    totalZones: warehouseData.value.zones?.length || 0,
    totalPallets: warehouseData.value.pallets?.length || 0,
    totalItems: warehouseData.value.items?.length || 0,
    totalRacks: warehouseData.value.racks?.length || 0
  }
})

// Customer list
const customers = computed(() => {
  if (!warehouseData.value?.zones) return []
  const map = new Map()
  warehouseData.value.zones.forEach((z) => {
    if (z.customerId && z.customerName) {
      map.set(z.customerId, z.customerName)
    }
  })
  return Array.from(map.entries()).map(([id, name]) => ({ id, name }))
})

// Zone list for filter
const zonesForFilter = computed(() => {
  if (!warehouseData.value?.zones) return []
  return warehouseData.value.zones.map((z) => ({
    id: z.zoneId,
    name: z.zoneName || `Zone #${z.zoneId}`
  }))
})

// Load warehouse 3D data
const loadWarehouse3DData = async () => {
  loading.value = true
  try {
    const res = await warehouseApi.getWarehouse3DData(warehouseId.value)
    if (res.statusCode === 200 || res.code === 0) {
      warehouseData.value = res.data
      initThreeJS()
      ElMessage.success('Tải dữ liệu kho thành công')
    } else {
      ElMessage.error(res.message || 'Không thể tải dữ liệu kho')
    }
  } catch (error) {
    ElMessage.error('Lỗi khi tải dữ liệu kho')
  } finally {
    loading.value = false
  }
}

// Initialize Three.js scene
const initThreeJS = () => {
  if (!container.value || !warehouseData.value) return

  // Clear previous scene
  if (renderer) {
    container.value.removeChild(renderer.domElement)
  }

  // Scene setup
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0xf0f0f0)

  // Camera setup
  const width = container.value.clientWidth
  const height = container.value.clientHeight
  camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000)

  // Position camera to view the warehouse from a good angle
  const wh = warehouseData.value
  camera.position.set(wh.length * 0.8, wh.height * 1.5, wh.width * 1.2)
  camera.lookAt(wh.length / 2, 0, wh.width / 2)

  // Renderer setup
  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setSize(width, height)
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  container.value.appendChild(renderer.domElement)

  // Controls
  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.05
  controls.target.set(wh.length / 2, 0, wh.width / 2)

  // Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
  scene.add(ambientLight)

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8)
  directionalLight.position.set(wh.length, wh.height * 2, wh.width)
  directionalLight.castShadow = true
  directionalLight.shadow.mapSize.width = 2048
  directionalLight.shadow.mapSize.height = 2048
  directionalLight.shadow.camera.far = 500
  scene.add(directionalLight)

  // Grid
  if (showGrid.value) {
    const gridSize = Math.max(wh.length, wh.width)
    const gridHelper = new THREE.GridHelper(gridSize, 50, 0x888888, 0xcccccc)
    gridHelper.name = 'gridHelper'
    scene.add(gridHelper)
  }

  // Ground
  const groundGeo = new THREE.PlaneGeometry(wh.length, wh.width)
  const groundMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, side: THREE.DoubleSide })
  const ground = new THREE.Mesh(groundGeo, groundMat)
  ground.rotation.x = -Math.PI / 2
  ground.position.set(wh.length / 2, 0, wh.width / 2)
  ground.receiveShadow = true
  ground.name = 'ground'
  scene.add(ground)

  renderCheckinAndGates()

  // Raycaster
  raycaster = new THREE.Raycaster()
  mouse = new THREE.Vector2()

  // Event listeners
  window.addEventListener('resize', onWindowResize)
  renderer.domElement.addEventListener('click', onCanvasClick)

  // Render warehouse objects
  renderWarehouse()

  // Start animation loop
  animate()
}

// Render warehouse objects
const renderWarehouse = () => {
  if (!warehouseData.value) return

  // Xoá các object động (zone, rack, shelf, pallet, item, khung kho) nhưng giữ lại nền, lưới, cổng, bàn checkin
  const dynamicTypes = ['zone', 'pallet', 'item']
  const objectsToRemove: THREE.Object3D[] = []

  scene.children.forEach((child) => {
    const userData: any = (child as any).userData || {}
    const type = userData.type as string | undefined
    const name = child.name || ''

    if (type && dynamicTypes.includes(type)) {
      objectsToRemove.push(child)
    } else if (name === 'warehouseBoundary') {
      objectsToRemove.push(child)
    } else if (name.startsWith('rack_') || name.startsWith('shelf_')) {
      objectsToRemove.push(child)
    }
  })

  objectsToRemove.forEach((obj) => scene.remove(obj))

  // Render warehouse boundary
  renderWarehouseBoundary()

  // Render zones
  warehouseData.value.zones?.forEach((zone) => {
    if (filterByZone.value && zone.zoneId !== filterByZone.value) return
    if (filterByCustomer.value && zone.customerId !== filterByCustomer.value) return
    renderZone(zone)
  })

  // Render racks
  renderRacks()

  // Render pallets
  warehouseData.value.pallets?.forEach((pallet) => {
    const zone = warehouseData.value!.zones?.find((z) => z.zoneId === pallet.zoneId)
    if (!zone) return
    if (filterByZone.value && zone.zoneId !== filterByZone.value) return
    if (filterByCustomer.value && zone.customerId !== filterByCustomer.value) return
    renderPallet(pallet)
  })

  // Render items
  warehouseData.value.items?.forEach((item) => {
    const pallet = warehouseData.value!.pallets?.find((p) => p.palletId === item.palletId)
    if (!pallet) return
    const zone = warehouseData.value!.zones?.find((z) => z.zoneId === pallet.zoneId)
    if (!zone) return
    if (filterByZone.value && zone.zoneId !== filterByZone.value) return
    if (filterByCustomer.value && zone.customerId !== filterByCustomer.value) return
    renderItem(item, pallet)
  })
}

const renderCheckinAndGates = () => {
  if (!warehouseData.value) return

  const wh = warehouseData.value

  if (
    wh.checkinPositionX !== null &&
    wh.checkinPositionX !== undefined &&
    wh.checkinPositionZ !== null &&
    wh.checkinPositionZ !== undefined
  ) {
    const deskLength = wh.checkinLength ?? 1.5
    const deskWidth = wh.checkinWidth ?? 0.8
    const deskHeight = wh.checkinHeight ?? 1.0

    // Bàn (khối đặc từ nền lên đến mặt bàn)
    const deskGeo = new THREE.BoxGeometry(deskLength, deskHeight, deskWidth)
    const deskMat = new THREE.MeshPhongMaterial({ color: 0xdcdcdc })
    const desk = new THREE.Mesh(deskGeo, deskMat)
    desk.position.set(wh.checkinPositionX, deskHeight / 2, wh.checkinPositionZ)
    desk.castShadow = true
    desk.receiveShadow = true
    desk.name = 'checkin_desk'
    scene.add(desk)

    // Màn hình máy tính
    const screenGeo = new THREE.BoxGeometry(0.7, 0.45, 0.03)
    const screenMat = new THREE.MeshPhongMaterial({ color: 0x2c3e50 })
    const screen = new THREE.Mesh(screenGeo, screenMat)
    screen.position.set(
      wh.checkinPositionX,
      deskHeight + 0.35,
      wh.checkinPositionZ - deskWidth / 2 + 0.05
    )
    screen.castShadow = true
    screen.name = 'checkin_monitor'
    scene.add(screen)

    // Chân màn hình
    const standGeo = new THREE.BoxGeometry(0.1, 0.25, 0.08)
    const standMat = new THREE.MeshPhongMaterial({ color: 0x34495e })
    const stand = new THREE.Mesh(standGeo, standMat)
    stand.position.set(
      wh.checkinPositionX,
      deskHeight + 0.15,
      wh.checkinPositionZ - deskWidth / 2 + 0.1
    )
    stand.castShadow = true
    scene.add(stand)
  }

  // Cổng kho hiển thị như 1 khung cửa mở
  wh.gates?.forEach((gate) => {
    const doorWidth = Number(gate.length ?? 2)
    const doorHeight = Number(gate.height ?? 2.2)
    const frameThickness = Number(gate.width ?? 0.3)
    const color = gate.gateType === 'exit' ? 0xe74c3c : 0x3498db
    const frameMat = new THREE.MeshPhongMaterial({ color })

    const group = new THREE.Group()

    // Hai trụ đứng
    const verticalGeo = new THREE.BoxGeometry(frameThickness, doorHeight, frameThickness)
    const left = new THREE.Mesh(verticalGeo, frameMat)
    left.position.set(-doorWidth / 2, doorHeight / 2, 0)
    left.castShadow = true
    const right = left.clone()
    right.position.x = doorWidth / 2

    // Thanh ngang trên
    const topGeo = new THREE.BoxGeometry(doorWidth, frameThickness, frameThickness)
    const top = new THREE.Mesh(topGeo, frameMat)
    top.position.set(0, doorHeight - frameThickness / 2, 0)
    top.castShadow = true

    group.add(left)
    group.add(right)
    group.add(top)

    group.position.set(gate.positionX, 0, gate.positionZ)
    group.name = `gate_${gate.gateId}`
    scene.add(group)
  })
}

// Render warehouse boundary (wireframe)
const renderWarehouseBoundary = () => {
  if (!warehouseData.value) return
  const { length, width, height } = warehouseData.value

  const geometry = new THREE.BoxGeometry(length, height, width)
  const edges = new THREE.EdgesGeometry(geometry)
  const line = new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 2 })
  )
  line.position.set(length / 2, height / 2, width / 2)
  line.name = 'warehouseBoundary'
  scene.add(line)
}

// Render zone (semi-transparent colored box)
const renderZone = (zone: any) => {
  const geometry = new THREE.BoxGeometry(zone.length, zone.height, zone.width)

  // Generate unique color per customer
  let color = 0x3498db
  if (zone.customerId) {
    const hue = (zone.customerId * 137.508) % 360
    color = new THREE.Color(`hsl(${hue}, 70%, 60%)`).getHex()
  }

  const material = new THREE.MeshPhongMaterial({
    color: color,
    transparent: true,
    opacity: 0.15,
    side: THREE.DoubleSide
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(
    zone.positionX + zone.length / 2,
    zone.positionY + zone.height / 2,
    zone.positionZ + zone.width / 2
  )
  mesh.userData = { type: 'zone', data: zone }
  mesh.name = `zone_${zone.zoneId}`

  // Add edges for better visibility
  const edges = new THREE.EdgesGeometry(geometry)
  const lineColor = new THREE.Color(color).multiplyScalar(0.7)
  const line = new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({ color: lineColor.getHex(), linewidth: 2 })
  )
  line.position.copy(mesh.position)
  line.userData = mesh.userData

  scene.add(mesh)
  scene.add(line)
}

// Render racks and shelves
const renderRacks = () => {
  if (!warehouseData.value?.racks) return

  warehouseData.value.racks.forEach((rack) => {
    const zone = warehouseData.value!.zones?.find((z) => z.zoneId === rack.zoneId)
    if (!zone) return
    if (filterByZone.value && zone.zoneId !== filterByZone.value) return
    if (filterByCustomer.value && zone.customerId !== filterByCustomer.value) return

    const frameGeometry = new THREE.BoxGeometry(rack.length, rack.height, rack.width)
    const frameEdges = new THREE.EdgesGeometry(frameGeometry)
    const frameLines = new THREE.LineSegments(
      frameEdges,
      new THREE.LineBasicMaterial({ color: 0x1f4e79 })
    )
    frameLines.position.set(
      rack.positionX + rack.length / 2,
      rack.positionY + rack.height / 2,
      rack.positionZ + rack.width / 2
    )
    frameLines.name = `rack_${rack.rackId}_frame`
    frameLines.userData = { type: 'rack', data: rack }
    scene.add(frameLines)

    if (rack.shelves) {
      rack.shelves.forEach((shelf: any) => {
        const shelfGeometry = new THREE.BoxGeometry(shelf.length, 0.05, shelf.width)
        const shelfMaterial = new THREE.MeshPhongMaterial({ color: 0xf5f5f5 })
        const shelfMesh = new THREE.Mesh(shelfGeometry, shelfMaterial)
        shelfMesh.position.set(
          rack.positionX + shelf.length / 2,
          shelf.positionY,
          rack.positionZ + shelf.width / 2
        )
        shelfMesh.castShadow = true
        shelfMesh.receiveShadow = true
        shelfMesh.name = `shelf_${shelf.shelfId}`
        shelfMesh.userData = { type: 'shelf', data: shelf }
        scene.add(shelfMesh)
      })
    }
  })
}

const renderPallet = (pallet: any) => {
  const geometry = new THREE.BoxGeometry(
    pallet.palletLength,
    pallet.palletHeight,
    pallet.palletWidth
  )

  // Check if pallet has items
  const hasItems = warehouseData.value!.items?.some((i) => i.palletId === pallet.palletId)
  const color = hasItems ? 0xe67e22 : 0xbdc3c7

  const material = new THREE.MeshPhongMaterial({ color: color })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(
    pallet.positionX + pallet.palletLength / 2,
    pallet.positionY + pallet.palletHeight / 2,
    pallet.positionZ + pallet.palletWidth / 2
  )
  mesh.userData = { type: 'pallet', data: pallet }
  mesh.name = `pallet_${pallet.palletId}`
  mesh.castShadow = true
  mesh.receiveShadow = true

  // Thêm viền để dễ quan sát biên pallet trong 3D
  const edgeGeo = new THREE.EdgesGeometry(geometry)
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x000000 })
  const edgeLines = new THREE.LineSegments(edgeGeo, edgeMat)
  edgeLines.position.copy(mesh.position)
  edgeLines.userData = mesh.userData
  edgeLines.name = `${mesh.name}_outline`

  scene.add(mesh)
  scene.add(edgeLines)
}

// Render item (box on pallet)
const renderItem = (item: any, pallet: any) => {
  const itemType = typeof item.itemType === 'string' ? item.itemType.toLowerCase() : ''
  const shape = typeof item.shape === 'string' ? item.shape.toLowerCase() : ''
  // ... rest of the code remains the same ...
  const isBox = itemType === 'box'
  const isBag = itemType === 'bag' || shape === 'bag' || shape === 'sack' || shape === 'bao'

  // Color based on properties (ưu tiên loại hàng)
  let color = 0x3498db // default khác
  if (isBag) {
    color = 0x27ae60 // bag: xanh lá
  } else if (isBox) {
    color = 0xe67e22 // box: cam
  }

  // Override theo thuộc tính đặc biệt
  if (item.isFragile) {
    color = 0xe74c3c // Red for fragile
  } else if (item.isHeavy) {
    color = 0x8e44ad // Purple for heavy
  } else if (item.priorityLevel && item.priorityLevel <= 3) {
    color = 0xf39c12 // Orange for high priority
  }

  // Nếu backend đã có layout chi tiết (manual hoặc auto) thì ưu tiên vẽ theo stackUnits
  if (Array.isArray(item.stackUnits) && item.stackUnits.length > 0) {
    renderItemFromStackUnits(item, pallet, color)
    return
  }

  if (isBox || isBag) {
    renderBoxItemAsCartons(item, pallet, color)
    return
  }

  const geometry = new THREE.BoxGeometry(item.length, item.height, item.width)
  const material = new THREE.MeshPhongMaterial({ color })
  const mesh = new THREE.Mesh(geometry, material)

  // Position relative to pallet (stack khối đơn giản nếu không có layout chi tiết)
  mesh.position.set(
    pallet.positionX + (item.positionX || 0) + item.length / 2,
    pallet.positionY + pallet.palletHeight + (item.positionY || 0) + item.height / 2,
    pallet.positionZ + (item.positionZ || 0) + item.width / 2
  )
  mesh.userData = { type: 'item', data: item }
  mesh.name = `item_${item.itemId}`
  mesh.castShadow = true

  // Add edges for better visibility
  const edges = new THREE.EdgesGeometry(geometry)
  const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000 }))
  line.position.copy(mesh.position)
  line.userData = mesh.userData

  scene.add(mesh)
  scene.add(line)
}

// Render từ stackUnits (layout chi tiết từ InboundItemStackUnits)
const renderItemFromStackUnits = (item: any, pallet: any, color: number) => {
  const units = (item.stackUnits || []) as any[]
  if (!units.length) return

  // Trong layout inbound, localX/Z được tính tương đối so với tâm pallet, mặt đất = 0
  const palletCenterX = pallet.positionX + pallet.palletLength / 2
  const palletBaseY = pallet.positionY
  const palletCenterZ = pallet.positionZ + pallet.palletWidth / 2

  const material = new THREE.MeshPhongMaterial({
    color,
    opacity: 0.95,
    transparent: true
  })
  const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x000000 })

  units.forEach((u) => {
    const length = Number(u.length) || 0
    const width = Number(u.width) || 0
    const height = Number(u.height) || 0
    if (length <= 0 || width <= 0 || height <= 0) return

    const geometry = new THREE.BoxGeometry(length, height, width)
    const mesh = new THREE.Mesh(geometry, material)

    mesh.position.set(
      palletCenterX + Number(u.localX || 0),
      palletBaseY + Number(u.localY || 0),
      palletCenterZ + Number(u.localZ || 0)
    )
    mesh.rotation.y = Number(u.rotationY || 0)
    mesh.userData = { type: 'item', data: item }
    mesh.name = `item_${item.itemId}_unit_${u.unitIndex ?? 0}`
    mesh.castShadow = true

    const edgeGeo = new THREE.EdgesGeometry(geometry)
    const edgeLines = new THREE.LineSegments(edgeGeo, edgeMaterial)
    edgeLines.position.copy(mesh.position)
    edgeLines.rotation.copy(mesh.rotation)
    edgeLines.userData = mesh.userData
    edgeLines.name = `${mesh.name}_outline`

    scene.add(mesh)
    scene.add(edgeLines)
  })
}

const renderBoxItemAsCartons = (item: any, pallet: any, color: number) => {
  const rawStackL = Number(item.length) || 0
  const rawStackW = Number(item.width) || 0
  const rawStackH = Number(item.height) || 0

  if (rawStackL <= 0 || rawStackW <= 0 || rawStackH <= 0) {
    return
  }

  const quantity = Math.max(1, Number(item.unitQuantity ?? 0) || 1)

  // Kích thước khối tổng của hàng trên pallet (đã được inbound/approval tính sẵn)
  const stackLength = rawStackL
  const stackWidth = rawStackW
  const stackHeight = rawStackH

  // Kích thước chuẩn 1 đơn vị (nếu có) từ product
  const stdL = (item.standardLength ?? null) as number | null
  const stdW = (item.standardWidth ?? null) as number | null

  // Bước 1: ước lượng kích thước 1 đơn vị trên mặt phẳng (L/W)
  let unitL = stdL && stdL > 0 ? stdL : 0
  let unitW = stdW && stdW > 0 ? stdW : 0

  // Nếu không có kích thước chuẩn, hoặc kích thước chuẩn gần bằng cả khối (khiến chỉ được 1 đơn vị/chiều)
  // thì suy ra kích thước đơn vị từ diện tích khối tổng và số lượng.
  if (!unitL || !unitW || unitL >= stackLength || unitW >= stackWidth) {
    const effectiveQty = Math.max(1, quantity)
    const area = Math.max(0.0001, stackLength * stackWidth)
    const unitArea = area / effectiveQty
    const aspect = stackLength > 0 && stackWidth > 0 ? stackLength / stackWidth : 1

    // Ước lượng L/W sao cho L*W ≈ unitArea và giữ tỉ lệ gần với tỉ lệ cạnh của pallet
    unitL = Math.sqrt(unitArea * aspect)
    unitW = Math.sqrt(unitArea / aspect)
  }

  // Bước 2: Tính số đơn vị tối đa trên 1 lớp theo 2 chiều
  const maxPerRow = Math.max(1, Math.floor(stackLength / unitL))
  const maxPerCol = Math.max(1, Math.floor(stackWidth / unitW))
  let perLayer = Math.max(1, maxPerRow * maxPerCol)

  // Nếu perLayer vẫn < 1 (do số liệu quá nhỏ) thì fallback tối thiểu 1
  if (perLayer < 1) perLayer = 1

  // Bước 3: Tính số tầng
  const layers = Math.max(1, Math.ceil(quantity / perLayer))

  // Kích thước thực tế của 1 thùng trên 3D (chia đều theo grid)
  const boxLength = stackLength / Math.max(1, maxPerRow)
  const boxWidth = stackWidth / Math.max(1, maxPerCol)
  const boxHeight = stackHeight / layers

  const geometry = new THREE.BoxGeometry(boxLength, boxHeight, boxWidth)
  const material = new THREE.MeshPhongMaterial({ color, flatShading: true })
  const edgesGeometry = new THREE.EdgesGeometry(geometry)
  const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x000000 })

  const baseX = pallet.positionX + (item.positionX || 0)
  const baseY = pallet.positionY + pallet.palletHeight + (item.positionY || 0)
  const baseZ = pallet.positionZ + (item.positionZ || 0)

  for (let idx = 0; idx < quantity; idx++) {
    const layer = Math.floor(idx / perLayer)
    const posInLayer = idx % perLayer
    const row = Math.floor(posInLayer / maxPerRow)
    const col = posInLayer % maxPerRow

    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(
      baseX + boxLength * (col + 0.5),
      baseY + boxHeight * (layer + 0.5),
      baseZ + boxWidth * (row + 0.5)
    )
    mesh.userData = { type: 'item', data: item }
    mesh.name = `item_${item.itemId}_carton`
    mesh.castShadow = true

    const edgeLines = new THREE.LineSegments(edgesGeometry, edgeMaterial)
    edgeLines.position.copy(mesh.position)
    edgeLines.userData = mesh.userData
    edgeLines.name = `${mesh.name}_outline`

    scene.add(mesh)
    scene.add(edgeLines)
  }
}

// Animation loop
const animate = () => {
  requestAnimationFrame(animate)
  controls.update()
  renderer.render(scene, camera)
}

// Window resize handler
const onWindowResize = () => {
  if (!container.value) return
  const width = container.value.clientWidth
  const height = container.value.clientHeight
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  renderer.setSize(width, height)
}

// Canvas click handler
const onCanvasClick = (event: MouseEvent) => {
  if (!container.value) return

  const mode = viewMode.value
  if (mode !== 'zones' && mode !== 'items' && mode !== 'pallets' && mode !== 'racks') {
    // Chỉ cho phép xem chi tiết khi người dùng đã chọn rõ chế độ xem
    return
  }

  const rect = container.value.getBoundingClientRect()
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

  raycaster.setFromCamera(mouse, camera)
  const intersects = raycaster.intersectObjects(scene.children, true)

  if (!intersects.length) return

  let typePriority: string[] = []
  if (mode === 'zones') {
    typePriority = ['zone']
  } else if (mode === 'items') {
    typePriority = ['item']
  } else if (mode === 'pallets') {
    // Ưu tiên hit pallet, nhưng nếu click trúng hàng trên pallet thì vẫn xử lý được
    typePriority = ['pallet', 'item']
  } else if (mode === 'racks') {
    typePriority = ['rack', 'shelf']
  }

  let targetUserData: any = null

  for (const t of typePriority) {
    const hit = intersects.find((i) => i.object.userData?.type === t)
    if (hit) {
      targetUserData = hit.object.userData
      break
    }
  }

  if (!targetUserData) return

  handleObjectClick(targetUserData)
}

// Handle object click
const handleObjectClick = (userData: any) => {
  selectedObject.value = userData.data

  if (userData.type === 'zone') {
    showZoneDetails(userData.data)
  } else if (userData.type === 'pallet') {
    showPalletDetails(userData.data)
  } else if (userData.type === 'rack') {
    showRackDetails(userData.data)
  } else if (userData.type === 'shelf') {
    const shelf = userData.data
    const rack = warehouseData.value?.racks?.find((r) => r.rackId === shelf.rackId)
    if (rack) {
      showRackDetails(rack)
    }
  } else if (userData.type === 'item') {
    // Ở chế độ xem pallet, click vào hàng cũng xem chi tiết pallet
    if (viewMode.value === 'pallets' && warehouseData.value) {
      const item = userData.data
      const pallet = warehouseData.value.pallets?.find((p) => p.palletId === item.palletId)
      if (pallet) {
        showPalletDetails(pallet)
        return
      }
    }

    showItemDetails(userData.data)
  }
}

const showZoneDetails = (zone: any) => {
  const itemCount =
    warehouseData.value?.items?.filter((i) => {
      const pallet = warehouseData.value!.pallets?.find((p) => p.palletId === i.palletId)
      return pallet?.zoneId === zone.zoneId
    }).length || 0

  ElMessageBox.alert(
    `
    <div style="line-height: 1.8">
      <p><strong>Tên khu vực:</strong> ${zone.zoneName || `Zone ${zone.zoneId}`}</p>
      <p><strong>Loại:</strong> ${zone.zoneType}</p>
      <p><strong>Khách hàng:</strong> ${zone.customerName || 'Chưa phân bổ'}</p>
      <p><strong>Kích thước:</strong> ${zone.length}m × ${zone.width}m × ${zone.height}m</p>
      <p><strong>Vị trí:</strong> (${zone.positionX}, ${zone.positionY}, ${zone.positionZ})</p>
      <p><strong>Dung tích:</strong> ${(zone.length * zone.width * zone.height).toFixed(2)} m³</p>
      <p><strong>Số hàng hóa:</strong> ${itemCount} items</p>
    </div>
    `,
    `🏢 Chi tiết khu vực`,
    {
      dangerouslyUseHTMLString: true,
      confirmButtonText: 'Đóng'
    }
  )
}

const showRackDetails = (rack: any) => {
  const shelves = (rack.shelves || []) as any[]
  const totalLevels = shelves.length

  let spacingHtml = ''

  if (totalLevels > 0) {
    const sorted = [...shelves].sort((a, b) => {
      if (a.shelfLevel != null && b.shelfLevel != null) {
        return a.shelfLevel - b.shelfLevel
      }
      return Number(a.positionY || 0) - Number(b.positionY || 0)
    })

    const baseY = Number(rack.positionY || 0)
    spacingHtml += '<ul>'

    const first = sorted[0]
    const firstY = Number(first.positionY || 0)
    const gapBase = firstY - baseY
    if (!Number.isNaN(gapBase) && gapBase > 0) {
      spacingHtml += `<li>Từ nền kệ đến Tầng ${first.shelfLevel ?? 1}: ${gapBase.toFixed(2)} m</li>`
    }

    for (let i = 0; i < sorted.length - 1; i++) {
      const current = sorted[i]
      const next = sorted[i + 1]
      const y1 = Number(current.positionY || 0)
      const y2 = Number(next.positionY || 0)
      const gap = y2 - y1
      if (!Number.isNaN(gap) && gap > 0) {
        const level1 = current.shelfLevel ?? i + 1
        const level2 = next.shelfLevel ?? i + 2
        spacingHtml += `<li>Tầng ${level1} – Tầng ${level2}: ${gap.toFixed(2)} m</li>`
      }
    }

    const topRackY = baseY + Number(rack.height || 0)
    const last = sorted[sorted.length - 1]
    const lastY = Number(last.positionY || 0)
    const gapTop = topRackY - lastY
    if (!Number.isNaN(gapTop) && gapTop > 0) {
      const lastLevel = last.shelfLevel ?? totalLevels
      spacingHtml += `<li>Tầng ${lastLevel} – Đỉnh kệ: ${gapTop.toFixed(2)} m</li>`
    }

    spacingHtml += '</ul>'
  } else {
    spacingHtml = '<p>Chưa cấu hình tầng kệ.</p>'
  }

  const zone = warehouseData.value?.zones?.find((z) => z.zoneId === rack.zoneId)

  ElMessageBox.alert(
    `
    <div style="line-height: 1.8">
      <p><strong>Tên kệ:</strong> ${rack.rackName || `Kệ #${rack.rackId}`}</p>
      <p><strong>Khu vực:</strong> ${zone?.zoneName || `Zone #${rack.zoneId}`}</p>
      <p><strong>Kích thước kệ:</strong> ${rack.length}m × ${rack.width}m × ${rack.height}m</p>
      <p><strong>Vị trí gốc (X, Y, Z):</strong> (${rack.positionX}, ${rack.positionY}, ${rack.positionZ})</p>
      <p><strong>Số tầng kệ:</strong> ${totalLevels}</p>
      <p><strong>Khoảng cách các tầng (theo chiều cao Y):</strong></p>
      ${spacingHtml}
    </div>
    `,
    `🗄️ Chi tiết Kệ`,
    {
      dangerouslyUseHTMLString: true,
      confirmButtonText: 'Đóng'
    }
  )
}

const showPalletDetails = (pallet: any) => {
  const items = warehouseData.value?.items?.filter((i) => i.palletId === pallet.palletId) || []

  ElMessageBox.alert(
    `
    <div style="line-height: 1.8">
      <p><strong>Barcode:</strong> ${pallet.barcode}</p>
      <p><strong>Mã vị trí:</strong> ${pallet.locationCode || 'N/A'}</p>
      <p><strong>Vị trí:</strong> (${pallet.positionX}, ${pallet.positionY}, ${pallet.positionZ})</p>
      <p><strong>Kích thước pallet:</strong> ${pallet.palletLength}m × ${pallet.palletWidth}m × ${pallet.palletHeight}m</p>
      ${
        items.length > 0
          ? `<hr/><p><strong>Danh sách hàng trên pallet:</strong></p><ul>${items
              .map((i) => {
                const unitSize =
                  i.standardLength && i.standardWidth && i.standardHeight
                    ? `${i.standardLength}m × ${i.standardWidth}m × ${i.standardHeight}m`
                    : 'N/A'
                const stackSize = `${i.length}m × ${i.width}m × ${i.height}m`
                const qty = i.unitQuantity ?? null
                const qtyText = qty != null ? (i.unit ? `${qty} ${i.unit}` : `${qty}`) : 'N/A'
                const mfg = i.manufacturingDate || 'N/A'
                const exp = i.expiryDate || 'N/A'

                return `
                  <li style="margin-bottom: 8px;">
                    <strong>${i.productName || i.itemName || i.qrCode || 'Hàng hóa'}</strong>
                    ${i.productCode ? `<div>Mã SP: ${i.productCode}</div>` : ''}
                    ${i.customerName ? `<div>Khách hàng: ${i.customerName}</div>` : ''}
                    <div>Kích thước thùng (1 đơn vị): ${unitSize}</div>
                    <div>Kích thước khối hàng trên pallet: ${stackSize}</div>
                    <div>Số lượng đơn vị trên pallet: ${qtyText}</div>
                    ${
                      i.weight || i.standardWeight
                        ? `<div>Trọng lượng: ${i.weight ? `${i.weight} kg` : ''}${
                            i.standardWeight
                              ? `${i.weight ? ' / ' : ''}Chuẩn: ${i.standardWeight} kg`
                              : ''
                          }</div>`
                        : ''
                    }
                    <div>Ngày sản xuất: ${mfg}</div>
                    <div>Hạn sử dụng: ${exp}</div>
                    ${
                      i.productDescription
                        ? `<div>Mô tả sản phẩm: ${i.productDescription}</div>`
                        : ''
                    }
                    ${
                      i.storageConditions ? `<div>Lưu ý bảo quản: ${i.storageConditions}</div>` : ''
                    }
                    ${
                      i.unitPrice || i.totalAmount
                        ? `<div>Giá: ${
                            i.unitPrice != null ? `${i.unitPrice.toLocaleString()} / đơn vị` : ''
                          }${
                            i.totalAmount != null
                              ? `${i.unitPrice != null ? ' – ' : ''}Thành tiền: ${i.totalAmount.toLocaleString()}`
                              : ''
                          }</div>`
                        : ''
                    }
                    ${
                      i.isFragile || i.isHeavy
                        ? `<div style="margin-top:4px;">${
                            i.isFragile
                              ? '<span style="color:#e74c3c; font-weight:600;">⚠ Dễ vỡ</span>'
                              : ''
                          }${
                            i.isHeavy
                              ? `${i.isFragile ? ' · ' : ''}<span style="color:#8e44ad; font-weight:600;">⚠ Hàng nặng</span>`
                              : ''
                          }</div>`
                        : ''
                    }
                  </li>
                `
              })
              .join('')}</ul>`
          : ''
      }
    </div>
    `,
    `📦 Chi tiết Pallet`,
    {
      dangerouslyUseHTMLString: true,
      confirmButtonText: 'Đóng'
    }
  )
}

const showItemDetails = (item: any) => {
  ElMessageBox.alert(
    `
    <div style="line-height: 1.8">
      <p><strong>Tên hàng:</strong> ${item.itemName || 'N/A'}</p>
      <p><strong>QR Code:</strong> ${item.qrCode}</p>
      <p><strong>Loại:</strong> ${item.itemType}</p>
      <p><strong>Khách hàng:</strong> ${item.customerName}</p>
      <p><strong>Kích thước:</strong> ${item.length}m × ${item.width}m × ${item.height}m</p>
      <p><strong>Trọng lượng:</strong> ${item.weight} kg</p>
      <p><strong>Hình dạng:</strong> ${item.shape}</p>
      <p><strong>Mức ưu tiên:</strong> ${item.priorityLevel || 'N/A'}</p>
      ${item.isFragile ? '<p style="color: red;"><strong>⚠️ DỄ VỠ</strong></p>' : ''}
      ${item.isHeavy ? '<p style="color: purple;"><strong>⚠️ NẶNG</strong></p>' : ''}
    </div>
    `,
    `📦 Chi tiết Hàng Hóa`,
    {
      dangerouslyUseHTMLString: true,
      confirmButtonText: 'Đóng'
    }
  )
}

// UI controls
const changeViewMode = () => {
  renderWarehouse()
}

const resetViewMode = () => {
  viewMode.value = ''
  filterByCustomer.value = undefined
  filterByZone.value = undefined
  showLabels.value = false
  renderWarehouse()
}

const toggleGrid = () => {
  const grid = scene.getObjectByName('gridHelper')
  if (grid) grid.visible = showGrid.value
}

const resetCamera = () => {
  if (!warehouseData.value) return
  const wh = warehouseData.value
  camera.position.set(wh.length * 0.8, wh.height * 1.5, wh.width * 1.2)
  controls.target.set(wh.length / 2, 0, wh.width / 2)
  controls.update()
}

const applyFilter = () => {
  renderWarehouse()
}

onMounted(() => {
  loadWarehouse3DData()
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
  if (renderer) {
    renderer.domElement.removeEventListener('click', onCanvasClick)
    if (container.value?.contains(renderer.domElement)) {
      container.value.removeChild(renderer.domElement)
    }
    renderer.dispose()
  }
})
</script>

<template>
  <ContentWrap :title="`Xem Kho 3D - ${warehouseData?.warehouseName || 'Loading...'}`">
    <template #header>
      <ElButton type="primary" @click="push(`/warehouse/${warehouseId}/detail`)">
        <Icon icon="vi-ant-design:arrow-left-outlined" />
        Quay Lại
      </ElButton>
      <ElButton type="info" @click="push(`/warehouse/${warehouseId}/items`)">
        <Icon icon="vi-ant-design:inbox-outlined" />
        Hàng Hóa
      </ElButton>
      <ElButton type="warning" @click="push(`/warehouse/${warehouseId}/zones`)">
        <Icon icon="vi-ant-design:layout-outlined" />
        Khu Vực
      </ElButton>
      <ElButton v-if="canCreateInbound" type="primary" @click="goToCreateInbound">
        <Icon icon="vi-ant-design:plus-square-outlined" />
        Thêm Yêu Cầu Nhập Kho
      </ElButton>
      <ElButton v-if="canViewInbound" @click="goToViewInbound">
        <Icon icon="vi-ant-design:unordered-list-outlined" />
        Xem Yêu Cầu Nhập Kho
      </ElButton>
    </template>

    <div class="warehouse-3d-viewer">
      <!-- Stats Bar -->
      <div v-if="stats" class="stats-bar">
        <div class="stat-item">
          <Icon icon="vi-ant-design:layout-outlined" class="stat-icon" />
          <div>
            <div class="stat-value">{{ stats.totalZones }}</div>
            <div class="stat-label">Khu vực</div>
          </div>
        </div>
        <div class="stat-item">
          <Icon icon="vi-ant-design:appstore-outlined" class="stat-icon" />
          <div>
            <div class="stat-value">{{ stats.totalRacks }}</div>
            <div class="stat-label">Số kệ (racks)</div>
          </div>
        </div>
        <div class="stat-item">
          <Icon icon="vi-ant-design:inbox-outlined" class="stat-icon" />
          <div>
            <div class="stat-value">{{ stats.totalPallets }}</div>
            <div class="stat-label">Pallets</div>
          </div>
        </div>
        <div class="stat-item highlight">
          <Icon icon="vi-ant-design:database-outlined" class="stat-icon" />
          <div>
            <div class="stat-value">{{ stats.totalItems }}</div>
            <div class="stat-label">Tổng hàng hóa</div>
          </div>
        </div>
      </div>

      <!-- Main Content -->
      <div class="main-content">
        <!-- Control Panel -->
        <ElCard class="control-panel" shadow="hover">
          <template #header>
            <span class="font-bold">Điều Khiển</span>
          </template>

          <div class="control-section">
            <h4>Chế độ xem</h4>
            <ElRadioGroup v-model="viewMode" size="small" @change="changeViewMode">
              <ElRadioButton value="zones">Khu vực</ElRadioButton>
              <ElRadioButton value="items">Hàng hóa</ElRadioButton>
              <ElRadioButton value="pallets">Pallet</ElRadioButton>
              <ElRadioButton value="racks">Kệ</ElRadioButton>
            </ElRadioGroup>
            <ElButton size="small" style="width: 100%; margin-top: 10px" @click="resetViewMode">
              <Icon icon="vi-ep:refresh-left" />
              Reset chế độ xem
            </ElButton>
          </div>

          <ElDivider />

          <div class="control-section">
            <h4>Lọc khách hàng</h4>
            <ElSelect
              v-model="filterByCustomer"
              placeholder="Tất cả"
              size="small"
              clearable
              @change="applyFilter"
            >
              <ElOption
                v-for="customer in customers"
                :key="customer.id"
                :label="customer.name"
                :value="customer.id"
              />
            </ElSelect>
          </div>

          <div class="control-section">
            <h4>Lọc theo khu vực (zone)</h4>
            <ElSelect
              v-model="filterByZone"
              placeholder="Tất cả khu vực"
              size="small"
              clearable
              @change="applyFilter"
            >
              <ElOption
                v-for="zone in zonesForFilter"
                :key="zone.id"
                :label="zone.name"
                :value="zone.id"
              />
            </ElSelect>
          </div>

          <ElDivider />

          <div class="control-section">
            <h4>Hiển thị</h4>
            <ElCheckbox v-model="showGrid" @change="toggleGrid">Lưới nền</ElCheckbox>
            <ElCheckbox v-model="showLabels" @change="renderWarehouse">Nhãn</ElCheckbox>
          </div>

          <ElDivider />

          <div class="control-section">
            <ElButton size="small" style="width: 100%" @click="resetCamera">
              <Icon icon="vi-ep:view" />
              Reset Camera
            </ElButton>
            <ElButton
              size="small"
              style="width: 100%; margin-top: 10px"
              type="primary"
              @click="loadWarehouse3DData"
              :loading="loading"
            >
              <Icon icon="vi-ep:refresh" />
              Làm mới
            </ElButton>
          </div>

          <ElDivider />

          <!-- Legend -->
          <div class="control-section">
            <h4>Chú thích màu sắc</h4>
            <div class="legend">
              <div class="legend-item">
                <div class="color-box" style="background: #e67e22"></div>
                <span>Pallet có hàng</span>
              </div>
              <div class="legend-item">
                <div class="color-box" style="background: #bdc3c7"></div>
                <span>Pallet trống</span>
              </div>
              <div class="legend-item">
                <div class="color-box" style="background: #e74c3c"></div>
                <span>Hàng dễ vỡ / Cổng ra (marker đỏ)</span>
              </div>
              <div class="legend-item">
                <div class="color-box" style="background: #8e44ad"></div>
                <span>Hàng nặng</span>
              </div>
              <div class="legend-item">
                <div class="color-box" style="background: #f39c12"></div>
                <span>Ưu tiên cao</span>
              </div>
              <div class="legend-item">
                <div class="color-box" style="background: #27ae60"></div>
                <span>Hàng bao / Vị trí checkin kho (marker xanh lá)</span>
              </div>
            </div>
          </div>
        </ElCard>

        <!-- 3D Canvas -->
        <div class="canvas-wrapper">
          <div v-loading="loading" ref="container" class="canvas-container"></div>

          <!-- Help Text -->
          <div class="help-text">
            <p>💡 <strong>Hướng dẫn:</strong></p>
            <p>• Click chuột trái để chọn đối tượng</p>
            <p>• Giữ chuột trái + kéo để xoay camera</p>
            <p>• Cuộn chuột để zoom in/out</p>
            <p>• Giữ chuột phải + kéo để di chuyển</p>
          </div>
        </div>
      </div>
    </div>
  </ContentWrap>
</template>

<style scoped lang="less">
.warehouse-3d-viewer {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 200px);
  min-height: 600px;
}

.stats-bar {
  display: flex;
  padding: 15px;
  margin-bottom: 15px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgb(0 0 0 / 10%);
  gap: 15px;

  .stat-item {
    display: flex;
    padding: 15px;
    color: white;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border-radius: 8px;
    flex: 1;
    align-items: center;
    gap: 12px;

    &.highlight {
      background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
    }

    .stat-icon {
      font-size: 32px;
      opacity: 0.9;
    }

    .stat-value {
      margin-bottom: 5px;
      font-size: 24px;
      font-weight: bold;
      line-height: 1;
    }

    .stat-label {
      font-size: 12px;
      opacity: 0.85;
    }
  }
}

.main-content {
  flex: 1;
  display: flex;
  gap: 15px;
  overflow: hidden;
}

.control-panel {
  width: 280px;
  flex-shrink: 0;
  overflow-y: auto;

  .control-section {
    margin-bottom: 12px;

    h4 {
      margin: 0 0 10px;
      font-size: 13px;
      font-weight: 600;
      color: #606266;
    }

    .el-radio-group {
      display: flex;
      flex-direction: column;
      gap: 8px;

      .el-radio-button {
        width: 100%;
      }
    }

    .el-checkbox {
      display: block;
      margin: 8px 0;
    }
  }

  .legend {
    .legend-item {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 8px 0;
      font-size: 13px;

      .color-box {
        width: 24px;
        height: 24px;
        border: 1px solid #dcdfe6;
        border-radius: 4px;
        flex-shrink: 0;
      }
    }
  }
}

.canvas-wrapper {
  position: relative;
  overflow: hidden;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 12px rgb(0 0 0 / 10%);
  flex: 1;
}

.canvas-container {
  width: 100%;
  height: 100%;
  cursor: pointer;
}

.info-overlay {
  position: absolute;
  top: 20px;
  right: 20px;
  z-index: 10;
  width: 320px;

  .info-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .info-content {
    p {
      margin: 6px 0;
      font-size: 14px;
      line-height: 1.6;
    }
  }
}

.help-text {
  position: absolute;
  bottom: 20px;
  left: 20px;
  max-width: 300px;
  padding: 15px 20px;
  font-size: 13px;
  background: rgb(255 255 255 / 95%);
  border-radius: 8px;
  box-shadow: 0 2px 12px rgb(0 0 0 / 15%);

  p {
    margin: 5px 0;
    color: #606266;

    &:first-child {
      font-size: 14px;
      color: #409eff;
    }
  }
}

.font-bold {
  font-weight: bold;
}
</style>
