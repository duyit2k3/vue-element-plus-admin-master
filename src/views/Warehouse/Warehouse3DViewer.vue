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
  ElMessageBox,
  ElDialog
} from 'element-plus'
import { Icon } from '@/components/Icon'
import { Qrcode } from '@/components/Qrcode'
import { useRouter, useRoute } from 'vue-router'
import warehouseApi, { type Warehouse3DData } from '@/api/warehouse'
import inboundApi, {
  type InboundOptimizeLayoutView,
  type PreferredPalletLayout,
  type InboundApprovalView,
  type InboundApprovalItem,
  type ManualStackUnitRequest
} from '@/api/inbound'
import { useUserStore } from '@/store/modules/user'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'

const { push } = useRouter()
const route = useRoute()
const loading = ref(true)
const warehouseData = ref<Warehouse3DData | null>(null)
const container = ref<HTMLDivElement>()
const userStore = useUserStore()

// Inbound approval (preview) mode
const inboundMode = computed(() => route.query.mode === 'inbound-approval')
const inboundReceiptId = computed(() => {
  const raw = route.query.receiptId
  if (!raw) return undefined
  const n = Array.isArray(raw) ? Number(raw[0]) : Number(raw)
  if (!Number.isFinite(n) || n <= 0) return undefined
  return n
})
const inboundPreviewResult = ref<InboundOptimizeLayoutView | null>(null)

// Pallet inbound đang chờ duyệt (preview, chưa commit DB)
interface InboundPendingPallet {
  palletId: number
  zoneId: number
  shelfId?: number | null
  positionX: number
  positionY: number
  positionZ: number
  isGround: boolean
}

const inboundPendingPallets = ref<InboundPendingPallet[]>([])

// Thông tin chi tiết phiếu inbound & layout chi tiết (manual) để overlay hàng trên pallet inbound
const inboundApprovalView = ref<InboundApprovalView | null>(null)
const inboundManualLayouts = ref<Record<number, ManualStackUnitRequest[]> | null>(null)

const warehouseId = computed(() => Number(route.params.id))
const userRole = computed(() => userStore.getUserInfo?.role?.toLowerCase() || '')
const canCreateInbound = computed(() => userRole.value === 'customer')
const canViewInbound = computed(() =>
  ['customer', 'warehouse_owner', 'admin'].includes(userRole.value)
)

const goToCreateInbound = () => {
  const query: Record<string, string> = {
    warehouseId: String(warehouseId.value)
  }

  const zoneId = getCurrentZoneIdForInbound()
  if (zoneId) {
    query.zoneId = String(zoneId)
  }

  push({
    path: '/warehouse/inbound-request/create',
    query
  })
}

// Helper tìm thông tin kệ/tầng theo shelfId để clamp pallet trên kệ
const findShelfById = (shelfId: number) => {
  if (!warehouseData.value?.racks) return null
  for (const rack of warehouseData.value.racks) {
    const shelves = (rack.shelves || []) as any[]
    const shelf = shelves.find((s: any) => s.shelfId === shelfId)
    if (shelf) return { rack, shelf }
  }
  return null
}

// Helper dựng pallet ảo cho inbound pending khi pallet chưa tồn tại trong warehouseData.pallets
const buildVirtualInboundPallet = (pending: InboundPendingPallet) => {
  if (!inboundApprovalView.value) return null
  const items = inboundApprovalView.value.items.filter((it) => it.palletId === pending.palletId)
  if (!items.length) return null

  const anyItem = items[0]

  return {
    palletId: pending.palletId,
    zoneId: pending.zoneId,
    shelfId: pending.shelfId ?? null,
    positionX: pending.positionX,
    positionY: pending.positionY,
    positionZ: pending.positionZ,
    palletLength: anyItem.palletLength,
    palletWidth: anyItem.palletWidth,
    palletHeight: anyItem.palletHeight,
    palletQrContent: null
  }
}

const getPalletSizeForPalletId = (palletId: number) => {
  if (!warehouseData.value) return null

  let palletLength: number | undefined
  let palletWidth: number | undefined

  const pallet = warehouseData.value.pallets?.find((p) => p.palletId === palletId)
  if (pallet) {
    palletLength = pallet.palletLength
    palletWidth = pallet.palletWidth
  } else if (inboundApprovalView.value) {
    const anyItem = inboundApprovalView.value.items.find((it) => it.palletId === palletId)
    if (anyItem) {
      palletLength = anyItem.palletLength
      palletWidth = anyItem.palletWidth
    }
  }

  const length = Number(palletLength || 0)
  const width = Number(palletWidth || 0)
  if (!Number.isFinite(length) || length <= 0 || !Number.isFinite(width) || width <= 0) {
    return null
  }

  return { length, width }
}

const rectsOverlap = (
  aMinX: number,
  aMaxX: number,
  aMinZ: number,
  aMaxZ: number,
  bMinX: number,
  bMaxX: number,
  bMinZ: number,
  bMaxZ: number
) => {
  return aMinX < bMaxX && aMaxX > bMinX && aMinZ < bMaxZ && aMaxZ > bMinZ
}

const hasGroundCollision = (
  palletId: number,
  zoneId: number,
  baseX: number,
  baseZ: number,
  length: number,
  width: number
) => {
  if (!warehouseData.value) return false

  const minX = baseX
  const maxX = baseX + length
  const minZ = baseZ
  const maxZ = baseZ + width

  let collided = false

  // Va chạm với khung kệ (rack)
  warehouseData.value.racks?.forEach((rack) => {
    if (rack.zoneId !== zoneId) return
    const rMinX = rack.positionX
    const rMaxX = rack.positionX + rack.length
    const rMinZ = rack.positionZ
    const rMaxZ = rack.positionZ + rack.width
    if (rectsOverlap(minX, maxX, minZ, maxZ, rMinX, rMaxX, rMinZ, rMaxZ)) {
      collided = true
    }
  })

  if (collided) return true

  // Va chạm với pallet đã tồn tại trên mặt đất (từ DB)
  warehouseData.value.pallets?.forEach((p) => {
    if (p.palletId === palletId) return
    if (p.zoneId !== zoneId) return
    const isGroundP =
      p.isGround === true ||
      (p.shelfId == null && (p.positionY == null || Number(p.positionY) <= 0.001))
    if (!isGroundP) return
    const size = getPalletSizeForPalletId(p.palletId)
    if (!size) return
    const pMinX = p.positionX
    const pMaxX = p.positionX + size.length
    const pMinZ = p.positionZ
    const pMaxZ = p.positionZ + size.width
    if (rectsOverlap(minX, maxX, minZ, maxZ, pMinX, pMaxX, pMinZ, pMaxZ)) {
      collided = true
    }
  })

  if (collided) return true

  // Va chạm với các pallet inbound khác đang ở mặt đất (preview)
  inboundPendingPallets.value.forEach((p) => {
    if (p.palletId === palletId) return
    if (p.zoneId !== zoneId) return
    if (p.shelfId != null) return
    const size = getPalletSizeForPalletId(p.palletId)
    if (!size) return
    const pMinX = p.positionX
    const pMaxX = p.positionX + size.length
    const pMinZ = p.positionZ
    const pMaxZ = p.positionZ + size.width
    if (rectsOverlap(minX, maxX, minZ, maxZ, pMinX, pMaxX, pMinZ, pMaxZ)) {
      collided = true
    }
  })

  return collided
}

