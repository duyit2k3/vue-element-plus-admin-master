<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, computed } from 'vue'
import {
  ElCard,
  ElRow,
  ElCol,
  ElTable,
  ElTableColumn,
  ElButton,
  ElTag,
  ElMessage,
  ElDivider,
  ElMessageBox
} from 'element-plus'
import { Icon } from '@/components/Icon'
import { useRoute, useRouter } from 'vue-router'
import inboundApi, {
  type InboundApprovalView,
  type InboundApprovalItem,
  type PreferredPalletLayout,
  type InboundOptimizeLayoutView,
  type ManualStackLayoutRequest,
  type ManualStackLayoutItemRequest,
  type ManualStackUnitRequest
} from '@/api/inbound'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import { DragControls } from 'three/examples/jsm/controls/DragControls'

const route = useRoute()
const router = useRouter()

const loading = ref(true)
const approving = ref(false)
const optimizing = ref(false)
const rejecting = ref(false)
const approvalData = ref<InboundApprovalView | null>(null)
const selectedItem = ref<InboundApprovalItem | null>(null)
const canvasContainer = ref<HTMLDivElement>()

// Lưu priority (theo trục X trong viewer) cho từng pallet
const palletLayouts = ref<Record<number, number>>({})
const optimizeResult = ref<InboundOptimizeLayoutView | null>(null)
const lastPreferredLayouts = ref<PreferredPalletLayout[] | null>(null)

const manualLayouts = ref<Record<number, ManualStackUnitRequest[]>>({})
const manualLayerConfirmed = ref<Record<number, boolean>>({})

let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let renderer: THREE.WebGLRenderer | null = null
let controls: OrbitControls | null = null
let animationId: number | null = null
let dragControls: DragControls | null = null
let palletGroup: THREE.Group | null = null

// Các mesh có thể kéo (hiện tại chỉ dùng cho drag pallet ở auto mode nếu cần)
let draggableUnits: THREE.Object3D[] = []

// Trạng thái "đang đặt hàng" cho manual mode
let placingObject: THREE.Object3D | null = null
let placingItemId: number | null = null
let placingUnitIndex: number | null = null
const mouse = new THREE.Vector2()
const raycaster = new THREE.Raycaster()
let pointerListenersAttached = false

const receiptId = ref<number | null>(null)

const isManualMode = computed(() => approvalData.value?.stackMode?.toLowerCase() === 'manual')

const disableApproveButton = computed(() => {
  if (!isManualMode.value || !approvalData.value) {
    return false
  }

  return approvalData.value.items.some((item) => {
    const units = manualLayouts.value[item.inboundItemId]
    if (!units || !units.length) {
      return false
    }
    return !manualLayerConfirmed.value[item.inboundItemId]
  })
})

const getUnitAabbForManual = (
  centerX: number,
  centerZ: number,
  length: number,
  width: number,
  rotationY: number
) => {
  const halfL = length / 2
  const halfW = width / 2
  const angle = rotationY || 0

  if (Math.abs(angle) < 1e-6) {
    return {
      minX: centerX - halfL,
      maxX: centerX + halfL,
      minZ: centerZ - halfW,
      maxZ: centerZ + halfW
    }
  }

  const cos = Math.cos(angle)
  const sin = Math.sin(angle)

  const extentX = Math.abs(halfL * cos) + Math.abs(halfW * sin)
  const extentZ = Math.abs(halfL * sin) + Math.abs(halfW * cos)

  return {
    minX: centerX - extentX,
    maxX: centerX + extentX,
    minZ: centerZ - extentZ,
    maxZ: centerZ + extentZ
  }
}

const currentBlockDims = computed(() => {
  const item = selectedItem.value
  if (!item) {
    return { length: 0, width: 0, height: 0 }
  }

  const units = manualLayouts.value[item.inboundItemId] || []
  if (units.length) {
    let minX = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let minZ = Number.POSITIVE_INFINITY
    let maxZ = Number.NEGATIVE_INFINITY
    let maxTop = Number.NEGATIVE_INFINITY

    const palletHeight = item.palletHeight

    for (const u of units) {
      const aabb = getUnitAabbForManual(u.localX, u.localZ, u.length, u.width, u.rotationY || 0)

      if (aabb.minX < minX) minX = aabb.minX
      if (aabb.maxX > maxX) maxX = aabb.maxX
      if (aabb.minZ < minZ) minZ = aabb.minZ
      if (aabb.maxZ > maxZ) maxZ = aabb.maxZ

      const top = u.localY + u.height / 2
      if (top > maxTop) maxTop = top
    }

    let length = maxX - minX
    let width = maxZ - minZ
    let height = maxTop - palletHeight

    if (!Number.isFinite(length) || length <= 0) length = item.itemLength
    if (!Number.isFinite(width) || width <= 0) width = item.itemWidth
    if (!Number.isFinite(height) || height <= 0) height = item.itemHeight

    return { length, width, height }
  }

  return {
    length: item.itemLength,
    width: item.itemWidth,
    height: item.itemHeight
  }
})

const stackModeLabel = computed(() => {
  const mode = approvalData.value?.stackMode?.toLowerCase()
  if (mode === 'manual') return 'Bạn tự xếp trên pallet'
  return 'Hệ thống gợi ý cách xếp'
})

