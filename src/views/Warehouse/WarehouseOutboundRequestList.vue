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
  ElMessage,
  ElMessageBox
} from 'element-plus'
import { Icon } from '@/components/Icon'
import warehouseApi, { type WarehouseListItem } from '@/api/warehouse'
import outboundApi, { type OutboundRequestListItem } from '@/api/outbound'
import { useUserStore } from '@/store/modules/user'
import { useRoute, useRouter } from 'vue-router'

const userStore = useUserStore()
const route = useRoute()
const router = useRouter()

const userRole = computed(() => userStore.getUserInfo?.role?.toLowerCase() || '')
const isCustomer = computed(() => userRole.value === 'customer')
const isWarehouseOwner = computed(() => userRole.value === 'warehouse_owner')

const warehouses = ref<WarehouseListItem[]>([])
const selectedWarehouseKey = ref<string | undefined>(undefined)
const selectedWarehouseId = ref<number | undefined>(undefined)
const loadingWarehouses = ref(false)

const outboundRequests = ref<OutboundRequestListItem[]>([])
const loadingOutboundRequests = ref(false)

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
        if (matched) {
          selectedWarehouseKey.value = `${matched.warehouseId}:${matched.zoneId ?? 0}`
        } else {
          // Không preselect nếu không có warehouseId trên query → để lọc trống ban đầu
          selectedWarehouseKey.value = undefined
        }
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

const viewOutboundDetail = (row: OutboundRequestListItem) => {
  if (!row.receiptId) return
  router.push({
    path: `/warehouse/outbound-request/${row.receiptId}/detail`,
    query: selectedWarehouseId.value
      ? { warehouseId: String(selectedWarehouseId.value) }
      : undefined
  })
}

const viewOutboundReceipt = async (row: OutboundRequestListItem) => {
  if (!row.receiptId) {
    ElMessage.warning('Thiếu thông tin phiếu xuất để xuất PDF')
    return
  }

  try {
    const res: any = await (outboundApi as any).exportOutboundReceiptPdf(row.receiptId)
    const blob: Blob | null = res && res.data instanceof Blob ? (res.data as Blob) : null

    if (!blob) {
      ElMessage.error('Dữ liệu phiếu xuất PDF không hợp lệ')
      return
    }

    const fileURL = URL.createObjectURL(blob)
    const win = window.open(fileURL, '_blank')
    if (!win) {
      ElMessage.warning('Trình duyệt chặn cửa sổ mới, vui lòng cho phép popup để xem PDF')
    }

    // Giải phóng URL tạm sau một thời gian
    setTimeout(() => {
      URL.revokeObjectURL(fileURL)
    }, 60 * 1000)
  } catch {
    ElMessage.error('Không thể tải phiếu xuất PDF')
  }
}

const handleCancel = async (row: OutboundRequestListItem) => {
  if (!row.receiptId) return

  const status = (row.status || '').toLowerCase()
  if (status !== 'pending') {
    ElMessage.warning('Chỉ có thể hủy yêu cầu ở trạng thái pending')
    return
  }

  try {
    const { value, action } = await ElMessageBox.prompt(
      'Nhập lý do hủy yêu cầu này',
      'Hủy yêu cầu xuất kho',
      {
        confirmButtonText: 'Hủy yêu cầu',
        cancelButtonText: 'Đóng',
        type: 'warning',
        inputPlaceholder: 'Ví dụ: Đã tạo nhầm, không còn nhu cầu xuất ...',
        inputType: 'textarea',
        inputValidator: (val: string) => {
          if (!val || !val.trim()) return 'Vui lòng nhập lý do hủy'
          return true
        }
      }
    )

    if (action !== 'confirm') return

    await outboundApi.updateOutboundRequestStatus(row.receiptId, {
      status: 'cancelled',
      notes: value.trim()
    })

    ElMessage.success('Đã hủy yêu cầu xuất kho')
    await loadOutboundRequests()
  } catch (error: any) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error('Không thể hủy yêu cầu, vui lòng thử lại')
  }
}

const handleApprove = async (row: OutboundRequestListItem) => {
  if (!row.receiptId) return

  const status = (row.status || '').toLowerCase()
  if (status !== 'pending') {
    ElMessage.warning('Chỉ có thể duyệt yêu cầu ở trạng thái pending')
    return
  }

  try {
    await ElMessageBox.confirm('Xác nhận duyệt yêu cầu xuất kho này?', 'Duyệt yêu cầu', {
      confirmButtonText: 'Duyệt',
      cancelButtonText: 'Hủy',
      type: 'warning'
    })

    await outboundApi.updateOutboundRequestStatus(row.receiptId, {
      status: 'completed'
    })

    ElMessage.success('Đã duyệt yêu cầu xuất kho')
    router.push({
      name: 'WarehouseOutbound3DApproval',
      params: {
        id: selectedWarehouseId.value || row.warehouseId
      },
      query: {
        receiptId: row.receiptId
      }
    })
  } catch (error: any) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error('Không thể duyệt yêu cầu, vui lòng thử lại')
  }
}

