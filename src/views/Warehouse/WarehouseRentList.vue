<script setup lang="ts">
import { reactive, onMounted, unref } from 'vue'
import { ContentWrap } from '@/components/ContentWrap'
import { Table } from '@/components/Table'
import { ElButton } from 'element-plus'
import { Icon } from '@/components/Icon'
import { useRouter } from 'vue-router'
import warehouseApi, { type WarehouseListItem } from '@/api/warehouse'
import { useTable } from '@/hooks/web/useTable'
import type { TableColumn } from '@/components/Table/src/types'

const { push } = useRouter()

// Cột hiển thị danh sách kho để thuê
const columns = reactive<TableColumn[]>([
  {
    field: 'warehouseId',
    label: 'ID',
    width: '80px'
  },
  {
    field: 'warehouseName',
    label: 'Tên Kho',
    minWidth: '220px'
  },
  {
    field: 'ownerName',
    label: 'Chủ Kho',
    minWidth: '180px'
  },
  {
    field: 'size',
    label: 'Kích Thước (m)',
    minWidth: '160px'
  },
  {
    field: 'warehouseType',
    label: 'Loại Kho',
    minWidth: '120px'
  },
  {
    field: 'status',
    label: 'Trạng Thái',
    width: '120px'
  },
  {
    field: 'action',
    label: 'Thao Tác',
    width: '200px'
  }
])

const { tableRegister, tableState, tableMethods } = useTable({
  fetchDataApi: async () => {
    // Trang Thuê kho: chỉ hiển thị các kho đang cho thuê (is_rentable = 0)
    const res: any = await warehouseApi.getAllWarehouses()
    if (res.statusCode === 200 || res.code === 0) {
      const all = (res.data || []) as WarehouseListItem[]
      const rentable = all.filter((w) => w.isRentable === false)
      return {
        list: rentable,
        total: rentable.length
      }
    }
    return { list: [], total: 0 }
  }
})

const { dataList, loading } = tableState
const { getList } = tableMethods

const viewDetail = (row: WarehouseListItem) => {
  push(`/warehouse/${row.warehouseId}/detail`)
}

const view3D = (row: WarehouseListItem) => {
  push(`/warehouse/${row.warehouseId}/3d-view`)
}

const sizeFormatter = (row: WarehouseListItem) => {
  return `${row.length} × ${row.width} × ${row.height}`
}

onMounted(() => {
  getList()
})
</script>

<template>
  <ContentWrap
    title="Thuê Kho"
    :message="'Danh sách tất cả kho đang có trong hệ thống. Thông tin địa điểm tạm thời lấy theo tên kho (ví dụ: Quận / Khu vực).'"
  >
    <Table
      :columns="columns"
      :data="dataList"
      :loading="loading"
      :pagination="{
        total: unref(tableState.total),
        currentPage: unref(tableState.currentPage),
        pageSize: unref(tableState.pageSize)
      }"
      @register="tableRegister"
    >
      <template #warehouseName="{ row }">
        <div class="flex items-center">
          <Icon icon="vi-ant-design:environment-outlined" class="mr-5px" />
          <span class="font-bold">{{ row.warehouseName || 'Chưa đặt tên' }}</span>
        </div>
      </template>

      <template #size="{ row }">
        <span>{{ sizeFormatter(row) }}</span>
      </template>

      <template #status="{ row }">
        <span>{{ row.status || 'N/A' }}</span>
      </template>

      <template #action="{ row }">
        <div class="flex gap-5px">
          <ElButton size="small" type="primary" @click="viewDetail(row)">
            <Icon icon="vi-ant-design:eye-outlined" />
            Chi Tiết
          </ElButton>
          <ElButton size="small" type="success" @click="view3D(row)">
            <Icon icon="vi-ant-design:deployment-unit-outlined" />
            Xem 3D
          </ElButton>
        </div>
      </template>
    </Table>
  </ContentWrap>
</template>

<style scoped lang="less">
.flex {
  display: flex;
}

.items-center {
  align-items: center;
}

.gap-5px {
  gap: 5px;
}

.mr-5px {
  margin-right: 5px;
}

.font-bold {
  font-weight: bold;
}
</style>
