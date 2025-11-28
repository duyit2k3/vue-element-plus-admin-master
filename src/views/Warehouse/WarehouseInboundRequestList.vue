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
  ElMessage
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
const loadingWarehouses = ref(false)
const inboundRequests = ref<InboundRequestListItem[]>([])
const loadingInboundRequests = ref(false)

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
      if (!selectedWarehouseId.value && warehouses.value.length > 0) {
        const qId = route.query.warehouseId ? Number(route.query.warehouseId) : undefined
        if (qId) {
          const matched = warehouses.value.find((w) => w.warehouseId === qId)
          if (matched) {
            selectedWarehouseId.value = matched.warehouseId
          }
        }
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

const loadInboundRequests = async () => {
  loadingInboundRequests.value = true
  try {
    const params: { warehouseId?: number } = {}
    if (selectedWarehouseId.value) {
      params.warehouseId = selectedWarehouseId.value
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

watch(
  () => selectedWarehouseId.value,
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
            v-model="selectedWarehouseId"
            placeholder="Chọn kho đã thuê"
            :loading="loadingWarehouses"
            filterable
            clearable
          >
            <ElOption
              v-for="w in warehouses"
              :key="w.warehouseId"
              :label="w.warehouseName || `Kho #${w.warehouseId}`"
              :value="w.warehouseId"
            />
          </ElSelect>
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
        v-if="inboundRequests.length"
        :data="inboundRequests"
        border
        size="small"
        v-loading="loadingInboundRequests"
      >
        <ElTableColumn prop="receiptNumber" label="Mã phiếu" width="180" />
        <ElTableColumn prop="warehouseName" label="Kho" min-width="200" />
        <ElTableColumn prop="inboundDate" label="Ngày yêu cầu" width="160" />
        <ElTableColumn prop="status" label="Trạng thái" width="120" />
        <ElTableColumn prop="totalItems" label="Số hàng" width="100" />
        <ElTableColumn prop="totalPallets" label="Số pallet" width="110" />
        <ElTableColumn prop="createdByName" label="Người tạo" min-width="180" />
        <ElTableColumn v-if="isWarehouseOwner" label="Thao tác" width="160">
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
