<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue'
import {
  ElCard,
  ElForm,
  ElFormItem,
  ElSelect,
  ElOption,
  ElButton,
  ElTable,
  ElTableColumn,
  ElMessage,
  ElMessageBox
} from 'element-plus'
import { Icon } from '@/components/Icon'
import warehouseApi, { type WarehouseListItem } from '@/api/warehouse'
import inboundApi, { type InboundRequestListItem } from '@/api/inbound'
import { useUserStore } from '@/store/modules/user'
import { useRoute, useRouter } from 'vue-router'

const userStore = useUserStore()
const route = useRoute()
const router = useRouter()

const userRole = computed(() => userStore.getUserInfo?.role?.toLowerCase() || '')
const isWarehouseOwner = computed(() => userRole.value === 'warehouse_owner')

const warehouses = ref<WarehouseListItem[]>([])
const selectedWarehouseId = ref<number | undefined>(undefined)
const selectedZoneId = ref<number | undefined>(undefined)
const selectedWarehouseKey = ref<string | undefined>(undefined)
const loadingWarehouses = ref(false)
const inboundRequests = ref<InboundRequestListItem[]>([])
const loadingInboundRequests = ref(false)

// Lọc trạng thái phiếu: pending (chờ duyệt), cancelled (đã từ chối), completed (đã duyệt)
const statusFilters = ref<string[]>(['pending', 'cancelled', 'completed'])

const effectiveStatusFilter = computed(() => {
  // Nếu chỉ chọn 1 trạng thái thì gửi lên backend; nếu nhiều hơn thì để backend trả tất cả và lọc ở FE
  if (statusFilters.value.length === 1) {
    return statusFilters.value[0]
  }
  if (statusFilters.value.length === 0) {
    // Nếu không chọn gì thì không lọc (xem như tất cả)
    return undefined
  }
  return undefined
})

const filteredInboundRequests = computed(() => {
  if (!inboundRequests.value.length) return []

  // Nếu chỉ chọn 0 hoặc 1 trạng thái thì đã xử lý bởi backend (hoặc không lọc) -> trả nguyên
  if (!statusFilters.value.length || statusFilters.value.length === 1) {
    return inboundRequests.value
  }

  const selectedSet = new Set(statusFilters.value.map((s) => s.toLowerCase()))
  return inboundRequests.value.filter((r) => {
    const st = (r.status || '').toLowerCase()
    return selectedSet.has(st)
  })
})

const loadWarehouses = async () => {
  loadingWarehouses.value = true
  try {
    const userInfo = userStore.getUserInfo
    if (!userInfo) {
      return
    }

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

      // Với warehouse_owner: mặc định không chọn kho để xem toàn bộ yêu cầu
      if (
        userRole.value !== 'warehouse_owner' &&
        !selectedWarehouseKey.value &&
        warehouses.value.length > 0
      ) {
        const qId = route.query.warehouseId ? Number(route.query.warehouseId) : undefined
        const matched = qId ? warehouses.value.find((w) => w.warehouseId === qId) : undefined
        const first = matched ?? warehouses.value[0]
        selectedWarehouseKey.value = `${first.warehouseId}:${first.zoneId ?? 0}`
      }
    }
  } catch (error) {
    ElMessage.error('Không thể tải danh sách kho')
  } finally {
    loadingWarehouses.value = false
  }
}

const approveInboundRequest = (row: InboundRequestListItem) => {
  if (row.status && row.status.toLowerCase() !== 'pending') {
    ElMessage.warning('Chỉ có thể duyệt phiếu ở trạng thái pending')
    return
  }

  router.push({
    path: `/warehouse/inbound-request/${row.receiptId}/approval`,
    query: {
      warehouseId: selectedWarehouseId.value ? String(selectedWarehouseId.value) : undefined
    }
  })
}

const handleReject = async (row: InboundRequestListItem) => {
  if (!row.receiptId) return

  if (!row.status || row.status.toLowerCase() !== 'pending') {
    ElMessage.warning('Chỉ có thể từ chối phiếu ở trạng thái pending')
    return
  }

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

    await inboundApi.updateInboundRequestStatus(row.receiptId, {
      status: 'cancelled',
      notes: value.trim()
    })

    ElMessage.success('Đã từ chối yêu cầu nhập kho')
    await loadInboundRequests()
  } catch (error: any) {
    // Bỏ qua nếu user hủy dialog
    if (error === 'cancel' || error === 'close') return
    ElMessage.error('Không thể từ chối yêu cầu, vui lòng thử lại')
  }
}

const loadInboundRequests = async () => {
  loadingInboundRequests.value = true
  try {
    const params: { warehouseId?: number; zoneId?: number; status?: string } = {}
    if (selectedWarehouseId.value) {
      params.warehouseId = selectedWarehouseId.value
    }
    if (selectedZoneId.value) {
      params.zoneId = selectedZoneId.value
    }
    if (effectiveStatusFilter.value) {
      params.status = effectiveStatusFilter.value
    }
    const res = await inboundApi.getInboundRequests(params)
    if (res && (res.statusCode === 200 || res.code === 0)) {
      inboundRequests.value = (res.data || []) as InboundRequestListItem[]
    }
  } catch (error) {
    ElMessage.error('Không thể tải danh sách yêu cầu nhập kho')
  } finally {
    loadingInboundRequests.value = false
  }
}

