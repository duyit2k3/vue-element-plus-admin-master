<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import {
  ElCard,
  ElForm,
  ElFormItem,
  ElSelect,
  ElOption,
  ElInput,
  ElTable,
  ElTableColumn,
  ElInputNumber,
  ElButton,
  ElMessage
} from 'element-plus'
import { Icon } from '@/components/Icon'
import warehouseApi, { type WarehouseListItem } from '@/api/warehouse'
import outboundApi, {
  type OutboundAvailablePallet,
  type CreateOutboundRequestRequest
} from '@/api/outbound'
import { useUserStore } from '@/store/modules/user'
import { useRoute } from 'vue-router'

const userStore = useUserStore()
const route = useRoute()

const userRole = computed(() => userStore.getUserInfo?.role?.toLowerCase() || '')

const queryWarehouseId = computed(() => {
  const raw = route.query.warehouseId
  if (!raw) return undefined
  const n = Array.isArray(raw) ? Number(raw[0]) : Number(raw)
  return Number.isFinite(n) && n > 0 ? n : undefined
})

// Warehouses
const warehouses = ref<WarehouseListItem[]>([])
const selectedWarehouseKey = ref<string | undefined>(undefined)
const selectedWarehouseId = ref<number | undefined>(undefined)
const loadingWarehouses = ref(false)

const syncSelectedWarehouse = () => {
  if (!selectedWarehouseKey.value) {
    selectedWarehouseId.value = undefined
    return
  }
  const [widStr] = selectedWarehouseKey.value.split(':')
  const wid = Number(widStr)
  selectedWarehouseId.value = Number.isFinite(wid) ? wid : undefined
}

const loadWarehouses = async () => {
  loadingWarehouses.value = true
  try {
    const userInfo = userStore.getUserInfo
    if (!userInfo) return

    let res: any
    if (userRole.value === 'customer') {
      res = await (warehouseApi as any).getWarehousesByCustomer(userInfo.accountId!)
    } else if (userRole.value === 'warehouse_owner') {
      res = await warehouseApi.getWarehousesByOwner(userInfo.accountId!)
    } else {
      res = await warehouseApi.getAllWarehouses()
    }

    if (res && (res.statusCode === 200 || res.code === 0)) {
      warehouses.value = (res.data || []) as WarehouseListItem[]

      if (userRole.value === 'customer') {
        const map = new Map<number, WarehouseListItem>()
        warehouses.value.forEach((w) => {
          if (!map.has(w.warehouseId)) {
            map.set(w.warehouseId, w)
          }
        })
        warehouses.value = Array.from(map.values())
      }

      if (!selectedWarehouseKey.value && warehouses.value.length > 0) {
        const qId = queryWarehouseId.value
        const matched = qId ? warehouses.value.find((w) => w.warehouseId === qId) : undefined
        const first = matched ?? warehouses.value[0]
        selectedWarehouseKey.value = `${first.warehouseId}:${first.zoneId ?? 0}`
        syncSelectedWarehouse()
      } else {
        syncSelectedWarehouse()
      }
    }
  } catch {
    ElMessage.error('Không thể tải danh sách kho')
  } finally {
    loadingWarehouses.value = false
  }
}

// Available pallets / items
interface OutboundRow extends OutboundAvailablePallet {
  exportQuantity: number
}

const availableRows = ref<OutboundRow[]>([])
const loadingAvailable = ref(false)
const searchText = ref('')
const notes = ref('')

const filteredRows = computed(() => {
  const keyword = searchText.value.trim().toLowerCase()
  if (!keyword) return availableRows.value
  return availableRows.value.filter((r) => {
    const name = (r.productName || r.itemName || '').toLowerCase()
    const code = (r.productCode || '').toLowerCase()
    return name.includes(keyword) || code.includes(keyword)
  })
})

const clampExportQuantity = (row: OutboundRow) => {
  let v = Number(row.exportQuantity || 0)
  if (!Number.isFinite(v) || v < 0) {
    row.exportQuantity = 0
    return
  }
  v = Math.floor(v)
  if (v > row.totalQuantity) {
    v = row.totalQuantity
  }
  row.exportQuantity = v
}

const loadAvailablePallets = async () => {
  if (!selectedWarehouseId.value) {
    availableRows.value = []
    return
  }
  loadingAvailable.value = true
  try {
    const res = await outboundApi.getAvailablePallets({ warehouseId: selectedWarehouseId.value })
    if (res && (res.statusCode === 200 || res.code === 0)) {
      const data = (res.data || []) as OutboundAvailablePallet[]
      availableRows.value = data.map((x) => ({ ...x, exportQuantity: 0 }))
    }
  } catch {
    ElMessage.error('Không thể tải danh sách hàng hóa khả dụng để xuất kho')
  } finally {
    loadingAvailable.value = false
  }
}

const refreshAll = async () => {
  await loadWarehouses()
  await loadAvailablePallets()
}

const onWarehouseChange = () => {
  syncSelectedWarehouse()
  void loadAvailablePallets()
}

const totalSelectedQuantity = computed(() => {
  return availableRows.value.reduce((sum, r) => sum + (r.exportQuantity || 0), 0)
})

