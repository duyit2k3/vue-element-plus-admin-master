<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed } from 'vue'
import { ContentWrap } from '@/components/ContentWrap'
import { ElButton, ElCard, ElMessage, ElInputNumber, ElInput, ElDialog } from 'element-plus'
import { Icon } from '@/components/Icon'
import { useRouter, useRoute } from 'vue-router'
import warehouseApi, {
  type Warehouse3DData,
  type RackDto,
  type BulkUpdateRackPositionsRequest
} from '@/api/warehouse'

const { push } = useRouter()
const route = useRoute()
const warehouseId = computed(() => Number(route.params.id))
const zoneId = computed(() => Number(route.params.zoneId))

const loading = ref(false)
const saving = ref(false)
const creating = ref(false)

const warehouseData = ref<Warehouse3DData | null>(null)
const racks = ref<RackDto[]>([])
const selectedRackId = ref<number | null>(null)

const zoneCanvasRef = ref<HTMLDivElement | null>(null)
const draggingRackId = ref<number | null>(null)
const dragStart = ref<{
  mouseX: number
  mouseY: number
  rackX: number
  rackZ: number
} | null>(null)
const gridSize = 0.5

// Canvas data (đơn giản: top-view 2D, dùng div + absolute positioning)
const zoneBounds = computed(() => {
  const zone = warehouseData.value?.zones.find((z) => z.zoneId === zoneId.value)
  if (!zone) return null
  return {
    x: zone.positionX,
    z: zone.positionZ,
    length: zone.length,
    width: zone.width
  }
})

const loadData = async () => {
  loading.value = true
  try {
    const [whRes, rackRes] = await Promise.all([
      warehouseApi.getWarehouse3DData(warehouseId.value),
      warehouseApi.getZoneRacks(zoneId.value)
    ])

    if (whRes.statusCode === 200 || whRes.code === 0) {
      warehouseData.value = whRes.data
    } else {
      ElMessage.error(whRes.message || 'Không thể tải dữ liệu kho')
    }

    if (rackRes.statusCode === 200 || rackRes.code === 0) {
      racks.value = rackRes.data || []
    } else {
      ElMessage.error(rackRes.message || 'Không thể tải danh sách kệ')
    }
  } catch (error) {
    ElMessage.error('Lỗi khi tải dữ liệu')
  } finally {
    loading.value = false
  }
}

const updateRackPositionFromDrag = (rack: RackDto, dxPixel: number, dzPixel: number) => {
  if (!zoneBounds.value || !dragStart.value) return

  const deltaXMeter = dxPixel / 10
  const deltaZMeter = dzPixel / 10

  let newX = dragStart.value.rackX + deltaXMeter
  let newZ = dragStart.value.rackZ + deltaZMeter

  newX = Math.round(newX / gridSize) * gridSize
  newZ = Math.round(newZ / gridSize) * gridSize

  const zb = zoneBounds.value
  const minX = zb.x
  const maxX = zb.x + zb.length - rack.length
  const minZ = zb.z
  const maxZ = zb.z + zb.width - rack.width

  if (newX < minX) newX = minX
  if (newX > maxX) newX = maxX
  if (newZ < minZ) newZ = minZ
  if (newZ > maxZ) newZ = maxZ

  rack.positionX = newX
  rack.positionZ = newZ
}

const handleMouseMove = (event: MouseEvent) => {
  if (!dragStart.value || draggingRackId.value == null) return
  const rack = racks.value.find((r) => r.rackId === draggingRackId.value)
  if (!rack) return

  const dx = event.clientX - dragStart.value.mouseX
  const dz = event.clientY - dragStart.value.mouseY

  updateRackPositionFromDrag(rack, dx, dz)
}

const stopDragging = () => {
  window.removeEventListener('mousemove', handleMouseMove)
  window.removeEventListener('mouseup', handleMouseUp)
  dragStart.value = null
  draggingRackId.value = null
}

const handleMouseUp = () => {
  if (!dragStart.value) return
  stopDragging()
}

const startRackDrag = (event: MouseEvent, rack: RackDto) => {
  if (!zoneBounds.value) return
  event.preventDefault()
  event.stopPropagation()

  draggingRackId.value = rack.rackId
  dragStart.value = {
    mouseX: event.clientX,
    mouseY: event.clientY,
    rackX: rack.positionX,
    rackZ: rack.positionZ
  }

  window.addEventListener('mousemove', handleMouseMove)
  window.addEventListener('mouseup', handleMouseUp)

  selectRack(rack.rackId)
}