const handleReject = async (row: OutboundRequestListItem) => {
  if (!row.receiptId) return

  const status = (row.status || '').toLowerCase()
  if (status !== 'pending') {
    ElMessage.warning('Chỉ có thể từ chối yêu cầu ở trạng thái pending')
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
        inputPlaceholder: 'Ví dụ: Thông tin chưa chính xác, không đủ hàng tồn kho ...',
        inputType: 'textarea',
        inputValidator: (val: string) => {
          if (!val || !val.trim()) return 'Vui lòng nhập lý do từ chối'
          return true
        }
      }
    )

    if (action !== 'confirm') return

    await outboundApi.updateOutboundRequestStatus(row.receiptId, {
      status: 'cancelled',
      notes: value.trim()
    })

    ElMessage.success('Đã từ chối yêu cầu xuất kho')
    await loadOutboundRequests()
  } catch (error: any) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error('Không thể từ chối yêu cầu, vui lòng thử lại')
  }
}

const loadOutboundRequests = async () => {
  loadingOutboundRequests.value = true
  try {
    const params: { warehouseId?: number } = {}
    if (selectedWarehouseId.value) {
      params.warehouseId = selectedWarehouseId.value
    }
    const res = await outboundApi.getOutboundRequests(params)
    if (res && (res.statusCode === 200 || res.code === 0)) {
      outboundRequests.value = (res.data || []) as OutboundRequestListItem[]
    }
  } catch {
    ElMessage.error('Không thể tải danh sách yêu cầu xuất kho')
  } finally {
    loadingOutboundRequests.value = false
  }
}

const onWarehouseChange = () => {
  syncSelectedWarehouse()
  void loadOutboundRequests()
}

const hasData = computed(() => outboundRequests.value.length > 0)

watch(
  () => selectedWarehouseKey.value,
  () => {
    syncSelectedWarehouse()
  }
)

onMounted(() => {
  loadWarehouses()
  loadOutboundRequests()
})
</script>

<template>
  <div class="outbound-request-list">
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
          <span class="text-lg font-bold">Danh Sách Yêu Cầu Xuất Kho</span>
          <ElButton
            text
            type="primary"
            :loading="loadingOutboundRequests"
            @click="loadOutboundRequests"
          >
            <Icon icon="vi-ep:refresh" />
            Làm mới
          </ElButton>
        </div>
      </template>

      <ElTable
        v-if="hasData"
        :data="outboundRequests"
        border
        size="small"
        v-loading="loadingOutboundRequests"
      >
        <ElTableColumn label="Thao tác" width="260">
          <template #default="{ row }">
            <ElButton
              v-if="row.status && row.status.toLowerCase() === 'completed'"
              type="primary"
              text
              size="small"
              @click="viewOutboundReceipt(row)"
            >
              <Icon icon="vi-ant-design:file-pdf-outlined" />
              Xem phiếu xuất
            </ElButton>
            <ElButton v-else type="primary" text size="small" @click="viewOutboundDetail(row)">
              <Icon icon="vi-ant-design:profile-outlined" />
              Xem chi tiết
            </ElButton>
            <ElButton
              v-if="isCustomer && row.status && row.status.toLowerCase() === 'pending'"
              type="danger"
              text
              size="small"
              class="ml-5"
              @click="handleCancel(row)"
            >
              <Icon icon="vi-ant-design:stop-outlined" />
              Hủy
            </ElButton>
            <ElButton
              v-if="isWarehouseOwner && row.status && row.status.toLowerCase() === 'pending'"
              type="success"
              size="small"
              class="ml-5"
              @click="handleApprove(row)"
            >
              <Icon icon="vi-ant-design:check-circle-outlined" />
              Duyệt
            </ElButton>
            <ElButton
              v-if="isWarehouseOwner && row.status && row.status.toLowerCase() === 'pending'"
              type="danger"
              text
              size="small"
              class="ml-5"
              @click="handleReject(row)"
            >
              <Icon icon="vi-ant-design:close-circle-outlined" />
              Từ chối
            </ElButton>
          </template>
        </ElTableColumn>
        <ElTableColumn prop="receiptNumber" label="Mã phiếu" width="180" />
        <ElTableColumn prop="warehouseName" label="Kho" min-width="200" />
        <ElTableColumn prop="customerName" label="Khách hàng" min-width="200" />
        <ElTableColumn prop="createdAt" label="Ngày tạo yêu cầu" width="180" />
        <ElTableColumn prop="outboundDate" label="Ngày xuất thực tế" width="180" />
        <ElTableColumn prop="totalItems" label="Tổng số lượng" width="140" />
        <ElTableColumn prop="status" label="Trạng thái" width="140" />
        <ElTableColumn label="Lý do / Ghi chú" min-width="260">
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
        <ElTableColumn prop="createdByName" label="Người tạo" min-width="200" />
      </ElTable>
      <div v-else class="text-gray text-sm">Chưa có yêu cầu xuất kho nào.</div>
    </ElCard>
  </div>
</template>

<style scoped lang="less">
.outbound-request-list {
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

.text-main {
  color: #303133;
}

.text-sm {
  font-size: 14px;
}
</style>