const loadApprovalData = async () => {
  const idParam = route.params.receiptId || route.query.receiptId
  if (!idParam) {
    ElMessage.error('Thiếu receiptId trong đường dẫn')
    return
  }
  receiptId.value = Number(idParam)

  loading.value = true
  try {
    const res = await inboundApi.getInboundApprovalView(receiptId.value)
    if (res.statusCode === 200 || res.code === 0) {
      approvalData.value = res.data

      // Khởi tạo layout chi tiết từ StackUnits backend (nếu có) để đảm bảo
      // layout hiển thị ở màn duyệt (/warehouse/inbound-request/:id/approval)
      // khớp với layout dùng cho 3D inbound-approval.
      const layouts: Record<number, ManualStackUnitRequest[]> = {}
      const confirmed: Record<number, boolean> = {}

      for (const it of res.data.items || []) {
        const stackUnits: any[] = Array.isArray((it as any).stackUnits)
          ? ((it as any).stackUnits as any[])
          : []

        if (!stackUnits.length) continue

        layouts[it.inboundItemId] = stackUnits.map((u: any, index: number) => {
          const length = Number(u.length ?? it.unitLength ?? it.itemLength ?? 0) || 0
          const width = Number(u.width ?? it.unitWidth ?? it.itemWidth ?? 0) || 0
          const height = Number(u.height ?? it.unitHeight ?? it.itemHeight ?? 0) || 0

          return {
            unitIndex:
              typeof u.unitIndex === 'number' && Number.isFinite(u.unitIndex) ? u.unitIndex : index,
            localX: Number(u.localX ?? 0) || 0,
            localY: Number(u.localY ?? 0) || 0,
            localZ: Number(u.localZ ?? 0) || 0,
            length,
            width,
            height,
            rotationY: Number(u.rotationY ?? 0) || 0
          }
        })

        // Nếu đã có layout từ BE thì coi như tầng đã được xác nhận, muốn chỉnh lại phải Reset.
        confirmed[it.inboundItemId] = true
      }

      if (Object.keys(layouts).length) {
        manualLayouts.value = layouts
        manualLayerConfirmed.value = { ...manualLayerConfirmed.value, ...confirmed }
      }

      selectedItem.value = approvalData.value.items[0] || null
      initThree()
      renderScene()
    } else {
      ElMessage.error(res.message || 'Không thể tải dữ liệu duyệt inbound')
    }
  } catch (e) {
    ElMessage.error('Lỗi khi tải dữ liệu duyệt inbound')
  } finally {
    loading.value = false
  }
}

const initThree = () => {
  if (!canvasContainer.value) return

  if (renderer) {
    if (animationId !== null) {
      cancelAnimationFrame(animationId)
    }
    renderer.dispose()
    canvasContainer.value.innerHTML = ''
  }

  scene = new THREE.Scene()
  scene.background = new THREE.Color(0xf0f0f0)

  const width = canvasContainer.value.clientWidth
  const height = canvasContainer.value.clientHeight || 500

  camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000)
  camera.position.set(2, 2, 2)

  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setSize(width, height)
  renderer.shadowMap.enabled = true
  canvasContainer.value.appendChild(renderer.domElement)

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.05

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.7)
  scene.add(ambientLight)

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8)
  dirLight.position.set(5, 10, 5)
  dirLight.castShadow = true
  scene.add(dirLight)

  const grid = new THREE.GridHelper(5, 20, 0x888888, 0xcccccc)
  scene.add(grid)

  // Gắn listener chuột cho canvas (để điều khiển chế độ đặt hàng theo chuột)
  if (canvasContainer.value && !pointerListenersAttached) {
    canvasContainer.value.addEventListener('pointermove', handlePointerMove)
    canvasContainer.value.addEventListener('click', handlePointerClick)
    pointerListenersAttached = true
  }
}

