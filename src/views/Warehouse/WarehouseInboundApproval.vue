<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
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
  type InboundOptimizeLayoutView
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

let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let renderer: THREE.WebGLRenderer | null = null
let controls: OrbitControls | null = null
let animationId: number | null = null
let dragControls: DragControls | null = null
let palletGroup: THREE.Group | null = null

const receiptId = ref<number | null>(null)

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
}

const renderScene = () => {
  if (!scene || !camera || !renderer) return

  // clear old objects except lights & helpers
  const toRemove: THREE.Object3D[] = []
  scene.children.forEach((child) => {
    if (child instanceof THREE.Light || child instanceof THREE.GridHelper) return
    toRemove.push(child)
  })
  toRemove.forEach((obj) => scene!.remove(obj))

  const item = selectedItem.value
  if (!item) {
    animate()
    return
  }

  // Nhóm pallet + hàng để kéo thả cùng nhau
  palletGroup = new THREE.Group()

  // pallet
  const palletGeo = new THREE.BoxGeometry(item.palletLength, item.palletHeight, item.palletWidth)
  const palletMat = new THREE.MeshStandardMaterial({ color: 0xf39c12 })
  const palletMesh = new THREE.Mesh(palletGeo, palletMat)
  palletMesh.position.set(0, item.palletHeight / 2, 0)
  palletMesh.receiveShadow = true
  palletMesh.castShadow = true
  palletGroup.add(palletMesh)

  if (item.isBag) {
    const unitL = item.unitLength || item.itemLength
    const unitW = item.unitWidth || item.itemWidth
    const unitH = item.unitHeight || item.itemHeight / 2

    const maxPerRow = Math.max(1, Math.floor(item.palletLength / unitL))
    const maxPerCol = Math.max(1, Math.floor(item.palletWidth / unitW))
    const perLayer = Math.max(1, maxPerRow * maxPerCol)
    const total = Math.max(1, item.quantity)

    const bagGeo = new THREE.BoxGeometry(unitL, unitH, unitW)
    const bagMat = new THREE.MeshStandardMaterial({ color: 0x27ae60 })
    const bagEdgeGeo = new THREE.EdgesGeometry(bagGeo)
    const bagEdgeMat = new THREE.LineBasicMaterial({ color: 0x000000 })

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

      const bag = new THREE.Mesh(bagGeo, bagMat)
      bag.position.set(x, y, z)
      bag.castShadow = true
      bag.receiveShadow = true
      palletGroup.add(bag)

      const bagEdges = new THREE.LineSegments(bagEdgeGeo, bagEdgeMat)
      bagEdges.position.copy(bag.position)
      palletGroup.add(bagEdges)
    }
  } else {
    const unitL = item.unitLength || item.itemLength
    const unitW = item.unitWidth || item.itemWidth
    const unitH = item.unitHeight || item.itemHeight

    const maxPerRow = Math.max(1, Math.floor(item.palletLength / unitL))
    const maxPerCol = Math.max(1, Math.floor(item.palletWidth / unitW))
    const perLayer = Math.max(1, maxPerRow * maxPerCol)
    const total = Math.max(1, item.quantity)

    const boxGeo = new THREE.BoxGeometry(unitL, unitH, unitW)
    const boxMat = new THREE.MeshStandardMaterial({
      color: 0xe67e22,
      opacity: 0.95,
      transparent: true
    })
    const boxEdgeGeo = new THREE.EdgesGeometry(boxGeo)
    const boxEdgeMat = new THREE.LineBasicMaterial({ color: 0x000000 })

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

      const box = new THREE.Mesh(boxGeo, boxMat)
      box.position.set(x, y, z)
      box.castShadow = true
      box.receiveShadow = true
      palletGroup.add(box)

      const boxEdges = new THREE.LineSegments(boxEdgeGeo, boxEdgeMat)
      boxEdges.position.copy(box.position)
      palletGroup.add(boxEdges)
    }
  }

  // Khôi phục vị trí đã kéo trước đó (nếu có)
  const savedX = palletLayouts.value[item.palletId]
  palletGroup.position.set(savedX ?? 0, 0, 0)

  scene.add(palletGroup)

  setupDragControls()

  if (controls) {
    controls.target.set(0, item.palletHeight, 0)
    controls.update()
  }

  animate()
}

const animate = () => {
  if (!renderer || !scene || !camera) return
  animationId = requestAnimationFrame(animate)
  if (controls) controls.update()
  renderer.render(scene, camera)
}

const setupDragControls = () => {
  if (!scene || !camera || !renderer || !palletGroup) return

  if (dragControls) {
    dragControls.dispose()
    dragControls = null
  }

  const objects: THREE.Object3D[] = [palletGroup]
  dragControls = new DragControls(objects, camera, renderer.domElement)

  dragControls.addEventListener('dragstart', () => {
    if (controls) controls.enabled = false
  })

  dragControls.addEventListener('drag', (event: any) => {
    const obj = event.object as THREE.Object3D
    // Giữ pallet trên mặt phẳng ground
    obj.position.y = 0
    obj.position.z = 0
  })

  dragControls.addEventListener('dragend', () => {
    if (controls) controls.enabled = true
    // Lưu lại priority theo vị trí X hiện tại của pallet
    if (selectedItem.value && palletGroup) {
      palletLayouts.value[selectedItem.value.palletId] = palletGroup.position.x
    }
  })
}

watch(selectedItem, () => {
  renderScene()
})

onMounted(() => {
  loadApprovalData()
  window.addEventListener('resize', onResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  if (dragControls) {
    dragControls.dispose()
    dragControls = null
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

    const res = await inboundApi.optimizeInboundLayout(receiptId.value, payload)
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
    // Nếu đã có layout tối ưu gần nhất thì ưu tiên dùng, ngược lại lấy từ vị trí kéo thả hiện tại
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

    const payload = layouts.length
      ? { preferredLayouts: layouts, forceUsePreferredLayout: true }
      : undefined

    const res = await inboundApi.approveInboundRequest(receiptId.value, payload)
    if (res.statusCode === 200 || res.code === 0) {
      ElMessage.success('Duyệt yêu cầu nhập kho thành công')
      router.push({
        path: `/warehouse/${approvalData.value.warehouseId}/3d-view`
      })
    } else {
      ElMessage.error(res.message || 'Không thể duyệt yêu cầu')
    }
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
            <ElButton type="primary" :loading="approving" @click="handleApprove">
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

          <div ref="canvasContainer" class="canvas-container" v-loading="loading"></div>
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
              {{ selectedItem.itemLength }} × {{ selectedItem.itemWidth }} ×
              {{ selectedItem.itemHeight }} m
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

.canvas-container {
  width: 100%;
  height: 520px;
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

.detail-empty {
  font-size: 13px;
  color: #909399;
}
</style>
