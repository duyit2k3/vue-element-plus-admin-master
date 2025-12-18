<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import {
  ElCard,
  ElForm,
  ElFormItem,
  ElSelect,
  ElOption,
  ElButton,
  ElTable,
  ElTableColumn,
  ElMessage
} from 'element-plus'
import { Icon } from '@/components/Icon'
import warehouseApi, { type WarehouseListItem } from '@/api/warehouse'
import outboundApi, { type OutboundPickingProgressItem } from '@/api/outbound'
import { useUserStore } from '@/store/modules/user'
import { useRoute, useRouter } from 'vue-router'

const userStore = useUserStore()
const route = useRoute()
const router = useRouter()

const userRole = computed(() => userStore.getUserInfo?.role?.toLowerCase() || '')
const isWarehouseOwner = computed(() => userRole.value === 'warehouse_owner')
const canAccessPage = computed(() => userRole.value === 'warehouse_owner')

const warehouses = ref<WarehouseListItem[]>([])
const selectedWarehouseKey = ref<string | undefined>(undefined)
const selectedWarehouseId = ref<number | undefined>(undefined)
const loadingWarehouses = ref(false)

const pickingRequests = ref<OutboundPickingProgressItem[]>([])
const loadingPickingRequests = ref(false)

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

      if (userRole.value === 'customer' || userRole.value === 'warehouse_owner') {
        const map = new Map<number, WarehouseListItem>()
        warehouses.value.forEach((w) => {
          if (!map.has(w.warehouseId)) {
            map.set(w.warehouseId, w)
          }
        })
        warehouses.value = Array.from(map.values())
      }

      if (!selectedWarehouseKey.value && warehouses.value.length > 0) {
        const qId = route.query.warehouseId ? Number(route.query.warehouseId) : undefined
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

const viewOutboundDetail = (row: OutboundPickingProgressItem) => {
  if (!row.receiptId) return
  router.push({
    path: `/warehouse/outbound-request/${row.receiptId}/detail`,
    query: selectedWarehouseId.value
      ? { warehouseId: String(selectedWarehouseId.value) }
      : undefined
  })
}

const continuePicking3D = (row: OutboundPickingProgressItem) => {
  if (!row.receiptId) return
  router.push({
    name: 'WarehouseOutbound3DApproval',
    params: {
      id: selectedWarehouseId.value || row.warehouseId,
      receiptId: row.receiptId
    }
  })
}

const loadPickingRequests = async () => {
  loadingPickingRequests.value = true
  try {
    const params: { warehouseId?: number } = {}
    if (selectedWarehouseId.value) {
      params.warehouseId = selectedWarehouseId.value
    }
    const res = await outboundApi.getOutboundPickingRequests(params)
    if (res && (res.statusCode === 200 || res.code === 0)) {
      pickingRequests.value = (res.data || []) as OutboundPickingProgressItem[]
    }
  } catch {
    ElMessage.error('Không thể tải danh sách phiếu xuất đang lấy hàng')
  } finally {
    loadingPickingRequests.value = false
  }
}

const onWarehouseChange = () => {
  syncSelectedWarehouse()
  void loadPickingRequests()
}

const hasData = computed(() => pickingRequests.value.length > 0)

watch(
  () => selectedWarehouseKey.value,
  () => {
    syncSelectedWarehouse()
  }
)

onMounted(async () => {
  if (!canAccessPage.value) {
    ElMessage.error('Bạn không có quyền truy cập trang này')
    router.replace('/warehouse/overview')
    return
  }

  await loadWarehouses()

  if (selectedWarehouseId.value) {
    router.replace({
      name: 'WarehouseOutbound3DApproval',
      params: {
        id: selectedWarehouseId.value
      }
    })
    return
  }

  ElMessage.error('Không tìm thấy kho phù hợp để mở 3D outbound')
})
</script>

<template>
  <div class="outbound-picking-list">
    <ElCard class="mb-20px" shadow="hover">
      <template #header>
        <div class="card-header">
          <span class="text-lg font-bold">Lọc Theo Kho</span>
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
      </ElForm>
    </ElCard>

    <ElCard shadow="hover">
      <template #header>
        <div class="card-header">
          <span class="text-lg font-bold">Phiếu Xuất Đang Lấy Hàng</span>
          <ElButton
            text
            type="primary"
            :loading="loadingPickingRequests"
            @click="loadPickingRequests"
          >
            <Icon icon="vi-ep:refresh" />
            Làm mới
          </ElButton>
        </div>
      </template>

      <ElTable
        v-if="hasData"
        :data="pickingRequests"
        border
        size="small"
        v-loading="loadingPickingRequests"
      >
        <ElTableColumn label="Thao tác" width="260">
          <template #default="{ row }">
            <ElButton type="primary" text size="small" @click="viewOutboundDetail(row)">
              <Icon icon="vi-ant-design:profile-outlined" />
              Xem chi tiết
            </ElButton>
            <ElButton
              v-if="isWarehouseOwner"
              type="success"
              size="small"
              class="ml-5"
              @click="continuePicking3D(row)"
            >
              <Icon icon="vi-ant-design:deployment-unit-outlined" />
              Tiếp tục lấy hàng (3D)
            </ElButton>
          </template>
        </ElTableColumn>
        <ElTableColumn prop="receiptNumber" label="Mã phiếu" width="180" />
        <ElTableColumn prop="warehouseName" label="Kho" min-width="200" />
        <ElTableColumn prop="customerName" label="Khách hàng" min-width="200" />
        <ElTableColumn prop="createdAt" label="Ngày tạo yêu cầu" width="180" />
        <ElTableColumn prop="outboundDate" label="Ngày xuất thực tế" width="180" />
        <ElTableColumn prop="totalItems" label="Tổng số lượng" width="140" />
        <ElTableColumn label="Tiến độ pallet" width="180">
          <template #default="{ row }">
            <span>{{ row.pickedPallets }}/{{ row.totalPallets }} pallet</span>
          </template>
        </ElTableColumn>
        <ElTableColumn prop="status" label="Trạng thái" width="140" />
        <ElTableColumn label="Lý do / Ghi chú" min-width="260">
          <template #default="{ row }">
            <span v-if="row.notes">{{ row.notes }}</span>
            <span v-else class="text-gray">—</span>
          </template>
        </ElTableColumn>
        <ElTableColumn prop="createdByName" label="Người tạo" min-width="200" />
      </ElTable>
      <div v-else class="text-gray text-sm">Chưa có phiếu xuất nào đang lấy hàng.</div>
    </ElCard>
  </div>
</template>

<style scoped lang="less">
.outbound-picking-list {
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