const renderScene = () => {
  if (!scene || !camera || !renderer) return

  const item = selectedItem.value

  // clear old objects except lights & helpers
  const toRemove: THREE.Object3D[] = []
  scene.children.forEach((child) => {
    if (child instanceof THREE.Light || child instanceof THREE.GridHelper) return
    toRemove.push(child)
  })
  toRemove.forEach((obj) => scene!.remove(obj))

  if (!item) {
    animate()
    return
  }

  // Khi render lại thì hủy trạng thái đang đặt hàng (nếu có)
  placingObject = null
  placingItemId = null
  placingUnitIndex = null

  palletGroup = new THREE.Group()
  draggableUnits = []

  // pallet
  const palletGeo = new THREE.BoxGeometry(item.palletLength, item.palletHeight, item.palletWidth)
  const palletMat = new THREE.MeshStandardMaterial({ color: 0xf39c12 })
  const palletMesh = new THREE.Mesh(palletGeo, palletMat)
  palletMesh.position.set(0, item.palletHeight / 2, 0)
  palletMesh.receiveShadow = true
  palletMesh.castShadow = true
  palletGroup.add(palletMesh)

  let units: ManualStackUnitRequest[] = []

  if (isManualMode.value) {
    // Manual mode: không tự sinh layout, pallet ban đầu rỗng,
    // chỉ vẽ các đơn vị mà người dùng đã thêm
    units = manualLayouts.value[item.inboundItemId] || []
  } else {
    // Auto mode: sinh layout mặc định để hiển thị
    let existing = manualLayouts.value[item.inboundItemId]
    const total = Math.max(1, item.quantity)

    if (!existing || existing.length !== total) {
      const generated: ManualStackUnitRequest[] = []

      if (item.isBag) {
        const unitL = item.unitLength || item.itemLength
        const unitW = item.unitWidth || item.itemWidth
        const unitH = item.unitHeight || item.itemHeight / 2

        const maxPerRow = Math.max(1, Math.floor(item.palletLength / unitL))
        const maxPerCol = Math.max(1, Math.floor(item.palletWidth / unitW))
        const perLayer = Math.max(1, maxPerRow * maxPerCol)

        for (let idx = 0; idx < total; idx++) {
          const layer = Math.floor(idx / perLayer)
          const posInLayer = idx % perLayer
          const row = Math.floor(posInLayer / maxPerRow)
          const col = posInLayer % maxPerRow

          const xStart = -item.palletLength / 2 + unitL / 2
          const zStart = -item.palletWidth / 2 + unitW / 2

          const x = xStart + col * unitL
          const z = zStart + row * unitW
          const y = item.palletHeight + unitH / 2 + layer * unitH

          generated.push({
            unitIndex: idx,
            localX: x,
            localY: y,
            localZ: z,
            length: unitL,
            width: unitW,
            height: unitH,
            rotationY: 0
          })
        }
      } else {
        const unitL = item.unitLength || item.itemLength
        const unitW = item.unitWidth || item.itemWidth
        const unitH = item.unitHeight || item.itemHeight

        const maxPerRow = Math.max(1, Math.floor(item.palletLength / unitL))
        const maxPerCol = Math.max(1, Math.floor(item.palletWidth / unitW))
        const perLayer = Math.max(1, maxPerRow * maxPerCol)

        for (let idx = 0; idx < total; idx++) {
          const layer = Math.floor(idx / perLayer)
          const posInLayer = idx % perLayer
          const row = Math.floor(posInLayer / maxPerRow)
          const col = posInLayer % maxPerRow

          const xStart = -item.palletLength / 2 + unitL / 2
          const zStart = -item.palletWidth / 2 + unitW / 2

          const x = xStart + col * unitL
          const z = zStart + row * unitW
          const y = item.palletHeight + unitH / 2 + layer * unitH

          generated.push({
            unitIndex: idx,
            localX: x,
            localY: y,
            localZ: z,
            length: unitL,
            width: unitW,
            height: unitH,
            rotationY: 0
          })
        }
      }

      existing = generated
      manualLayouts.value[item.inboundItemId] = generated
    }

    units = existing
  }

  if (item.isBag) {
    const bagMat = new THREE.MeshStandardMaterial({ color: 0x27ae60 })

    for (const u of units) {
      const bagGeo = new THREE.BoxGeometry(u.length, u.height, u.width)
      const bag = new THREE.Mesh(bagGeo, bagMat)

      const group = new THREE.Group()
      group.add(bag)

      const bagEdgeGeo = new THREE.EdgesGeometry(bagGeo)
      const bagEdgeMat = new THREE.LineBasicMaterial({ color: 0x000000 })
      const bagEdges = new THREE.LineSegments(bagEdgeGeo, bagEdgeMat)
      group.add(bagEdges)

      group.position.set(u.localX, u.localY, u.localZ)
      group.rotation.y = u.rotationY || 0
      group.userData = {
        inboundItemId: item.inboundItemId,
        unitIndex: u.unitIndex
      }

      palletGroup.add(group)
      draggableUnits.push(group)
    }
  } else {
    const boxMat = new THREE.MeshStandardMaterial({
      color: 0xe67e22,
      opacity: 0.95,
      transparent: true
    })

    for (const u of units) {
      const boxGeo = new THREE.BoxGeometry(u.length, u.height, u.width)
      const box = new THREE.Mesh(boxGeo, boxMat)

      const group = new THREE.Group()
      group.add(box)

      const boxEdgeGeo = new THREE.EdgesGeometry(boxGeo)
      const boxEdgeMat = new THREE.LineBasicMaterial({ color: 0x000000 })
      const boxEdges = new THREE.LineSegments(boxEdgeGeo, boxEdgeMat)
      group.add(boxEdges)

      group.position.set(u.localX, u.localY, u.localZ)
      group.rotation.y = u.rotationY || 0
      group.userData = {
        inboundItemId: item.inboundItemId,
        unitIndex: u.unitIndex
      }

      palletGroup.add(group)
      draggableUnits.push(group)
    }
  }

  // Khôi phục vị trí pallet đã kéo trước đó (ưu tiên cho auto layout)
  const savedX = palletLayouts.value[item.palletId]
  palletGroup.position.set(savedX ?? 0, 0, 0)

  scene.add(palletGroup)

  if (controls) {
    controls.target.set(0, item.palletHeight, 0)
    controls.update()
  }

  animate()
}

// Bắt đầu chế độ "đặt hàng theo chuột" cho unit vừa thêm
const startPlacingUnit = (inboundItemId: number, unitIndex: number) => {
  if (!palletGroup) return

  let target: THREE.Object3D | null = null
  palletGroup.traverse((obj) => {
    if (target) return
    if (
      obj.userData &&
      obj.userData.inboundItemId === inboundItemId &&
      obj.userData.unitIndex === unitIndex
    ) {
      target = obj
    }
  })

  if (target) {
    placingObject = target
    placingItemId = inboundItemId
    placingUnitIndex = unitIndex
  }
}

const buildManualLayoutRequest = (): ManualStackLayoutRequest | null => {
  if (!approvalData.value) return null

  const itemsReq: ManualStackLayoutItemRequest[] = []

  for (const item of approvalData.value.items) {
    let units = manualLayouts.value[item.inboundItemId]
    const total = Math.max(1, item.quantity)

    if (!units || units.length !== total) {
      // Nếu vì lý do nào đó chưa có layout trong bộ nhớ, tạo default giống renderScene
      const generated: ManualStackUnitRequest[] = []

      if (item.isBag) {
        const unitL = item.unitLength || item.itemLength
        const unitW = item.unitWidth || item.itemWidth
        const unitH = item.unitHeight || item.itemHeight / 2

        const maxPerRow = Math.max(1, Math.floor(item.palletLength / unitL))
        const maxPerCol = Math.max(1, Math.floor(item.palletWidth / unitW))
        const perLayer = Math.max(1, maxPerRow * maxPerCol)

        for (let idx = 0; idx < total; idx++) {
          const layer = Math.floor(idx / perLayer)
          const posInLayer = idx % perLayer
          const row = Math.floor(posInLayer / maxPerRow)
          const col = posInLayer % maxPerRow

          const xStart = -item.palletLength / 2 + unitL / 2
          const zStart = -item.palletWidth / 2 + unitW / 2

          const x = xStart + col * unitL
          const z = zStart + row * unitW
          const y = item.palletHeight + unitH / 2 + layer * unitH

          generated.push({
            unitIndex: idx,
            localX: x,
            localY: y,
            localZ: z,
            length: unitL,
            width: unitW,
            height: unitH,
            rotationY: 0
          })
        }
      } else {
        const unitL = item.unitLength || item.itemLength
        const unitW = item.unitWidth || item.itemWidth
        const unitH = item.unitHeight || item.itemHeight

        const maxPerRow = Math.max(1, Math.floor(item.palletLength / unitL))
        const maxPerCol = Math.max(1, Math.floor(item.palletWidth / unitW))
        const perLayer = Math.max(1, maxPerRow * maxPerCol)

        for (let idx = 0; idx < total; idx++) {
          const layer = Math.floor(idx / perLayer)
          const posInLayer = idx % perLayer
          const row = Math.floor(posInLayer / maxPerRow)
          const col = posInLayer % maxPerRow

          const xStart = -item.palletLength / 2 + unitL / 2
          const zStart = -item.palletWidth / 2 + unitW / 2

          const x = xStart + col * unitL
          const z = zStart + row * unitW
          const y = item.palletHeight + unitH / 2 + layer * unitH

          generated.push({
            unitIndex: idx,
            localX: x,
            localY: y,
            localZ: z,
            length: unitL,
            width: unitW,
            height: unitH,
            rotationY: 0
          })
        }
      }

      units = generated
      manualLayouts.value[item.inboundItemId] = generated
    }

    itemsReq.push({ inboundItemId: item.inboundItemId, units })
  }

  return { items: itemsReq }
}