const syncSelectedWarehouse = () => {
  if (!selectedWarehouseKey.value) {
    selectedWarehouseId.value = undefined
    selectedZoneId.value = undefined
    return
  }

  const [widStr, zidStr] = selectedWarehouseKey.value.split(':')
  const wid = Number(widStr)
  const zid = Number(zidStr)

  selectedWarehouseId.value = Number.isFinite(wid) ? wid : undefined
  selectedZoneId.value = Number.isFinite(zid) && zid > 0 ? zid : undefined
}

watch(
  () => selectedWarehouseKey.value,
  () => {
    syncSelectedWarehouse()
    loadInboundRequests()
  }
)

watch(
  () => statusFilters.value.slice(),
  () => {
    loadInboundRequests()
  }
)

onMounted(() => {
  loadWarehouses()
  loadInboundRequests()
})
</script>

<template>
  <div class="inbound-request">
    <ElCard class="mb-20px" shadow="hover">
      <template #header>
        <div class="card-header">
          <span class="text-lg font-bold">Lọc theo kho</span>
        </div>
      </template>
      <ElForm label-width="140px">
        <ElFormItem label="Kho">
          <ElSelect
            v-model="selectedWarehouseKey"
            placeholder="Chọn kho đã thuê"
            :loading="loadingWarehouses"
            filterable
            clearable
          >
            <ElOption
              v-for="w in warehouses"
              :key="w.zoneId ?? w.warehouseId"
              :label="
                w.zoneName
                  ? `${w.warehouseName || `Kho #${w.warehouseId}`} - ${w.zoneName}`
                  : w.warehouseName || `Kho #${w.warehouseId}`
              "
              :value="`${w.warehouseId}:${w.zoneId ?? 0}`"
            />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="Trạng thái">
          <div class="status-filters">
            <label>
              <input v-model="statusFilters" type="checkbox" value="pending" />
              Chờ duyệt
            </label>
            <label>
              <input v-model="statusFilters" type="checkbox" value="cancelled" />
              Đã từ chối
            </label>
            <label>
              <input v-model="statusFilters" type="checkbox" value="completed" />
              Đã duyệt
            </label>
          </div>
        </ElFormItem>
      </ElForm>
    </ElCard>

    <ElCard class="mb-20px" shadow="hover">
      <template #header>
        <div class="card-header">
          <span class="text-lg font-bold">Danh sách yêu cầu nhập kho</span>
          <ElButton
            text
            type="primary"
            :loading="loadingInboundRequests"
            @click="loadInboundRequests"
          >
            <Icon icon="vi-ep:refresh" />
            Làm mới
          </ElButton>
        </div>
      </template>
      <ElTable
        v-if="filteredInboundRequests.length"
        :data="filteredInboundRequests"
        border
        size="small"
        v-loading="loadingInboundRequests"
      >
        <ElTableColumn prop="receiptNumber" label="Mã phiếu" width="180" />
        <ElTableColumn prop="warehouseName" label="Kho" min-width="180" />
        <ElTableColumn label="Khu vực" min-width="160">
          <template #default="{ row }">
            <span v-if="row.zoneName">
              {{ row.zoneName }}
              <span v-if="row.zoneId">(#{{ row.zoneId }})</span>
            </span>
            <span v-else-if="row.zoneId">Zone #{{ row.zoneId }}</span>
            <span v-else class="text-gray">—</span>
          </template>
        </ElTableColumn>
        <ElTableColumn prop="inboundDate" label="Ngày yêu cầu" width="160" />
        <ElTableColumn label="Kiểu xếp" width="120">
          <template #default="{ row }">
            <span v-if="row.stackMode && row.stackMode.toLowerCase() === 'manual'">Tự xếp</span>
            <span v-else>Hệ thống</span>
          </template>
        </ElTableColumn>
        <ElTableColumn prop="status" label="Trạng thái" width="120" />
        <ElTableColumn prop="totalItems" label="Số hàng" width="100" />
        <ElTableColumn prop="totalPallets" label="Số pallet" width="110" />
        <ElTableColumn label="Lý do / Ghi chú" min-width="240">
          <template #default="{ row }">
            <span
              v-if="row.notes"
              :style="
                row.status && row.status.toLowerCase() === 'cancelled' ? 'color: #f56c6c' : ''
              "
            >
              {{ row.notes }}
            </span>
            <span v-else class="text-gray">—</span>
          </template>
        </ElTableColumn>
        <ElTableColumn prop="createdByName" label="Người tạo" min-width="180" />
        <ElTableColumn v-if="isWarehouseOwner" label="Thao tác" width="220">
          <template #default="{ row }">
            <ElButton
              v-if="row.status && row.status.toLowerCase() === 'pending'"
              type="success"
              size="small"
              @click="approveInboundRequest(row)"
            >
              <Icon icon="vi-ant-design:check-circle-outlined" />
              Duyệt
            </ElButton>
            <ElButton
              v-if="row.status && row.status.toLowerCase() === 'pending'"
              type="danger"
              size="small"
              class="ml-5"
              @click="handleReject(row)"
            >
              <Icon icon="vi-ant-design:stop-outlined" />
              Từ chối
            </ElButton>
          </template>
        </ElTableColumn>
      </ElTable>
      <div v-else class="text-gray text-sm">Chưa có yêu cầu nhập kho nào.</div>
    </ElCard>
  </div>
</template>

<style scoped lang="less">
.inbound-request {
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

.text-gray {
  color: #909399;
}

.text-sm {
  font-size: 14px;
}
</style>