onMounted(() => {
  loadData()
})

onBeforeUnmount(() => {
  stopDragging()
})

const goBack = () => {
  push(`/warehouse/${warehouseId.value}/zones`)
}

const openCreateDialog = () => {
  creating.value = true
}

const newRack = ref<{
  rackName: string
  length: number
  width: number
  height: number
}>({
  rackName: '',
  length: 4,
  width: 1.5,
  height: 6
})

const confirmCreateRack = async () => {
  if (!zoneBounds.value) return
  try {
    const centerX = zoneBounds.value.x + zoneBounds.value.length / 2 - newRack.value.length / 2
    const centerZ = zoneBounds.value.z + zoneBounds.value.width / 2 - newRack.value.width / 2

    const res = await warehouseApi.createRack(zoneId.value, {
      rackName: newRack.value.rackName,
      positionX: centerX,
      positionZ: centerZ,
      length: newRack.value.length,
      width: newRack.value.width,
      height: newRack.value.height,
      maxShelves: 4
    })

    if (res.statusCode === 201 || res.statusCode === 200 || res.code === 0) {
      ElMessage.success('Tạo kệ thành công')
      creating.value = false
      await loadData()
    } else {
      ElMessage.error(res.message || 'Không thể tạo kệ')
    }
  } catch (error) {
    ElMessage.error('Lỗi khi tạo kệ')
  }
}

const selectRack = (rackId: number) => {
  selectedRackId.value = rackId
}

const saveLayout = async () => {
  if (!zoneBounds.value) return
  saving.value = true
  try {
    const payload: BulkUpdateRackPositionsRequest = {
      racks: racks.value.map((r) => ({
        rackId: r.rackId,
        positionX: r.positionX,
        positionZ: r.positionZ
      }))
    }

    const res = await warehouseApi.bulkUpdateRackPositions(zoneId.value, payload)
    if (res.statusCode === 200 || res.code === 0) {
      ElMessage.success('Lưu bố trí kệ thành công')
      await loadData()
    } else {
      ElMessage.error(res.message || 'Không thể lưu bố trí kệ')
    }
  } catch (error) {
    ElMessage.error('Lỗi khi lưu bố trí kệ')
  } finally {
    saving.value = false
  }
}

const deleteSelectedRack = async () => {
  if (!selectedRackId.value) return
  try {
    const res = await warehouseApi.deleteRack(zoneId.value, selectedRackId.value)
    if (res.statusCode === 200 || res.code === 0) {
      ElMessage.success('Xóa kệ thành công')
      selectedRackId.value = null
      await loadData()
    } else {
      ElMessage.error(res.message || 'Không thể xóa kệ (có thể còn shelves hoặc pallet)')
    }
  } catch (error) {
    ElMessage.error('Lỗi khi xóa kệ')
  }
}
</script>