const rotateCurrentUnit = () => {
  if (!isManualMode.value) return
  if (!placingObject || placingItemId == null || placingUnitIndex == null) {
    ElMessage.warning('Hiện không có thùng/bao nào đang được đặt để xoay')
    return
  }

  const itemId = placingItemId
  const units = manualLayouts.value[itemId] || []
  const idx = units.findIndex((u) => u.unitIndex === placingUnitIndex)
  if (idx === -1) return

  const current = units[idx]
  const step = Math.PI / 2
  const twoPi = Math.PI * 2
  let newRot = (current.rotationY || 0) + step
  newRot = ((newRot % twoPi) + twoPi) % twoPi

  units[idx] = { ...current, rotationY: newRot }
  manualLayouts.value[itemId] = [...units]

  placingObject.rotation.y = newRot
}

const resetCurrentItemLayout = () => {
  if (!isManualMode.value) return
  const item = selectedItem.value
  if (!item) return

  // Đưa pallet về trạng thái rỗng cho item hiện tại
  manualLayouts.value[item.inboundItemId] = []
  manualLayerConfirmed.value[item.inboundItemId] = false
  renderScene()
}

const addUnitForCurrentItem = () => {
  const item = selectedItem.value
  if (!item) return

  if (!isManualMode.value) return

  if (placingObject) {
    ElMessage.warning('Đang đặt một đơn vị hàng. Vui lòng click lên pallet để đặt xong trước.')
    return
  }

  const total = Math.max(1, item.quantity)
  let units = manualLayouts.value[item.inboundItemId] || []

  // Nếu tầng đã được xác nhận thì không cho thêm, yêu cầu reset trước
  if (manualLayerConfirmed.value[item.inboundItemId]) {
    ElMessage.warning('Tầng đã được xác nhận. Vui lòng Reset layout nếu muốn thiết kế lại.')
    return
  }

  if (units.length >= total) {
    ElMessage.warning('Đã đủ số lượng thùng/bao theo phiếu, không thể thêm thêm.')
    return
  }

  if (item.isBag) {
    const unitL = item.unitLength || item.itemLength
    const unitW = item.unitWidth || item.itemWidth
    const unitH = item.unitHeight || item.itemHeight / 2

    const y = item.palletHeight + unitH / 2 // tầng 1

    units = [
      ...units,
      {
        unitIndex: units.length,
        localX: 0,
        localY: y,
        localZ: 0,
        length: unitL,
        width: unitW,
        height: unitH,
        rotationY: 0
      }
    ]
  } else {
    const unitL = item.unitLength || item.itemLength
    const unitW = item.unitWidth || item.itemWidth
    const unitH = item.unitHeight || item.itemHeight

    const y = item.palletHeight + unitH / 2

    units = [
      ...units,
      {
        unitIndex: units.length,
        localX: 0,
        localY: y,
        localZ: 0,
        length: unitL,
        width: unitW,
        height: unitH,
        rotationY: 0
      }
    ]
  }

  manualLayouts.value[item.inboundItemId] = units
  // Sau khi thêm unit mới, render lại và bật chế độ đặt hàng theo chuột cho unit đó
  renderScene()
  const latest = units[units.length - 1]
  startPlacingUnit(item.inboundItemId, latest.unitIndex)
}

const confirmCurrentLayer = () => {
  if (!isManualMode.value) return
  const item = selectedItem.value
  if (!item) return

  const itemId = item.inboundItemId

  if (manualLayerConfirmed.value[itemId]) {
    ElMessage.warning('Tầng này đã được xác nhận. Vui lòng Reset layout nếu muốn thiết kế lại.')
    return
  }

  const baseUnits = manualLayouts.value[itemId] || []
  if (!baseUnits.length) {
    ElMessage.warning('Chưa có hàng nào trên pallet để xác nhận tầng.')
    return
  }

  // Kiểm tra các khối trên tầng hiện tại có đang chồng lấn/xuyên qua nhau không
  if (baseUnits.length > 1) {
    let hasOverlap = false

    for (let i = 0; i < baseUnits.length && !hasOverlap; i++) {
      const u1 = baseUnits[i]
      const aabb1 = getUnitAabbForManual(
        u1.localX,
        u1.localZ,
        u1.length,
        u1.width,
        u1.rotationY || 0
      )

      const halfL1 = u1.length / 2
      const halfW1 = u1.width / 2
      const epsilonBase1 = Math.min(halfL1, halfW1)
      const epsilon1 =
        Number.isFinite(epsilonBase1) && epsilonBase1 > 0 ? epsilonBase1 * 0.05 : 0.01

      for (let j = i + 1; j < baseUnits.length; j++) {
        const u2 = baseUnits[j]
        const aabb2 = getUnitAabbForManual(
          u2.localX,
          u2.localZ,
          u2.length,
          u2.width,
          u2.rotationY || 0
        )

        const epsilonBase2 = Math.min(u2.length / 2, u2.width / 2)
        const epsilon2 =
          Number.isFinite(epsilonBase2) && epsilonBase2 > 0 ? epsilonBase2 * 0.05 : 0.01

        const epsilon = Math.max(epsilon1, epsilon2)

        const noOverlap =
          aabb1.maxX <= aabb2.minX + epsilon ||
          aabb1.minX >= aabb2.maxX - epsilon ||
          aabb1.maxZ <= aabb2.minZ + epsilon ||
          aabb1.minZ >= aabb2.maxZ - epsilon

        if (!noOverlap) {
          hasOverlap = true
          break
        }
      }
    }

    if (hasOverlap) {
      ElMessage.error(
        'Tầng hiện tại có các khối đang chồng lấn/xuyên qua nhau. Vui lòng sắp xếp lại trước khi xác nhận.'
      )
      return
    }
  }

  const total = Math.max(1, item.quantity)
  const baseCount = baseUnits.length
  const newUnits: ManualStackUnitRequest[] = []

  // Giả định chiều cao mỗi đơn vị bằng nhau, lấy từ đơn vị đầu tiên
  const layerHeight = baseUnits[0].height
  let currentIndex = 0

  outer: for (let layer = 0; ; layer++) {
    for (let i = 0; i < baseCount; i++) {
      if (currentIndex >= total) break outer
      const base = baseUnits[i]
      newUnits.push({
        ...base,
        unitIndex: currentIndex,
        localY: base.localY + layer * layerHeight
      })
      currentIndex++
    }
  }

  manualLayouts.value[itemId] = newUnits
  manualLayerConfirmed.value[itemId] = true
  renderScene()
  ElMessage.success('Đã xác nhận tầng 1, hệ thống đã nhân layout cho các tầng tiếp theo.')
}