const getStackHeightsForPalletId = (palletId: number) => {
  if (!inboundApprovalView.value) return null
  const item = inboundApprovalView.value.items.find((it) => it.palletId === palletId)
  if (!item) return null
  const palletHeight = Number(item.palletHeight || 0)
  const goodsHeight = Number(item.itemHeight || 0)
  if (!Number.isFinite(palletHeight) || palletHeight <= 0) return null
  if (!Number.isFinite(goodsHeight) || goodsHeight <= 0) return null
  return { palletHeight, goodsHeight }
}

const isBagPallet = (palletId: number) => {
  if (!inboundApprovalView.value) return false
  const item = inboundApprovalView.value.items.find((it) => it.palletId === palletId)
  return item?.isBag === true
}

const getShelfClearHeightFrontend = (rack: any, shelf: any) => {
  const shelves = ((rack.shelves || []) as any[]).slice().sort((a, b) => {
    const aLevel = Number(a.shelfLevel ?? 0)
    const bLevel = Number(b.shelfLevel ?? 0)
    return aLevel - bLevel
  })
  const index = shelves.findIndex((s) => s.shelfId === shelf.shelfId)
  if (index < 0) return Number(rack.height || 0) || 0
  if (index < shelves.length - 1) {
    const nextShelf = shelves[index + 1]
    return Number(nextShelf.positionY || 0) - Number(shelf.positionY || 0)
  }
  return Number(rack.height || 0) - Number(shelf.positionY || 0)
}

const hasShelfCollision = (
  palletId: number,
  zoneId: number,
  shelfId: number,
  baseX: number,
  baseZ: number,
  length: number,
  width: number
) => {
  if (!warehouseData.value) return false

  const minX = baseX
  const maxX = baseX + length
  const minZ = baseZ
  const maxZ = baseZ + width

  let collided = false

  // Va chạm với pallet đã tồn tại trên cùng tầng kệ (từ DB)
  warehouseData.value.pallets?.forEach((p) => {
    if (p.palletId === palletId) return
    if (p.zoneId !== zoneId) return
    if (p.shelfId !== shelfId) return
    const size = getPalletSizeForPalletId(p.palletId)
    if (!size) return
    const pMinX = p.positionX
    const pMaxX = p.positionX + size.length
    const pMinZ = p.positionZ
    const pMaxZ = p.positionZ + size.width
    if (rectsOverlap(minX, maxX, minZ, maxZ, pMinX, pMaxX, pMinZ, pMaxZ)) {
      collided = true
    }
  })

  if (collided) return true

  // Va chạm với các pallet inbound khác trên cùng tầng kệ (preview)
  inboundPendingPallets.value.forEach((p) => {
    if (p.palletId === palletId) return
    if (p.zoneId !== zoneId) return
    if (p.shelfId !== shelfId) return
    const size = getPalletSizeForPalletId(p.palletId)
    if (!size) return
    const pMinX = p.positionX
    const pMaxX = p.positionX + size.length
    const pMinZ = p.positionZ
    const pMaxZ = p.positionZ + size.width
    if (rectsOverlap(minX, maxX, minZ, maxZ, pMinX, pMaxX, pMinZ, pMaxZ)) {
      collided = true
    }
  })

  return collided
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

// Drag & drop pallet inbound (3D)
let draggingPallet: THREE.Object3D | null = null
let draggingPalletData: any | null = null
let dragPlane: THREE.Plane | null = null
const dragOffset = new THREE.Vector3()
let isDragging = false
const palletGridStep = 0.1

// UI State
const viewMode = ref<'zones' | 'items' | 'pallets' | 'racks' | ''>('')
const showGrid = ref(true)
const showLabels = ref(false)
const selectedObject = ref<any>(null)
const filterByCustomer = ref<number | undefined>(undefined)
const filterByZone = ref<number | undefined>(undefined)

const palletDetailVisible = ref(false)
const palletDetail = ref<any | null>(null)
const palletDetailItems = ref<any[]>([])
const showPalletQr = ref(false)
const palletQrText = ref('')

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

// Helper đọc zoneId từ query ban đầu của route
const getZoneIdFromQuery = (): number | undefined => {
  const raw = route.query.zoneId
  if (!raw) return undefined
  const n = Array.isArray(raw) ? Number(raw[0]) : Number(raw)
  if (!Number.isFinite(n) || n <= 0) return undefined
  return n
}

const lockedZoneIdFromQuery = computed(() => getZoneIdFromQuery())
const isZoneLockedFromQuery = computed(() => !!lockedZoneIdFromQuery.value)

// Zone list for filter
const zonesForFilter = computed(() => {
  if (!warehouseData.value?.zones) return []
  const zones = warehouseData.value.zones
  const lockedId = lockedZoneIdFromQuery.value
  const visibleZones = lockedId ? zones.filter((z) => z.zoneId === lockedId) : zones
  return visibleZones.map((z) => ({
    id: z.zoneId,
    name: z.zoneName || `Zone #${z.zoneId}`
  }))
})

// Helper lấy zoneId cho màn tạo yêu cầu nhập kho
// Ưu tiên zone đang được filter trong 3D, nếu không có thì dùng zoneId từ query ban đầu.
function getCurrentZoneIdForInbound(): number | undefined {
  const v = filterByZone.value
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
    return v
  }
  return getZoneIdFromQuery()
}