const submitRequest = async () => {
  if (!selectedWarehouseId.value) {
    ElMessage.error('Vui lòng chọn kho')
    return
  }

  const byItem: Record<number, { requested: number; available: number }> = {}

  for (const row of availableRows.value) {
    const qty = Number(row.exportQuantity || 0)
    if (!qty) continue

    if (!byItem[row.itemId]) {
      byItem[row.itemId] = {
        requested: 0,
        available: row.totalQuantity
      }
    }
    byItem[row.itemId].requested += qty
  }

  const entries = Object.entries(byItem)
  if (!entries.length) {
    ElMessage.error('Vui lòng nhập số lượng xuất cho ít nhất một hàng hóa')
    return
  }

  for (const [itemId, info] of entries) {
    if (info.requested > info.available) {
      ElMessage.error(
        `Số lượng yêu cầu xuất cho Item #${itemId} vượt quá tồn khả dụng (${info.available})`
      )
      return
    }
  }

  const payload: CreateOutboundRequestRequest = {
    warehouseId: selectedWarehouseId.value,
    items: entries.map(([itemId, info]) => ({
      itemId: Number(itemId),
      quantity: info.requested
    })),
    notes: notes.value || undefined
  }

  try {
    const res = await outboundApi.createOutboundRequest(payload)
    if (res && (res.statusCode === 201 || res.statusCode === 200 || res.code === 0)) {
      const data: any = res.data || {}
      ElMessage.success(
        `Tạo yêu cầu xuất kho thành công. Mã phiếu: ${
          data.receiptNumber || data.ReceiptNumber || ''
        }`
      )
      availableRows.value.forEach((r) => {
        r.exportQuantity = 0
      })
      notes.value = ''
      void loadAvailablePallets()
    }
  } catch (error: any) {
    ElMessage.error(error?.message || 'Lỗi khi tạo yêu cầu xuất kho')
  }
}

onMounted(async () => {
  await loadWarehouses()
  await loadAvailablePallets()
})
</script>

<template>
  <div class="outbound-request">
    <ElCard class="mb-20px" shadow="hover">
      <template #header>
        <div class="card-header">
          <span class="text-lg font-bold">Tạo Yêu Cầu Xuất Kho</span>
          <ElButton text type="primary" @click="refreshAll">
            <Icon icon="vi-ep:refresh" />
            Làm mới
          </ElButton>
        </div>
      </template>

      <ElForm label-width="140px">
        <ElFormItem label="Kho">
          <ElSelect
            v-model="selectedWarehouseKey"
            placeholder="Chọn kho"
            :loading="loadingWarehouses"
            filterable
            clearable
            @change="onWarehouseChange"
          >
            <ElOption
              v-for="w in warehouses"
              :key="w.zoneId ?? w.warehouseId"
              :label="w.warehouseName || `Kho #${w.warehouseId}`"
              :value="`${w.warehouseId}:${w.zoneId ?? 0}`"
            />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="Ghi chú">
          <ElInput v-model="notes" type="textarea" :rows="2" placeholder="Ghi chú (tuỳ chọn)" />
        </ElFormItem>
      </ElForm>
    </ElCard>

    <ElCard shadow="hover">
      <template #header>
        <div class="card-header">
          <span class="text-lg font-bold">Danh Sách Hàng Hóa Khả Dụng</span>
          <div class="flex items-center gap-10">
            <ElInput
              v-model="searchText"
              placeholder="Tìm theo tên hoặc mã sản phẩm"
              clearable
              style="width: 260px"
            />
            <span class="text-sm text-gray">
              Tổng số lượng yêu cầu xuất: <strong>{{ totalSelectedQuantity }}</strong>
            </span>
            <ElButton type="primary" @click="submitRequest">
              <Icon icon="vi-ant-design:upload-outlined" />
              Gửi Yêu Cầu Xuất Kho
            </ElButton>
          </div>
        </div>
      </template>

      <ElTable
        v-if="filteredRows.length"
        :data="filteredRows"
        border
        size="small"
        v-loading="loadingAvailable"
      >
        <ElTableColumn prop="productCode" label="Mã SP" width="140" />
        <ElTableColumn label="Tên hàng" min-width="200">
          <template #default="{ row }">
            {{ row.productName || row.itemName }}
          </template>
        </ElTableColumn>
        <ElTableColumn label="Ngày sx - Hạn sd" width="220">
          <template #default="{ row }">
            <div class="text-sm">
              <span>
                {{ row.manufacturingDate ? row.manufacturingDate.slice(0, 10) : '-' }}
                -
                {{ row.expiryDate ? row.expiryDate.slice(0, 10) : '-' }}
              </span>
            </div>
          </template>
        </ElTableColumn>
        <ElTableColumn prop="unit" label="Đơn vị" width="100" />
        <ElTableColumn prop="firstInboundDate" label="Ngày nhập đầu tiên" width="180" sortable />
        <ElTableColumn prop="totalQuantity" label="Tồn khả dụng" width="140" sortable />
        <ElTableColumn label="Số lượng xuất" width="160">
          <template #default="{ row }">
            <ElInputNumber
              v-model="row.exportQuantity"
              :min="0"
              :max="row.totalQuantity"
              :step="1"
              :precision="0"
              @change="clampExportQuantity(row)"
              controls-position="right"
            />
          </template>
        </ElTableColumn>
      </ElTable>
      <div v-else class="text-gray text-sm">
        Chưa có hàng hóa nào khả dụng để xuất kho trong kho được chọn.
      </div>
    </ElCard>
  </div>
</template>

<style scoped lang="less">
.outbound-request {
  padding: 20px;
}

.mb-20px {
  margin-bottom: 20px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.text-lg {
  font-size: 18px;
}

.font-bold {
  font-weight: bold;
}

.flex {
  display: flex;
}

.items-center {
  align-items: center;
}

.gap-10 {
  gap: 10px;
}

.text-sm {
  font-size: 14px;
}

.text-gray {
  color: #909399;
}
</style>