const animate = () => {
  if (!renderer || !scene || !camera) return
  animationId = requestAnimationFrame(animate)
  if (controls) controls.update()
  renderer.render(scene, camera)
}

// Cập nhật vị trí unit đang được "dẫn" theo chuột trên mặt pallet
// và không cho phép đè lên các unit đã đặt trước đó
const updatePlacingObjectPosition = (event: PointerEvent) => {
  if (!placingObject || !camera || !renderer || !selectedItem.value) return
  if (!isManualMode.value || placingItemId == null || placingUnitIndex == null) return

  const item = selectedItem.value
  if (!item || item.inboundItemId !== placingItemId) return

  const rect = renderer.domElement.getBoundingClientRect()
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

  raycaster.setFromCamera(mouse, camera)
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -item.palletHeight)
  const point = new THREE.Vector3()

  if (!raycaster.ray.intersectPlane(plane, point)) return

  const units = manualLayouts.value[placingItemId] || []
  const u = units.find((x) => x.unitIndex === placingUnitIndex)
  if (!u) return

  const halfPalL = item.palletLength / 2
  const halfPalW = item.palletWidth / 2
  const halfL = u.length / 2
  const halfW = u.width / 2
  const angle = u.rotationY || 0

  let targetX = point.x
  let targetZ = point.z

  const gridBase = Math.min(u.length, u.width)
  const gridStep = Number.isFinite(gridBase) && gridBase > 0 ? gridBase / 10 : 0.05

  if (gridStep > 0) {
    targetX = Math.round(targetX / gridStep) * gridStep
    targetZ = Math.round(targetZ / gridStep) * gridStep
  }

  // Tọa độ đề xuất sau khi clamp trong phạm vi pallet (tính theo AABB của khối sau xoay)
  let extentX = halfL
  let extentZ = halfW
  if (Math.abs(angle) >= 1e-6) {
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    extentX = Math.abs(halfL * cos) + Math.abs(halfW * sin)
    extentZ = Math.abs(halfL * sin) + Math.abs(halfW * cos)
  }

  let minCenterX = -halfPalL + extentX
  let maxCenterX = halfPalL - extentX
  let minCenterZ = -halfPalW + extentZ
  let maxCenterZ = halfPalW - extentZ

  if (minCenterX > maxCenterX) {
    minCenterX = maxCenterX = 0
  }
  if (minCenterZ > maxCenterZ) {
    minCenterZ = maxCenterZ = 0
  }

  const proposedX = THREE.MathUtils.clamp(targetX, minCenterX, maxCenterX)
  const proposedZ = THREE.MathUtils.clamp(targetZ, minCenterZ, maxCenterZ)
  const y = item.palletHeight + u.height / 2

  const epsilonBase = Math.min(halfL, halfW)
  const epsilon = Number.isFinite(epsilonBase) && epsilonBase > 0 ? epsilonBase * 0.05 : 0.01

  const checkOverlap = (cx: number, cz: number) => {
    const aabb1 = getUnitAabbForManual(cx, cz, u.length, u.width, angle)
    const minX1 = aabb1.minX
    const maxX1 = aabb1.maxX
    const minZ1 = aabb1.minZ
    const maxZ1 = aabb1.maxZ

    return units.some((other) => {
      if (other.unitIndex === placingUnitIndex) return false

      const aabb2 = getUnitAabbForManual(
        other.localX,
        other.localZ,
        other.length,
        other.width,
        other.rotationY || 0
      )
      const minX2 = aabb2.minX
      const maxX2 = aabb2.maxX
      const minZ2 = aabb2.minZ
      const maxZ2 = aabb2.maxZ

      // Không giao nhau nếu một trong bốn điều kiện sau đúng (nới lỏng với epsilon nhỏ)
      if (
        maxX1 <= minX2 + epsilon ||
        minX1 >= maxX2 - epsilon ||
        maxZ1 <= minZ2 + epsilon ||
        minZ1 >= maxZ2 - epsilon
      ) {
        return false
      }
      return true
    })
  }

  const prevX = u.localX
  const prevZ = u.localZ

  let finalX = proposedX
  let finalZ = proposedZ

  if (checkOverlap(proposedX, proposedZ)) {
    // Thử trượt theo trục X (giữ nguyên Z cũ)
    if (!checkOverlap(proposedX, prevZ)) {
      finalX = proposedX
      finalZ = prevZ
    } else if (!checkOverlap(prevX, proposedZ)) {
      // Thử trượt theo trục Z (giữ nguyên X cũ)
      finalX = prevX
      finalZ = proposedZ
    } else {
      // Nếu mọi hướng đều va chạm, giữ nguyên vị trí hiện tại của unit đang đặt
      return
    }
  }

  placingObject.position.set(finalX, y, finalZ)

  u.localX = finalX
  u.localY = y
  u.localZ = finalZ
}