// Load warehouse 3D data
const loadWarehouse3DData = async () => {
  loading.value = true
  try {
    const res = await warehouseApi.getWarehouse3DData(warehouseId.value)
    if (res.statusCode === 200 || res.code === 0) {
      warehouseData.value = res.data

      const initialZoneId = getZoneIdFromQuery()
      if (initialZoneId) {
        filterByZone.value = initialZoneId
      }

      // Nếu đang ở chế độ inbound-approval thì load preview inbound layout
      if (inboundMode.value && inboundReceiptId.value) {
        try {
          const previewRes = await inboundApi.previewApproveInboundLayout(inboundReceiptId.value, {
            forceUsePreferredLayout: true
          })
          if (previewRes.statusCode === 200 || previewRes.code === 0) {
            inboundPreviewResult.value = previewRes.data
            const layouts = previewRes.data?.layouts || []
            inboundPendingPallets.value = layouts.map((l) => ({
              palletId: l.palletId,
              zoneId: l.zoneId,
              shelfId: l.shelfId ?? null,
              positionX: l.positionX,
              positionY: l.positionY,
              positionZ: l.positionZ,
              isGround: l.isGround
            }))

            // Nếu chưa có filterByZone thì set theo zone của layout đầu tiên
            if (!filterByZone.value && layouts.length) {
              filterByZone.value = layouts[0].zoneId
            }

            // Lấy lại layout chi tiết manual (nếu có) từ sessionStorage để overlay hàng inbound theo stackUnits
            if (typeof window !== 'undefined') {
              const key = `inboundManualLayouts:${inboundReceiptId.value}`
              const raw = window.sessionStorage.getItem(key)
              if (raw) {
                try {
                  inboundManualLayouts.value = JSON.parse(raw)
                } catch {
                  inboundManualLayouts.value = null
                }
              }
            }

            // Lấy metadata hàng hóa inbound để dựng box trên pallet inbound
            try {
              const approvalRes = await inboundApi.getInboundApprovalView(inboundReceiptId.value)
              if (approvalRes.statusCode === 200 || approvalRes.code === 0) {
                inboundApprovalView.value = approvalRes.data
              }
            } catch {
              // Bỏ qua lỗi, chỉ mất overlay chi tiết hàng inbound
            }
          } else {
            ElMessage.error(previewRes.message || 'Không thể tải layout inbound để xem 3D')
          }
        } catch (e) {
          ElMessage.error('Lỗi khi tải layout inbound để xem 3D')
        }
      }

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
  renderer.domElement.addEventListener('pointerdown', onPointerDown)
  renderer.domElement.addEventListener('pointermove', onPointerMove)
  renderer.domElement.addEventListener('pointerup', onPointerUp)
  renderer.domElement.addEventListener('pointerleave', onPointerUp)

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
    // Ở chế độ inbound-approval, nếu pallet này đang nằm trong danh sách inboundPendingPallets
    // thì không render version trong DB nữa, chỉ render version preview inbound bên dưới
    if (
      inboundMode.value &&
      inboundPendingPallets.value.some((ip) => ip.palletId === pallet.palletId)
    ) {
      return
    }

    const zone = warehouseData.value!.zones?.find((z) => z.zoneId === pallet.zoneId)
    if (!zone) return
    if (filterByZone.value && zone.zoneId !== filterByZone.value) return
    if (filterByCustomer.value && zone.customerId !== filterByCustomer.value) return
    renderPallet(pallet, false)
  })

  // Render inbound pending pallets (preview, chưa commit DB)
  if (inboundMode.value && inboundPendingPallets.value.length && warehouseData.value) {
    inboundPendingPallets.value.forEach((p) => {
      const zone = warehouseData.value!.zones?.find((z) => z.zoneId === p.zoneId)
      if (!zone) return
      if (filterByZone.value && zone.zoneId !== filterByZone.value) return
      if (filterByCustomer.value && zone.customerId !== filterByCustomer.value) return

      const basePallet = warehouseData.value!.pallets?.find((bp) => bp.palletId === p.palletId)
      const sourcePallet = basePallet || buildVirtualInboundPallet(p)
      if (!sourcePallet) return

      const virtualPallet = {
        ...sourcePallet,
        zoneId: p.zoneId,
        shelfId: p.shelfId ?? null,
        positionX: p.positionX,
        positionY: p.positionY,
        positionZ: p.positionZ
      }

      renderPallet(virtualPallet, true)

      // Overlay hàng inbound trên pallet inbound (sử dụng metadata từ approval-view + layout chi tiết từ DB nếu có)
      if (inboundApprovalView.value) {
        const itemsForPallet: InboundApprovalItem[] = inboundApprovalView.value.items.filter(
          (it) => it.palletId === p.palletId
        )

        itemsForPallet.forEach((it) => {
          const virtualItem: any = {
            itemId: it.itemId,
            itemName: it.productName,
            productCode: it.productCode,
            itemType: it.isBag ? 'bag' : 'box',
            shape: it.isBag ? 'bag' : 'box',
            palletId: it.palletId,
            length: it.itemLength,
            width: it.itemWidth,
            height: it.itemHeight,
            unitQuantity: it.quantity
          }

          // Ưu tiên dùng layout chi tiết từ BE (StackUnits trong InboundApprovalView)
          if (Array.isArray(it.stackUnits) && it.stackUnits.length > 0) {
            virtualItem.stackUnits = it.stackUnits
          } else {
            // Fallback: dùng layout đã lưu tạm ở sessionStorage (inboundManualLayouts)
            const layoutMap = inboundManualLayouts.value
            if (layoutMap && layoutMap[it.inboundItemId]) {
              virtualItem.stackUnits = layoutMap[it.inboundItemId]
            }
          }

          renderItem(virtualItem, virtualPallet, true)
        })
      }
    })
  }

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

const renderPallet = (pallet: any, pendingInbound = false) => {
  const geometry = new THREE.BoxGeometry(
    pallet.palletLength,
    pallet.palletHeight,
    pallet.palletWidth
  )

  // Check if pallet has items
  const hasItems = warehouseData.value!.items?.some((i) => i.palletId === pallet.palletId)
  let color = hasItems ? 0xe67e22 : 0xbdc3c7
  if (pendingInbound) {
    color = 0x2ecc71
  }

  const material = new THREE.MeshPhongMaterial({ color: color })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(
    pallet.positionX + pallet.palletLength / 2,
    pallet.positionY + pallet.palletHeight / 2,
    pallet.positionZ + pallet.palletWidth / 2
  )
  mesh.userData = { type: 'pallet', data: pallet, pendingInbound }
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
const renderItem = (item: any, pallet: any, pendingInbound = false) => {
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
    renderItemFromStackUnits(item, pallet, color, pendingInbound)
    return
  }

  if (isBox || isBag) {
    renderBoxItemAsCartons(item, pallet, color, pendingInbound)
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
  mesh.userData = { type: 'item', data: item, pendingInbound }
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
const renderItemFromStackUnits = (
  item: any,
  pallet: any,
  color: number,
  pendingInbound = false
) => {
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
    mesh.userData = { type: 'item', data: item, pendingInbound }
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

const renderBoxItemAsCartons = (item: any, pallet: any, color: number, _pendingInbound = false) => {
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

  // Hiệu ứng nhấp nháy rõ hơn cho pallet/hàng inbound đang chờ duyệt
  const time = performance.now() * 0.004
  const wave = 0.5 + 0.5 * Math.sin(time * 2.0)
  const blink = 0.4 + 0.6 * wave

  scene.traverse((obj) => {
    const ud: any = (obj as any).userData
    if (!ud || !ud.pendingInbound) return

    const mat = (obj as any).material as THREE.Material | THREE.Material[] | undefined
    if (!mat) return

    if (Array.isArray(mat)) {
      mat.forEach((m) => {
        if ((m as any).color) {
          const mm = m as any
          if (!mm.userData) mm.userData = {}
          if (mm.userData.__baseColor == null) {
            mm.userData.__baseColor = mm.color.clone()
          }
          const baseColor: THREE.Color = mm.userData.__baseColor
          mm.color.copy(baseColor).offsetHSL(0, 0, (blink - 1) * 0.35)
        }
        if ((m as any).transparent) {
          ;(m as any).opacity = blink
        }
      })
    } else {
      const m: any = mat
      if (m.color) {
        if (!m.userData) m.userData = {}
        if (m.userData.__baseColor == null) {
          m.userData.__baseColor = m.color.clone()
        }
        const baseColor: THREE.Color = m.userData.__baseColor
        m.color.copy(baseColor).offsetHSL(0, 0, (blink - 1) * 0.35)
      }
      if (m.transparent) {
        m.opacity = blink
      }
    }
  })

  controls.update()
  renderer.render(scene, camera)
}

// Drag & drop pallet inbound
const pickDraggablePallet = (event: PointerEvent): THREE.Object3D | null => {
  if (!container.value || !inboundMode.value) return null

  const rect = container.value.getBoundingClientRect()
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

  raycaster.setFromCamera(mouse, camera)
  const intersects = raycaster.intersectObjects(scene.children, true)
  if (!intersects.length) return null

  const hit = intersects.find(
    (i) => i.object.userData?.type === 'pallet' && i.object.userData?.pendingInbound
  )
  return hit ? hit.object : null
}

const onPointerDown = (event: PointerEvent) => {
  if (!inboundMode.value || !warehouseData.value) return

  const obj = pickDraggablePallet(event)
  if (!obj) return

  draggingPallet = obj
  draggingPalletData = obj.userData?.data
  isDragging = true

  const data = draggingPalletData

  // Xác định mặt phẳng kéo: nếu pallet đang ở trên tầng kệ thì kéo theo mặt phẳng tầng đó,
  // ngược lại kéo trên mặt đất (Y = 0).
  let planeY = 0
  if (data && data.shelfId != null) {
    const found = findShelfById(data.shelfId)
    if (found) {
      planeY = Number(found.shelf.positionY || 0)
    }
  }

  dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY)

  const rect = renderer.domElement.getBoundingClientRect()
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(mouse, camera)

  const planeIntersect = new THREE.Vector3()
  if (dragPlane && raycaster.ray.intersectPlane(dragPlane, planeIntersect)) {
    dragOffset.copy(planeIntersect).sub(draggingPallet.position)
  } else {
    dragOffset.set(0, 0, 0)
  }

  // Tạm thời vô hiệu hóa điều khiển camera khi drag
  if (controls) {
    controls.enableRotate = false
    controls.enablePan = false
  }
}

const onPointerMove = (event: PointerEvent) => {
  if (!isDragging || !draggingPallet || !dragPlane || !warehouseData.value) return

  const rect = renderer.domElement.getBoundingClientRect()
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(mouse, camera)

  const point = new THREE.Vector3()
  if (!raycaster.ray.intersectPlane(dragPlane, point)) return

  point.sub(dragOffset)

  const data = draggingPalletData
  if (!data) return

  // Clamp trong phạm vi zone hoặc rack/tầng tương ứng
  const zone = warehouseData.value.zones?.find((z) => z.zoneId === data.zoneId)
  if (!zone) return

  let areaMinX = zone.positionX
  let areaMaxX = zone.positionX + zone.length
  let areaMinZ = zone.positionZ
  let areaMaxZ = zone.positionZ + zone.width

  // Nếu pallet đang ở trên tầng kệ thì giới hạn trong phạm vi rack chứa tầng đó
  if (data.shelfId != null) {
    const foundShelf = findShelfById(data.shelfId)
    if (foundShelf) {
      const rack = foundShelf.rack
      areaMinX = rack.positionX
      areaMaxX = rack.positionX + rack.length
      areaMinZ = rack.positionZ
      areaMaxZ = rack.positionZ + rack.width
    }
  }

  let targetX = point.x
  let targetZ = point.z

  // Snap theo grid
  if (palletGridStep > 0) {
    targetX = Math.round(targetX / palletGridStep) * palletGridStep
    targetZ = Math.round(targetZ / palletGridStep) * palletGridStep
  }

  // Tâm pallet và nửa kích thước
  const halfL = data.palletLength / 2
  const halfW = data.palletWidth / 2

  const minX = areaMinX + halfL
  const maxX = areaMaxX - halfL
  const minZ = areaMinZ + halfW
  const maxZ = areaMaxZ - halfW

  const clampedX = THREE.MathUtils.clamp(targetX, minX, maxX)
  const clampedZ = THREE.MathUtils.clamp(targetZ, minZ, maxZ)
  let finalX = clampedX
  let finalZ = clampedZ

  // Ngăn không cho pallet inbound chèn vào kệ / pallet khác
  const palletId = Number(data.palletId)
  if (Number.isFinite(palletId)) {
    const baseX = finalX - halfL
    const baseZ = finalZ - halfW

    const collided =
      data.shelfId != null
        ? hasShelfCollision(
            palletId,
            data.zoneId,
            Number(data.shelfId),
            baseX,
            baseZ,
            data.palletLength,
            data.palletWidth
          )
        : hasGroundCollision(
            palletId,
            data.zoneId,
            baseX,
            baseZ,
            data.palletLength,
            data.palletWidth
          )

    if (collided) {
      return
    }
  }

  draggingPallet.position.set(finalX, draggingPallet.position.y, finalZ)
}

const onPointerUp = () => {
  if (!isDragging) return

  // Cập nhật lại inboundPendingPallets theo vị trí mới
  if (draggingPallet && draggingPalletData && inboundPendingPallets.value.length) {
    const centerX = draggingPallet.position.x
    const centerZ = draggingPallet.position.z

    const palletId = draggingPalletData.palletId as number

    inboundPendingPallets.value = inboundPendingPallets.value.map((p) => {
      if (p.palletId !== palletId) return p
      return {
        ...p,
        positionX: centerX - draggingPalletData.palletLength / 2,
        positionZ: centerZ - draggingPalletData.palletWidth / 2
      }
    })
  }

  draggingPallet = null
  draggingPalletData = null
  dragPlane = null
  isDragging = false

  if (controls) {
    controls.enableRotate = true
    controls.enablePan = true
  }

  // Re-render lại kho để pallet inbound và hàng hóa overlay được vẽ đúng theo vị trí mới
  renderWarehouse()
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
  const zoneId = Number(zone.zoneId)
  if (Number.isFinite(zoneId) && zoneId > 0) {
    filterByZone.value = zoneId
    applyFilter()
  }

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

  palletDetail.value = pallet
  palletDetailItems.value = items
  showPalletQr.value = false

  if (pallet.palletQrContent && typeof pallet.palletQrContent === 'string') {
    palletQrText.value = pallet.palletQrContent
  } else {
    const qrLines: string[] = []
    qrLines.push(`Vị trí: (${pallet.positionX}, ${pallet.positionY}, ${pallet.positionZ})`)
    qrLines.push(
      `Kích thước pallet: ${pallet.palletLength}m × ${pallet.palletWidth}m × ${pallet.palletHeight}m`
    )
    qrLines.push('------------------')
    qrLines.push('Danh sách hàng trên pallet:')

    items.forEach((i) => {
      const unitSize =
        i.standardLength && i.standardWidth && i.standardHeight
          ? `${i.standardLength}m × ${i.standardWidth}m × ${i.standardHeight}m`
          : 'N/A'
      const stackSize = `${i.length}m × ${i.width}m × ${i.height}m`
      const qty = i.unitQuantity ?? null
      const qtyText = qty != null ? (i.unit ? `${qty} ${i.unit}` : `${qty}`) : 'N/A'
      const mfg = i.manufacturingDate || 'N/A'
      const exp = i.expiryDate || 'N/A'

      let weightText = ''
      const hasStdWeight = typeof i.standardWeight === 'number' && !Number.isNaN(i.standardWeight)
      const hasQty = typeof qty === 'number' && !Number.isNaN(qty)

      if (hasStdWeight && hasQty) {
        const totalWeight = Number(i.standardWeight) * Number(qty)
        if (Number.isFinite(totalWeight)) {
          weightText = `Trọng lượng: ${totalWeight} kg / Chuẩn: ${i.standardWeight} kg`
        }
      } else if (i.weight || i.standardWeight) {
        const parts: string[] = []
        if (i.weight != null) parts.push(`${i.weight} kg`)
        if (i.standardWeight != null) parts.push(`Chuẩn: ${i.standardWeight} kg`)
        weightText = `Trọng lượng: ${parts.join(' / ')}`
      }

      qrLines.push(`${i.productName || i.itemName || i.qrCode || 'Hàng hóa'}`)
      if (i.productCode) {
        qrLines.push(`Mã SP: ${i.productCode}`)
      }
      if (i.customerName) {
        qrLines.push(`Khách hàng: ${i.customerName}`)
      }
      qrLines.push(`Kích thước thùng (1 đơn vị): ${unitSize}`)
      qrLines.push(`Kích thước khối hàng trên pallet: ${stackSize}`)
      qrLines.push(`Số lượng đơn vị trên pallet: ${qtyText}`)
      if (weightText) {
        qrLines.push(weightText)
      }
      qrLines.push(`Ngày sản xuất: ${mfg}`)
      qrLines.push(`Hạn sử dụng: ${exp}`)
      if (i.productDescription) {
        qrLines.push(`Mô tả sản phẩm: ${i.productDescription}`)
      }
      if (i.storageConditions) {
        qrLines.push(`Lưu ý bảo quản: ${i.storageConditions}`)
      }
      if (i.unitPrice || i.totalAmount) {
        const unitPriceText = i.unitPrice != null ? i.unitPrice.toLocaleString() : ''
        const totalAmountText = i.totalAmount != null ? i.totalAmount.toLocaleString() : ''
        if (unitPriceText && totalAmountText) {
          qrLines.push(`Giá: ${unitPriceText} / đơn vị – Thành tiền: ${totalAmountText}`)
        } else if (unitPriceText) {
          qrLines.push(`Giá: ${unitPriceText} / đơn vị`)
        } else if (totalAmountText) {
          qrLines.push(`Thành tiền: ${totalAmountText}`)
        }
      }
      if (i.isFragile) {
        qrLines.push('⚠ Dễ vỡ')
      }
      if (i.isHeavy) {
        qrLines.push('⚠ Hàng nặng')
      }
      qrLines.push('')
    })

    palletQrText.value = qrLines.join('\n')
  }

  palletDetailVisible.value = true
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
  showLabels.value = false
  const lockedId = lockedZoneIdFromQuery.value
  filterByZone.value = lockedId || undefined
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

const getSelectedInboundPendingPallet = () => {
  if (!inboundMode.value) return null

  // Ưu tiên pallet đang được chọn trong 3D (selectedObject)
  const sel = selectedObject.value
  if (sel && sel.palletId != null) {
    const palletId = Number(sel.palletId)
    if (Number.isFinite(palletId)) {
      const pending = inboundPendingPallets.value.find((p) => Number(p.palletId) === palletId)
      if (pending) return { pending, palletId }
    }
  }

  // Nếu chưa chọn gì nhưng chỉ có đúng 1 pallet inbound pending thì tự động dùng pallet đó
  if (inboundPendingPallets.value.length === 1) {
    const only = inboundPendingPallets.value[0]
    const palletId = Number(only.palletId)
    if (Number.isFinite(palletId)) {
      return { pending: only, palletId }
    }
  }

  return null
}

const moveSelectedInboundPalletToGround = () => {
  if (!inboundMode.value) return
  if (!warehouseData.value) return

  const info = getSelectedInboundPendingPallet()
  if (!info) {
    ElMessage.warning('Vui lòng chọn một pallet inbound đang chờ duyệt trong khu vực 3D')
    return
  }

  const idx = inboundPendingPallets.value.findIndex((p) => p.palletId === info.palletId)
  if (idx === -1) return

  const pending = inboundPendingPallets.value[idx]

  if (!isBagPallet(pending.palletId)) {
    ElMessage.warning('Hàng thùng không được phép đặt dưới đất. Vui lòng đưa pallet lên kệ.')
    return
  }

  // Tìm vị trí đất gần nhất trong cùng zone mà không bị vướng bởi kệ/pallet khác
  const size = getPalletSizeForPalletId(pending.palletId)
  if (!size) {
    ElMessage.warning('Không xác định được kích thước pallet để đưa xuống đất')
    return
  }

  const zone = warehouseData.value.zones?.find((z) => z.zoneId === pending.zoneId)
  if (!zone) {
    ElMessage.warning('Không tìm thấy khu vực (zone) của pallet inbound')
    return
  }

  const length = size.length
  const width = size.width
  const halfL = length / 2
  const halfW = width / 2

  const zoneMinX = zone.positionX
  const zoneMaxX = zone.positionX + zone.length
  const zoneMinZ = zone.positionZ
  const zoneMaxZ = zone.positionZ + zone.width

  const minBaseX = zoneMinX
  const maxBaseX = zoneMaxX - length
  const minBaseZ = zoneMinZ
  const maxBaseZ = zoneMaxZ - width

  if (maxBaseX < minBaseX || maxBaseZ < minBaseZ) {
    ElMessage.warning('Khu vực này không đủ diện tích để đặt pallet xuống đất')
    return
  }

  // Tâm pallet hiện tại (hoặc trên kệ) làm mốc để tìm vị trí đất gần nhất
  const currentCenterX = pending.positionX + halfL
  const currentCenterZ = pending.positionZ + halfW

  // Duyệt qua các "ô" mặt đất khả dụng trong zone, bước bằng kích thước pallet,
  // chọn ô gần nhất (theo khoảng cách từ tâm hiện tại) mà không va chạm với kệ/pallet khác.
  const stepX = length
  const stepZ = width

  let bestBaseX: number | null = null
  let bestBaseZ: number | null = null
  let bestDist2 = Number.POSITIVE_INFINITY

  for (let bx = minBaseX; bx <= maxBaseX + 1e-6; bx += stepX) {
    for (let bz = minBaseZ; bz <= maxBaseZ + 1e-6; bz += stepZ) {
      const centerX = bx + halfL
      const centerZ = bz + halfW
      const dx = centerX - currentCenterX
      const dz = centerZ - currentCenterZ
      const dist2 = dx * dx + dz * dz

      const collided = hasGroundCollision(pending.palletId, pending.zoneId, bx, bz, length, width)

      if (!collided && dist2 < bestDist2 - 1e-9) {
        bestDist2 = dist2
        bestBaseX = bx
        bestBaseZ = bz
      }
    }
  }

  if (bestBaseX == null || bestBaseZ == null) {
    ElMessage.warning('Không còn vị trí đất trống phù hợp trong khu vực này')
    return
  }

  const updated = {
    ...pending,
    positionX: bestBaseX,
    positionY: 0,
    positionZ: bestBaseZ,
    isGround: true,
    shelfId: null
  }

  inboundPendingPallets.value.splice(idx, 1, updated)

  if (selectedObject.value && selectedObject.value.palletId === info.palletId) {
    selectedObject.value = {
      ...selectedObject.value,
      positionY: updated.positionY,
      shelfId: updated.shelfId,
      isGround: updated.isGround
    }
  }

  renderWarehouse()
}

const moveSelectedInboundPalletToNearestShelf = () => {
  if (!inboundMode.value) return
  if (!warehouseData.value) return

  const info = getSelectedInboundPendingPallet()
  if (!info) {
    ElMessage.warning('Vui lòng chọn một pallet inbound đang chờ duyệt trong khu vực 3D')
    return
  }

  const idx = inboundPendingPallets.value.findIndex((p) => p.palletId === info.palletId)
  if (idx === -1) return

  const pending = inboundPendingPallets.value[idx]

  // Lấy kích thước pallet để kiểm tra phù hợp với chiều dài tầng kệ
  const size = getPalletSizeForPalletId(pending.palletId)
  if (!size) {
    ElMessage.warning('Không xác định được kích thước pallet để đưa lên tầng kệ')
    return
  }

  const length = size.length
  const width = size.width
  const halfL = length / 2
  const halfW = width / 2

  const stackHeights = getStackHeightsForPalletId(pending.palletId)
  const palletHeight = stackHeights ? stackHeights.palletHeight : 0
  const goodsHeight = stackHeights ? stackHeights.goodsHeight : 0

  const currentY = Number(pending.positionY || 0)

  const racksInZone = (warehouseData.value.racks || []).filter(
    (rack) => rack.zoneId === pending.zoneId
  )

  if (!racksInZone.length) {
    ElMessage.warning('Không tìm thấy kệ nào trong khu vực này')
    return
  }

  // Helper: kiểm tra chiều dài tầng/kệ có chứa được pallet không
  const canFitOnShelf = (rack: any, shelf: any) => {
    const usableLength = Number((shelf && (shelf as any).length) ?? rack.length ?? 0)
    if (!Number.isFinite(usableLength) || usableLength <= 0) return false
    if (length > usableLength) return false
    const clearHeight = getShelfClearHeightFrontend(rack, shelf)
    if ((palletHeight > 0 || goodsHeight > 0) && clearHeight > 0) {
      const totalHeight = palletHeight + goodsHeight
      if (totalHeight > clearHeight) return false
    }
    return true
  }

  // Tọa độ tâm pallet hiện tại (theo XZ) để đo khoảng cách đến các kệ
  const palletCenterX = pending.positionX + halfL
  const palletCenterZ = pending.positionZ + halfW

  const getRackDistance = (rack: any) => {
    const rackCenterX = Number(rack.positionX || 0) + Number(rack.length || 0) / 2
    const rackCenterZ = Number(rack.positionZ || 0) + Number(rack.width || 0) / 2
    const dx = rackCenterX - palletCenterX
    const dz = rackCenterZ - palletCenterZ
    return Math.sqrt(dx * dx + dz * dz)
  }

  type ShelfCandidate = {
    rack: any
    shelf: any
    shelfY: number
    deltaY: number
    distance: number
  }

  const higherCandidates: ShelfCandidate[] = []
  const fallbackCandidates: ShelfCandidate[] = []

  racksInZone.forEach((rack) => {
    const shelves = (rack.shelves || []) as any[]
    if (!shelves.length) return

    const dist = getRackDistance(rack)

    shelves.forEach((shelf) => {
      const shelfY = Number(shelf.positionY || 0)
      if (!Number.isFinite(shelfY)) return
      if (!canFitOnShelf(rack, shelf)) return

      // Nếu pallet đang ở sẵn trên một tầng kệ, không đưa chính tầng đó vào candidate
      if (pending.shelfId != null && shelf.shelfId === pending.shelfId) return

      const deltaY = shelfY - currentY

      if (deltaY > 0) {
        // Tầng cao hơn currentY
        higherCandidates.push({ rack, shelf, shelfY, deltaY, distance: dist })
      } else {
        // Fallback: tầng thấp hơn hoặc bằng currentY
        fallbackCandidates.push({ rack, shelf, shelfY, deltaY: Math.abs(deltaY), distance: dist })
      }
    })
  })

  // Ưu tiên các tầng cao hơn currentY, sau đó tới các tầng thấp hơn/bằng
  const sortByHeightAndDistance = (a: ShelfCandidate, b: ShelfCandidate) => {
    const dy = a.deltaY - b.deltaY
    if (Math.abs(dy) > 1e-6) return dy
    return a.distance - b.distance
  }

  higherCandidates.sort(sortByHeightAndDistance)
  fallbackCandidates.sort(sortByHeightAndDistance)

  const candidates: ShelfCandidate[] = higherCandidates.length
    ? higherCandidates
    : fallbackCandidates

  if (!candidates.length) {
    ElMessage.warning('Không còn tầng kệ nào phù hợp (theo chiều dài) trong khu vực này')
    return
  }

  // Tìm vị trí trống trên từng tầng ứng viên (theo thứ tự ưu tiên), bắt đầu từ vị trí gần hiện tại nhất
  const findFreeSlotOnShelf = (cand: ShelfCandidate) => {
    const rack = cand.rack
    const shelf = cand.shelf

    const rackMinX = Number(rack.positionX || 0)
    const rackMaxX = rackMinX + Number(rack.length || 0)
    const rackMinZ = Number(rack.positionZ || 0)
    const rackMaxZ = rackMinZ + Number(rack.width || 0)

    if (!(rackMaxX > rackMinX && rackMaxZ > rackMinZ)) {
      return null
    }

    // Tâm pallet mong muốn trong rack, clamp để không vượt ra ngoài rack
    let centerX = palletCenterX
    let centerZ = palletCenterZ
    centerX = THREE.MathUtils.clamp(centerX, rackMinX + halfL, rackMaxX - halfL)
    centerZ = THREE.MathUtils.clamp(centerZ, rackMinZ + halfW, rackMaxZ - halfW)

    const shelfY = Number(shelf.positionY || 0)

    const scanStep = length > 0 ? length : palletGridStep || 0.1
    const minBaseX = rackMinX
    const maxBaseX = rackMaxX - length
    if (maxBaseX < minBaseX) {
      return null
    }

    const startBaseX = THREE.MathUtils.clamp(centerX - halfL, minBaseX, maxBaseX)
    const baseZ = centerZ - halfW

    const candidateBaseXs: number[] = []
    candidateBaseXs.push(startBaseX)

    // Quét sang trái/phải theo bước bằng chiều dài pallet để tìm ô trống
    for (let i = 1; i < 50; i++) {
      let added = false
      const left = startBaseX - i * scanStep
      if (left >= minBaseX - 1e-6) {
        candidateBaseXs.push(left)
        added = true
      }
      const right = startBaseX + i * scanStep
      if (right <= maxBaseX + 1e-6) {
        candidateBaseXs.push(right)
        added = true
      }
      if (!added) break
    }

    for (const baseX of candidateBaseXs) {
      const collided = hasShelfCollision(
        pending.palletId,
        pending.zoneId,
        shelf.shelfId,
        baseX,
        baseZ,
        length,
        width
      )
      if (!collided) {
        return { baseX, baseZ, shelfY, shelf }
      }
    }

    return null
  }

  let chosen: {
    baseX: number
    baseZ: number
    shelfY: number
    shelf: any
  } | null = null

  for (const cand of candidates) {
    const pos = findFreeSlotOnShelf(cand)
    if (pos) {
      chosen = pos
      break
    }
  }

  if (!chosen) {
    ElMessage.warning('Không còn vị trí trống phù hợp trên các tầng kệ trong khu vực này')
    return
  }

  const updated = {
    ...pending,
    positionX: chosen.baseX,
    positionY: chosen.shelfY,
    positionZ: chosen.baseZ,
    isGround: false,
    shelfId: chosen.shelf.shelfId
  }

  inboundPendingPallets.value.splice(idx, 1, updated)

  if (selectedObject.value && selectedObject.value.palletId === info.palletId) {
    selectedObject.value = {
      ...selectedObject.value,
      positionX: updated.positionX,
      positionY: updated.positionY,
      positionZ: updated.positionZ,
      shelfId: updated.shelfId,
      isGround: updated.isGround
    }
  }

  renderWarehouse()
}

const handleApproveInboundFrom3D = async () => {
  if (!inboundMode.value || !inboundReceiptId.value) return

  if (!inboundPendingPallets.value.length) {
    ElMessage.error('Không có pallet inbound nào để duyệt')
    return
  }

  const layouts: PreferredPalletLayout[] = inboundPendingPallets.value.map((p) => ({
    palletId: p.palletId,
    zoneId: p.zoneId,
    shelfId: p.shelfId ?? undefined,
    positionX: p.positionX,
    positionZ: p.positionZ
  }))

  const payload = {
    preferredLayouts: layouts,
    forceUsePreferredLayout: true
  }

  try {
    const res = await inboundApi.approveInboundRequest(inboundReceiptId.value, payload)
    if (res.statusCode === 200 || res.code === 0) {
      ElMessage.success('Duyệt yêu cầu nhập kho thành công')
      inboundPendingPallets.value = []
      push({ path: `/warehouse/${warehouseId.value}/3d-view` })
    } else {
      ElMessage.error(res.message || 'Không thể duyệt yêu cầu nhập kho từ 3D')
    }
  } catch (e) {
    ElMessage.error('Lỗi khi duyệt yêu cầu nhập kho từ 3D')
  }
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
      <ElButton type="success" v-if="inboundMode" @click="handleApproveInboundFrom3D">
        <Icon icon="vi-ant-design:check-circle-outlined" />
        Duyệt inbound tại zone
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
              :clearable="!isZoneLockedFromQuery"
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

          <ElDivider v-if="inboundMode" />

          <div v-if="inboundMode" class="control-section">
            <h4>Điều chỉnh pallet inbound</h4>
            <ElButton
              size="small"
              style="width: 100%; margin-bottom: 8px"
              type="primary"
              @click="moveSelectedInboundPalletToGround"
            >
              <Icon icon="vi-ant-design:arrow-down-outlined" />
              Đưa pallet xuống đất
            </ElButton>
            <ElButton
              size="small"
              style="width: 100%"
              type="primary"
              plain
              @click="moveSelectedInboundPalletToNearestShelf"
            >
              <Icon icon="vi-ant-design:arrow-up-outlined" />
              Đưa pallet lên tầng gần nhất
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

    <ElDialog
      v-model="palletDetailVisible"
      :title="
        palletDetail ? `📦 Chi tiết Pallet - ${palletDetail.barcode || ''}` : 'Chi tiết Pallet'
      "
      width="720px"
    >
      <div v-if="palletDetail" class="pallet-detail-dialog">
        <div class="pallet-detail-layout">
          <div class="pallet-detail-left">
            <div class="pallet-header">
              <div>
                <p><strong>Barcode:</strong> {{ palletDetail.barcode }}</p>
                <p> <strong>Mã vị trí:</strong> {{ palletDetail.locationCode || 'N/A' }} </p>
                <p>
                  <strong>Vị trí:</strong>
                  ({{ palletDetail.positionX }}, {{ palletDetail.positionY }},
                  {{ palletDetail.positionZ }})
                </p>
                <p>
                  <strong>Kích thước pallet:</strong>
                  {{ palletDetail.palletLength }}m × {{ palletDetail.palletWidth }}m ×
                  {{ palletDetail.palletHeight }}m
                </p>
              </div>
              <ElButton
                size="small"
                type="primary"
                plain
                class="qr-toggle-btn"
                @click="showPalletQr = !showPalletQr"
              >
                <Icon
                  :icon="showPalletQr ? 'vi-tdesign:chevron-left-s' : 'vi-tdesign:chevron-right-s'"
                />
                <span class="qr-toggle-label">QR pallet</span>
              </ElButton>
            </div>

            <ElDivider />

            <div v-if="palletDetailItems.length" class="pallet-items">
              <p><strong>Danh sách hàng trên pallet:</strong></p>
              <ul>
                <li v-for="item in palletDetailItems" :key="item.allocationId" class="pallet-item">
                  <strong>
                    {{ item.productName || item.itemName || item.qrCode || 'Hàng hóa' }}
                  </strong>
                  <div v-if="item.productCode">Mã SP: {{ item.productCode }}</div>
                  <div v-if="item.customerName">Khách hàng: {{ item.customerName }}</div>
                  <div>
                    Kích thước thùng (1 đơn vị):
                    <span v-if="item.standardLength && item.standardWidth && item.standardHeight">
                      {{ item.standardLength }}m × {{ item.standardWidth }}m ×
                      {{ item.standardHeight }}m
                    </span>
                    <span v-else>N/A</span>
                  </div>
                  <div>
                    Kích thước khối hàng trên pallet:
                    {{ item.length }}m × {{ item.width }}m × {{ item.height }}m
                  </div>
                  <div>
                    Số lượng đơn vị trên pallet:
                    <span v-if="item.unitQuantity != null">
                      {{ item.unitQuantity }}
                      <span v-if="item.unit">{{ item.unit }}</span>
                    </span>
                    <span v-else>N/A</span>
                  </div>
                </li>
              </ul>
            </div>
          </div>

          <transition name="fade">
            <div v-if="showPalletQr && palletQrText" class="pallet-detail-right">
              <p class="qr-panel-title"><strong>Mã QR pallet</strong></p>
              <div class="pallet-qr-code">
                <Qrcode :text="palletQrText" :width="200" />
              </div>
              <p class="qr-panel-hint">Quét mã để xem nhanh thông tin pallet.</p>
            </div>
          </transition>
        </div>
      </div>
    </ElDialog>
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

.pallet-detail-dialog {
  .pallet-detail-layout {
    display: flex;
    gap: 16px;
  }

  .pallet-detail-left {
    flex: 1 1 auto;
    min-width: 0;
  }

  .pallet-detail-right {
    display: flex;
    padding-left: 16px;
    border-left: 1px solid #ebeef5;
    flex: 0 0 240px;
    flex-direction: column;
    align-items: center;
  }

  .pallet-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 8px;
  }

  .qr-toggle-btn {
    display: inline-flex;
    align-items: center;
  }

  .qr-toggle-label {
    margin-left: 4px;
  }

  .pallet-items {
    max-height: 220px;
    overflow-y: auto;

    .pallet-item {
      margin-bottom: 8px;
    }
  }

  .pallet-qr-code {
    display: flex;
    margin-top: 8px;
    margin-bottom: 8px;
    justify-content: center;
  }

  .qr-panel-hint {
    font-size: 12px;
    color: #909399;
    text-align: center;
  }
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