<template>
  <ContentWrap :title="`Quản Lý Kệ - Zone ${zoneId}`">
    <template #header>
      <ElButton type="primary" @click="goBack">
        <Icon icon="vi-ant-design:arrow-left-outlined" />
        Quay Lại Khu Vực
      </ElButton>
      <ElButton type="success" @click="openCreateDialog">
        <Icon icon="vi-ant-design:plus-square-outlined" />
        Thêm Kệ
      </ElButton>
      <ElButton type="primary" :loading="saving" @click="saveLayout">
        <Icon icon="vi-ep:checked" />
        Lưu Bố Trí Kệ
      </ElButton>
    </template>

    <div class="zone-racks" v-loading="loading">
      <div class="left-panel">
        <ElCard shadow="hover" class="mb-10">
          <template #header>
            <span class="font-bold">Thông tin Khu Vực</span>
          </template>
          <div v-if="warehouseData">
            <p>
              <strong>Kho:</strong>
              {{ warehouseData.warehouseName }}
            </p>
            <p v-if="zoneBounds">
              <strong>Kích thước zone (L×W):</strong>
              {{ zoneBounds.length }} × {{ zoneBounds.width }} m
            </p>
          </div>
        </ElCard>

        <ElCard shadow="hover">
          <template #header>
            <span class="font-bold">Danh sách Kệ</span>
          </template>
          <div v-if="racks.length">
            <div
              v-for="rack in racks"
              :key="rack.rackId"
              class="rack-item"
              :class="{ active: rack.rackId === selectedRackId }"
              @click="selectRack(rack.rackId)"
            >
              <div class="rack-name">
                <Icon icon="vi-ant-design:appstore-outlined" />
                <span>{{ rack.rackName || `Kệ #${rack.rackId}` }}</span>
              </div>
              <div class="rack-meta">
                <span>L×W: {{ rack.length }} × {{ rack.width }} m</span>
                <span>X,Z: {{ rack.positionX }}, {{ rack.positionZ }}</span>
              </div>
            </div>
          </div>
          <div v-else class="text-muted">Chưa có kệ nào trong khu vực này</div>

          <div class="mt-10" v-if="selectedRackId">
            <ElButton type="danger" @click="deleteSelectedRack">
              <Icon icon="vi-ep:delete" />
              Xóa Kệ Đang Chọn
            </ElButton>
          </div>
        </ElCard>
      </div>

      <div class="canvas-panel">
        <ElCard shadow="hover" class="full-height">
          <template #header>
            <span class="font-bold">Bố trí kệ (mặt bằng)</span>
          </template>
          <div class="canvas-container">
            <div v-if="zoneBounds" ref="zoneCanvasRef" class="zone-canvas">
              <div
                v-for="rack in racks"
                :key="rack.rackId"
                class="rack-block"
                :class="{ active: rack.rackId === selectedRackId }"
                :style="{
                  left: `${(rack.positionX - zoneBounds.x) * 10}px`,
                  top: `${(rack.positionZ - zoneBounds.z) * 10}px`,
                  width: `${rack.length * 10}px`,
                  height: `${rack.width * 10}px`
                }"
                @click.stop="selectRack(rack.rackId)"
                @mousedown.stop="startRackDrag($event, rack)"
              >
                <span>{{ rack.rackName || rack.rackId }}</span>
              </div>
            </div>
            <div v-else class="text-muted">Không tìm thấy thông tin zone</div>
          </div>
        </ElCard>
      </div>
    </div>

    <ElDialog v-model="creating" title="Thêm Kệ" width="400px">
      <div class="dialog-body">
        <div class="field-row">
          <span>Tên kệ</span>
          <ElInput v-model="newRack.rackName" placeholder="VD: Kệ A1" />
        </div>
        <div class="field-row">
          <span>Chiều dài (m)</span>
          <ElInputNumber v-model="newRack.length" :min="1" :step="0.5" />
        </div>
        <div class="field-row">
          <span>Chiều rộng (m)</span>
          <ElInputNumber v-model="newRack.width" :min="0.5" :step="0.5" />
        </div>
        <div class="field-row">
          <span>Chiều cao (m)</span>
          <ElInputNumber v-model="newRack.height" :min="1" :step="0.5" />
        </div>
      </div>
      <template #footer>
        <ElButton @click="creating = false">Hủy</ElButton>
        <ElButton type="primary" @click="confirmCreateRack">Tạo Kệ</ElButton>
      </template>
    </ElDialog>
  </ContentWrap>
</template>

<style scoped lang="less">
.zone-racks {
  display: flex;
  gap: 15px;
  height: calc(100vh - 220px);
}

.left-panel {
  display: flex;
  width: 320px;
  flex-shrink: 0;
  flex-direction: column;
  gap: 10px;
}

.canvas-panel {
  flex: 1;
}

.full-height {
  height: 100%;
}

.canvas-container {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: auto;
}

.zone-canvas {
  position: relative;
  width: 100%;
  height: 100%;
  background: #f5f7fa;
  border: 1px dashed #dcdfe6;
}

.rack-block {
  position: absolute;
  display: flex;
  font-size: 12px;
  color: #fff;
  cursor: pointer;
  background: rgb(64 158 255 / 60%);
  border: 1px solid #409eff;
  border-radius: 2px;
  align-items: center;
  justify-content: center;
}

.rack-block.active {
  background: rgb(245 108 108 / 70%);
  border-color: #f56c6c;
}

.rack-item {
  padding: 8px;
  margin-bottom: 6px;
  cursor: pointer;
  border: 1px solid #ebeef5;
  border-radius: 4px;
}

.rack-item.active {
  background: #ecf5ff;
  border-color: #409eff;
}

.rack-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
}

.rack-meta {
  display: flex;
  margin-top: 4px;
  font-size: 12px;
  color: #909399;
  justify-content: space-between;
}

.font-bold {
  font-weight: bold;
}

.text-muted {
  color: #909399;
}

.mb-10 {
  margin-bottom: 10px;
}

.dialog-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.field-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
</style>