const handlePointerMove = (event: PointerEvent) => {
  updatePlacingObjectPosition(event)
}

const handlePointerClick = (event: PointerEvent) => {
  if (!placingObject) return
  // Cập nhật vị trí lần cuối rồi thoát chế độ đặt hàng
  updatePlacingObjectPosition(event)
  placingObject = null
  placingItemId = null
  placingUnitIndex = null
}

// setupDragControls is no longer used - manual mode uses mouse-based placement,
// auto mode only allows view rotation/zoom via OrbitControls

watch(selectedItem, () => {
  renderScene()
})

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'r' && event.key !== 'R') return

  // Bỏ qua nếu đang gõ trong input/textarea/select hoặc contenteditable
  const target = event.target as HTMLElement | null
  if (target) {
    const tag = target.tagName.toLowerCase()
    const isFormElement =
      tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable
    if (isFormElement) return
  }

  // Chỉ áp dụng cho manual mode
  if (!isManualMode.value) return

  event.preventDefault()
  rotateCurrentUnit()
}

onMounted(() => {
  loadApprovalData()
  window.addEventListener('resize', onResize)
  window.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  window.removeEventListener('keydown', handleKeydown)
  if (dragControls) {
    dragControls.dispose()
    dragControls = null
  }
  if (canvasContainer.value && pointerListenersAttached) {
    canvasContainer.value.removeEventListener('pointermove', handlePointerMove)
    canvasContainer.value.removeEventListener('click', handlePointerClick)
    pointerListenersAttached = false
  }
  if (renderer) {
    if (animationId !== null) {
      cancelAnimationFrame(animationId)
    }
    renderer.dispose()
  }
})

const onResize = () => {
  if (!renderer || !camera || !canvasContainer.value) return
  const width = canvasContainer.value.clientWidth
  const height = canvasContainer.value.clientHeight || 500
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  renderer.setSize(width, height)
}

const handleOptimize = async () => {
  if (!receiptId.value || !approvalData.value) return
  optimizing.value = true
  try {
    // Lấy priority hiện tại theo vị trí kéo thả (nếu có) cho từng pallet
    const layouts: PreferredPalletLayout[] = []
    const seen = new Set<number>()
    for (const item of approvalData.value.items) {
      if (seen.has(item.palletId)) continue
      seen.add(item.palletId)
      const priority = palletLayouts.value[item.palletId]
      layouts.push({ palletId: item.palletId, priority })
    }

    const payload = layouts.length
      ? { preferredLayouts: layouts, forceUsePreferredLayout: true }
      : { forceUsePreferredLayout: true }

    const res = await inboundApi.previewApproveInboundLayout(receiptId.value, payload)
    if (res.statusCode === 200 || res.code === 0) {
      optimizeResult.value = res.data
      if (layouts.length) {
        lastPreferredLayouts.value = layouts
      }
      ElMessage.success('Tối ưu layout thành công')
    } else {
      ElMessage.error(res.message || 'Không thể tối ưu layout')
    }
  } catch (e) {
    ElMessage.error('Lỗi khi tối ưu layout')
  } finally {
    optimizing.value = false
  }
}

const handleApprove = async () => {
  if (!receiptId.value || !approvalData.value) return
  approving.value = true
  try {
    // Nếu ở chế độ tự xếp, lưu layout chi tiết trước khi duyệt
    if (isManualMode.value) {
      const hasUnconfirmed = approvalData.value.items.some((item) => {
        const units = manualLayouts.value[item.inboundItemId]
        if (!units || !units.length) return false
        return !manualLayerConfirmed.value[item.inboundItemId]
      })

      if (hasUnconfirmed) {
        ElMessage.warning(
          'Bạn cần nhấn "Xác nhận tầng" cho tất cả pallet đang tự xếp trước khi duyệt & xem 3D.'
        )
        approving.value = false
        return
      }

      const layoutReq = buildManualLayoutRequest()
      if (!layoutReq) {
        ElMessage.error('Không thể xây dựng layout xếp hàng thủ công')
        return
      }

      const saveRes = await inboundApi.saveManualStackLayout(receiptId.value, layoutReq)
      if (!(saveRes.statusCode === 200 || saveRes.code === 0)) {
        ElMessage.error(saveRes.message || 'Không thể lưu layout xếp hàng thủ công')
        return
      }

      // Lưu layout chi tiết vào sessionStorage để màn 3D có thể vẽ đúng stack units inbound
      if (typeof window !== 'undefined') {
        try {
          const key = `inboundManualLayouts:${receiptId.value}`
          const snapshot = manualLayouts.value
          window.sessionStorage.setItem(key, JSON.stringify(snapshot))
        } catch {
          // Bỏ qua lỗi lưu session, không chặn luồng duyệt 3D
        }
      }
    }

    let layouts: PreferredPalletLayout[] = []

    if (lastPreferredLayouts.value && lastPreferredLayouts.value.length) {
      layouts = [...lastPreferredLayouts.value]
    } else {
      const seen = new Set<number>()
      for (const item of approvalData.value.items) {
        if (seen.has(item.palletId)) continue
        seen.add(item.palletId)
        const priority = palletLayouts.value[item.palletId]
        layouts.push({ palletId: item.palletId, priority })
      }
    }

    const previewPayload = layouts.length
      ? { preferredLayouts: layouts, forceUsePreferredLayout: true }
      : { forceUsePreferredLayout: true }

    const previewRes = await inboundApi.previewApproveInboundLayout(receiptId.value, previewPayload)
    if (
      !(previewRes.statusCode === 200 || previewRes.code === 0) ||
      !previewRes.data?.layouts?.length
    ) {
      ElMessage.error(previewRes.message || 'Không tìm được layout phù hợp để xem 3D')
      return
    }

    optimizeResult.value = previewRes.data
    if (layouts.length) {
      lastPreferredLayouts.value = layouts
    }

    let zoneIdToView: number | undefined = approvalData.value.zoneId ?? undefined
    if (!zoneIdToView) {
      const firstLayout = previewRes.data.layouts[0]
      if (firstLayout && typeof firstLayout.zoneId === 'number') {
        zoneIdToView = firstLayout.zoneId
      }
    }

    if (!zoneIdToView) {
      ElMessage.error('Không xác định được zone để xem 3D')
      return
    }

    router.push({
      name: 'WarehouseInbound3DApproval',
      params: {
        id: approvalData.value.warehouseId,
        receiptId: receiptId.value,
        zoneId: zoneIdToView
      }
    })
  } catch (e) {
    ElMessage.error('Lỗi khi duyệt yêu cầu')
  } finally {
    approving.value = false
  }
}

