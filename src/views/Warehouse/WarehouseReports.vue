<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { ContentWrap } from '@/components/ContentWrap'
import {
  ElCard,
  ElRow,
  ElCol,
  ElSelect,
  ElOption,
  ElDatePicker,
  ElButton,
  ElMessage
} from 'element-plus'
import { Icon } from '@/components/Icon'
import { Echart } from '@/components/Echart'
import { EChartsOption } from 'echarts'
import warehouseApi, { type WarehouseListItem } from '@/api/warehouse'
import { useUserStore } from '@/store/modules/user'

const userStore = useUserStore()
const loading = ref(true)
const warehouses = ref<WarehouseListItem[]>([])
const selectedWarehouseId = ref<number>()
const dateRange = ref<[Date, Date]>()

// Chart options
const warehouseUtilizationChart = computed<EChartsOption>(() => ({
  title: {
    text: 'Tỷ Lệ Sử Dụng Kho',
    left: 'center'
  },
  tooltip: {
    trigger: 'item',
    formatter: '{b}: {c}% ({d}%)'
  },
  legend: {
    orient: 'vertical',
    left: 'left'
  },
  series: [
    {
      name: 'Sử dụng',
      type: 'pie',
      radius: '50%',
      data: [
        { value: 65, name: 'Đã sử dụng' },
        { value: 35, name: 'Còn trống' }
      ],
      emphasis: {
        itemStyle: {
          shadowBlur: 10,
          shadowOffsetX: 0,
          shadowColor: 'rgba(0, 0, 0, 0.5)'
        }
      }
    }
  ]
}))

const itemDistributionChart = computed<EChartsOption>(() => ({
  title: {
    text: 'Phân Bổ Hàng Hóa Theo Kho',
    left: 'center'
  },
  tooltip: {
    trigger: 'axis',
    axisPointer: {
      type: 'shadow'
    }
  },
  xAxis: {
    type: 'category',
    data: warehouses.value.map((w) => w.warehouseName || `Kho ${w.warehouseId}`)
  },
  yAxis: {
    type: 'value',
    name: 'Số lượng'
  },
  series: [
    {
      name: 'Hàng hóa',
      type: 'bar',
      data: warehouses.value.map(() => Math.floor(Math.random() * 100)),
      itemStyle: {
        color: '#409EFF'
      }
    }
  ]
}))

const monthlyTrendChart = computed<EChartsOption>(() => ({
  title: {
    text: 'Xu Hướng Nhập/Xuất Kho Theo Tháng',
    left: 'center'
  },
  tooltip: {
    trigger: 'axis'
  },
  legend: {
    data: ['Nhập kho', 'Xuất kho'],
    bottom: 0
  },
  xAxis: {
    type: 'category',
    data: ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12']
  },
  yAxis: {
    type: 'value'
  },
  series: [
    {
      name: 'Nhập kho',
      type: 'line',
      smooth: true,
      data: [120, 132, 101, 134, 90, 230, 210, 182, 191, 234, 290, 330],
      itemStyle: { color: '#67C23A' }
    },
    {
      name: 'Xuất kho',
      type: 'line',
      smooth: true,
      data: [220, 182, 191, 234, 290, 330, 310, 123, 442, 321, 90, 149],
      itemStyle: { color: '#F56C6C' }
    }
  ]
}))

const loadWarehouses = async () => {
  loading.value = true
  try {
    const userInfo = userStore.getUserInfo
    const res =
      userInfo?.role === 'warehouse_owner'
        ? await warehouseApi.getWarehousesByOwner(userInfo.accountId!)
        : await warehouseApi.getAllWarehouses()

    if (res.statusCode === 200 || res.code === 0) {
      warehouses.value = res.data || []
    }
  } catch (error) {
    ElMessage.error('Không thể tải danh sách kho')
  } finally {
    loading.value = false
  }
}

const generateReport = () => {
  ElMessage.info('Đang tạo báo cáo...')
}

const exportReport = () => {
  ElMessage.info('Đang xuất báo cáo...')
}

onMounted(() => {
  loadWarehouses()
})
</script>

<template>
  <ContentWrap title="Báo Cáo Kho">
    <!-- Filters -->
    <ElCard shadow="never" class="mb-20px">
      <ElRow :gutter="20">
        <ElCol :xs="24" :sm="8">
          <div class="filter-item">
            <label>Chọn Kho:</label>
            <ElSelect v-model="selectedWarehouseId" placeholder="Tất cả kho" clearable>
              <ElOption
                v-for="warehouse in warehouses"
                :key="warehouse.warehouseId"
                :label="warehouse.warehouseName ?? 'Chưa đặt tên'"
                :value="warehouse.warehouseId"
              />
            </ElSelect>
          </div>
        </ElCol>
        <ElCol :xs="24" :sm="10">
          <div class="filter-item">
            <label>Khoảng Thời Gian:</label>
            <ElDatePicker
              v-model="dateRange"
              type="daterange"
              range-separator="đến"
              start-placeholder="Ngày bắt đầu"
              end-placeholder="Ngày kết thúc"
              style="width: 100%"
            />
          </div>
        </ElCol>
        <ElCol :xs="24" :sm="6">
          <div class="filter-actions">
            <ElButton type="primary" @click="generateReport">
              <Icon icon="vi-ant-design:file-search-outlined" />
              Tạo Báo Cáo
            </ElButton>
            <ElButton type="success" @click="exportReport">
              <Icon icon="vi-ant-design:export-outlined" />
              Xuất Excel
            </ElButton>
          </div>
        </ElCol>
      </ElRow>
    </ElCard>

    <!-- Charts -->
    <ElRow :gutter="20" class="mb-20px">
      <ElCol :xs="24" :md="12">
        <ElCard shadow="hover">
          <Echart :options="warehouseUtilizationChart" :height="350" />
        </ElCard>
      </ElCol>
      <ElCol :xs="24" :md="12">
        <ElCard shadow="hover">
          <Echart :options="itemDistributionChart" :height="350" />
        </ElCard>
      </ElCol>
    </ElRow>

    <ElRow :gutter="20">
      <ElCol :span="24">
        <ElCard shadow="hover">
          <Echart :options="monthlyTrendChart" :height="400" />
        </ElCard>
      </ElCol>
    </ElRow>
  </ContentWrap>
</template>

<style scoped lang="less">
.mb-20px {
  margin-bottom: 20px;
}

.filter-item {
  label {
    display: block;
    margin-bottom: 8px;
    font-weight: 500;
    color: #606266;
  }
}

.filter-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 24px;
}
</style>