const handleReject = async () => {
  if (!receiptId.value || !approvalData.value) return
  try {
    const { value, action } = await ElMessageBox.prompt(
      'Nhập lý do từ chối yêu cầu này',
      'Từ chối yêu cầu',
      {
        confirmButtonText: 'Từ chối',
        cancelButtonText: 'Hủy',
        type: 'warning',
        inputPlaceholder: 'Ví dụ: Thông tin hàng hóa chưa đầy đủ, cần bổ sung ...',
        inputType: 'textarea',
        inputValidator: (val: string) => {
          if (!val || !val.trim()) return 'Vui lòng nhập lý do từ chối'
          return true
        }
      }
    )

    if (action !== 'confirm') return

    rejecting.value = true
    const res = await inboundApi.updateInboundRequestStatus(receiptId.value, {
      status: 'cancelled',
      notes: value.trim()
    })

    if (res.statusCode === 200 || res.code === 0) {
      ElMessage.success('Đã từ chối yêu cầu nhập kho')
      router.push({ path: '/warehouse/inbound-request' })
    } else {
      ElMessage.error(res.message || 'Không thể cập nhật trạng thái yêu cầu')
    }
  } catch {
    // User hủy hoặc có lỗi khác
  } finally {
    rejecting.value = false
  }
}

const handleBack = () => {
  router.push({ path: '/warehouse/inbound-request' })
}
</script>

<template>
  <div class="inbound-approval">
    <ElRow :gutter="20" class="mb-20">
      <ElCol :span="12">
        <h2 class="title">Duyệt Yêu Cầu Nhập Kho</h2>
        <div v-if="approvalData" class="subtitle">
          <span
            >Mã phiếu: <strong>{{ approvalData.receiptNumber }}</strong></span
          >
          <span>
            Kho:
            <strong>{{ approvalData.warehouseName || `#${approvalData.warehouseId}` }}</strong>
          </span>
          <span v-if="approvalData.zoneId">
            Khu vực:
            <strong>
              {{ approvalData.zoneName || `Zone #${approvalData.zoneId}` }} (ID:
              {{ approvalData.zoneId }})
            </strong>
          </span>
          <span>
            Khách hàng:
            <strong>{{ approvalData.customerName || `#${approvalData.customerId}` }}</strong>
          </span>
          <span>
            Cách xếp hàng:
            <strong>{{ stackModeLabel }}</strong>
          </span>
        </div>
      </ElCol>
      <ElCol :span="12">
        <div class="header-actions">
          <ElButton class="header-actions__back" @click="handleBack">
            <Icon icon="vi-ep:arrow-left" />
            Quay lại danh sách
          </ElButton>
          <div
            v-if="approvalData?.status?.toLowerCase() === 'pending'"
            class="header-actions__main"
          >
            <ElButton type="success" :loading="optimizing" @click="handleOptimize">
              <Icon icon="vi-ep:magic-stick" />
              Tối ưu tự động
            </ElButton>
            <ElButton
              type="primary"
              :loading="approving"
              :disabled="disableApproveButton"
              @click="handleApprove"
            >
              <Icon icon="vi-ant-design:check-circle-outlined" />
              Duyệt & Xem Kho 3D
            </ElButton>
            <ElButton type="danger" :loading="rejecting" @click="handleReject">
              <Icon icon="vi-ep:close" />
              Từ chối yêu cầu
            </ElButton>
          </div>
        </div>
      </ElCol>
    </ElRow>

    <ElRow :gutter="20">
      <!-- Danh sách hàng -->
      <ElCol :span="7">
        <ElCard shadow="hover" class="full-height">
          <template #header>
            <div class="card-header">
              <span class="card-title">Danh sách hàng trên phiếu</span>
            </div>
          </template>

          <ElTable
            v-loading="loading"
            :data="approvalData?.items || []"
            height="520"
            highlight-current-row
            @current-change="(row) => (selectedItem = row as InboundApprovalItem | null)"
          >
            <ElTableColumn type="index" width="50" />
            <ElTableColumn prop="productCode" label="Mã SP" width="120" />
            <ElTableColumn prop="productName" label="Tên SP" min-width="160" />
            <ElTableColumn prop="quantity" label="SL" width="70" />
            <ElTableColumn label="Loại" width="90">
              <template #default="{ row }">
                <ElTag :type="row.isBag ? 'success' : 'info'">{{
                  row.isBag ? 'Bao' : 'Thùng'
                }}</ElTag>
              </template>
            </ElTableColumn>
          </ElTable>
        </ElCard>
      </ElCol>

      <!-- Viewer 3D -->
      <ElCol :span="10">
        <ElCard shadow="hover" class="full-height">
          <template #header>
            <div class="card-header">
              <span class="card-title">Viewer 3D Pallet &amp; Hàng</span>
            </div>
          </template>
          <div class="canvas-wrapper">
            <div ref="canvasContainer" class="canvas-container" v-loading="loading"></div>
            <div v-if="isManualMode" class="manual-tools-overlay">
              <ElButton size="small" @click="addUnitForCurrentItem">Thêm hàng</ElButton>
              <ElButton size="small" @click="rotateCurrentUnit">Xoay 90° thùng đang đặt</ElButton>
              <ElButton size="small" @click="resetCurrentItemLayout">Reset layout pallet</ElButton>
              <ElButton size="small" type="primary" @click="confirmCurrentLayer">
                Xác nhận tầng
              </ElButton>
            </div>
          </div>
        </ElCard>
      </ElCol>

      <!-- Thông tin chi tiết -->
      <ElCol :span="7">
        <ElCard shadow="hover" class="full-height">
          <template #header>
            <div class="card-header">
              <span class="card-title">Chi tiết hàng đang chọn</span>
            </div>
          </template>

          <div v-if="selectedItem" class="detail-content">
            <h3>
              {{ selectedItem.productName }}
              <ElTag class="ml-8" size="small">{{ selectedItem.productCode }}</ElTag>
            </h3>
            <p>
              <strong>Đơn vị:</strong>
              {{ selectedItem.unit }}
            </p>
            <p v-if="selectedItem.category">
              <strong>Danh mục:</strong>
              {{ selectedItem.category }}
            </p>
            <p>
              <strong>Loại hiển thị:</strong>
              <ElTag :type="selectedItem.isBag ? 'success' : 'info'">
                {{ selectedItem.isBag ? 'Hàng bao (stack từng bao)' : 'Hàng thùng (khối lớn)' }}
              </ElTag>
            </p>

            <ElDivider />

            <p>
              <strong>Số lượng:</strong>
              {{ selectedItem.quantity }}
            </p>
            <p>
              <strong>Kích thước pallet (L×W×H):</strong>
              {{ selectedItem.palletLength }} × {{ selectedItem.palletWidth }} ×
              {{ selectedItem.palletHeight }} m
            </p>
            <p>
              <strong>Kích thước khối hàng trên pallet (L×W×H):</strong>
              {{ currentBlockDims.length.toFixed(2) }} × {{ currentBlockDims.width.toFixed(2) }} ×
              {{ currentBlockDims.height.toFixed(2) }} m
            </p>
            <p v-if="selectedItem.unitLength && selectedItem.unitWidth && selectedItem.unitHeight">
              <strong>Kích thước 1 đơn vị (L×W×H):</strong>
              {{ selectedItem.unitLength }} × {{ selectedItem.unitWidth }} ×
              {{ selectedItem.unitHeight }} m
            </p>
            <p>
              <strong>Pallet:</strong>
              {{ selectedItem.palletBarcode }} (ID: {{ selectedItem.palletId }})
            </p>

            <ElDivider />

            <div v-if="isManualMode" class="manual-tools">
              <div class="manual-tools__hint">
                Chế độ <strong>tự xếp trên pallet</strong>: dùng các nút ở góc dưới bên trái viewer
                3D để thêm hàng, reset và xác nhận tầng, sau đó kéo thả từng bao/thùng trên pallet.
              </div>
            </div>
            <div v-else class="manual-tools__hint auto-mode-hint">
              Phiếu này đang dùng <strong>cách xếp do hệ thống gợi ý</strong>. Bạn có thể nhấn
              <strong>"Tối ưu tự động"</strong> ở phía trên để hệ thống gợi ý zone/kệ cho pallet.
            </div>

            <div>
              <strong>Layout đề xuất (nếu có):</strong>
              <div v-if="optimizeResult && optimizeResult.layouts.length" class="mt-2">
                <ElTable :data="optimizeResult.layouts" size="small" height="220" :border="true">
                  <ElTableColumn prop="palletId" label="Pallet" width="70" />
                  <ElTableColumn prop="zoneId" label="Zone" width="70" />
                  <ElTableColumn prop="shelfId" label="Vị trí" min-width="140">
                    <template #default="{ row }">
                      <span v-if="row.isGround">Đất (zone {{ row.zoneId }})</span>
                      <span v-else-if="row.shelfId">Kệ #{{ row.shelfId }}</span>
                      <span v-else>Khác</span>
                    </template>
                  </ElTableColumn>
                  <ElTableColumn prop="stackLevel" label="Tầng" width="60" />
                  <ElTableColumn label="Vị trí (X,Z)" min-width="110">
                    <template #default="{ row }">
                      ({{ row.positionX.toFixed(2) }}, {{ row.positionZ.toFixed(2) }})
                    </template>
                  </ElTableColumn>
                </ElTable>
              </div>
              <div v-else class="mt-2 text-muted">
                Nhấn "Tối ưu tự động" để xem gợi ý zone/stack cho toàn bộ pallet.
              </div>
            </div>
          </div>
          <div v-else class="detail-empty"
            >Chọn 1 hàng bên trái để xem chi tiết và hiển thị 3D.</div
          >
        </ElCard>
      </ElCol>
    </ElRow>
  </div>
</template>

<style scoped lang="less">
.inbound-approval {
  padding: 20px;
}

.mb-20 {
  margin-bottom: 20px;
}

.title {
  margin: 0;
  font-size: 20px;
  font-weight: bold;
}

.subtitle {
  display: flex;
  margin-top: 8px;
  font-size: 13px;
  color: #606266;
  flex-wrap: wrap;
  gap: 12px;
}

.header-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;

  &__back {
    margin-right: 8px;
  }

  &__main {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
}

.text-right {
  text-align: right;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-title {
  font-weight: 600;
}

.canvas-wrapper {
  position: relative;
}

.canvas-container {
  width: 100%;
  height: 520px;
}

.manual-tools-overlay {
  position: absolute;
  bottom: 12px;
  left: 12px;
  display: flex;
  padding: 6px 10px;
  background: rgb(17 24 39 / 80%);
  border-radius: 6px;
  flex-wrap: wrap;
  gap: 8px;
}

.full-height {
  height: 100%;
}

.detail-content {
  font-size: 13px;

  h3 {
    margin: 0 0 10px;
    font-size: 16px;
    font-weight: 600;
  }

  p {
    margin: 4px 0;
  }
}

.manual-tools__hint {
  margin-top: 4px;
  font-size: 12px;
  color: #909399;
}

.auto-mode-hint {
  margin-top: 8px;
}

.detail-empty {
  font-size: 13px;
  color: #909399;
}
</style>
