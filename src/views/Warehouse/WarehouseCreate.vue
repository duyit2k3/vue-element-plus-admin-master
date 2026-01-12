<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  ElForm,
  ElFormItem,
  ElInput,
  ElInputNumber,
  ElSelect,
  ElOption,
  ElButton,
  ElCard,
  ElMessage,
  ElAlert
} from 'element-plus'
import { useRouter } from 'vue-router'
import { Icon } from '@/components/Icon'
import warehouseApi, { type CreateWarehouseRequest } from '@/api/warehouse'
import { useUserStore } from '@/store/modules/user'

const router = useRouter()
const userStore = useUserStore()

const userInfo = computed(() => userStore.getUserInfo)
const userRole = computed(() => userInfo.value?.role?.toLowerCase() || '')

const formRef = ref<InstanceType<typeof ElForm> | null>(null)

const form = ref<CreateWarehouseRequest>({
  warehouseName: '',
  ownerId: 0,
  address: null,
  length: 50,
  width: 30,
  height: 10,
  warehouseType: 'medium',
  allowedItemTypes: null
})

const submitting = ref(false)

const warehouseTypeOptions = [
  { label: 'Nhỏ', value: 'small' },
  { label: 'Vừa', value: 'medium' },
  { label: 'Lớn', value: 'large' }
]

const rules = {
  warehouseName: [{ required: true, message: 'Vui lòng nhập tên kho', trigger: 'blur' }],
  address: [{ required: false, message: '', trigger: 'blur' }],
  length: [{ required: true, message: 'Vui lòng nhập chiều dài', trigger: 'blur' }],
  width: [{ required: true, message: 'Vui lòng nhập chiều rộng', trigger: 'blur' }],
  height: [{ required: true, message: 'Vui lòng nhập chiều cao', trigger: 'blur' }],
  warehouseType: [{ required: true, message: 'Vui lòng chọn loại kho', trigger: 'change' }]
}

if (userInfo.value?.accountId) {
  form.value.ownerId = userInfo.value.accountId
}

const handleSubmit = () => {
  if (userRole.value !== 'warehouse_owner' && userRole.value !== 'admin') {
    ElMessage.error('Chỉ chủ kho hoặc admin mới được tạo kho')
    return
  }

  if (!formRef.value) return

  formRef.value.validate(async (valid) => {
    if (!valid) return
    submitting.value = true
    try {
      const payload: CreateWarehouseRequest = {
        ...form.value,
        ownerId:
          userRole.value === 'warehouse_owner' && userInfo.value?.accountId
            ? userInfo.value.accountId
            : form.value.ownerId
      }

      const res: any = await warehouseApi.createWarehouse(payload)
      if (res.statusCode === 201 || res.statusCode === 200 || res.code === 0) {
        ElMessage.success('Tạo kho thành công')
        router.push('/warehouse/overview')
      } else {
        ElMessage.error(res.message || 'Không thể tạo kho')
      }
    } catch (error) {
      ElMessage.error('Lỗi khi tạo kho')
    } finally {
      submitting.value = false
    }
  })
}

const handleCancel = () => {
  router.back()
}
</script>

<template>
  <div class="warehouse-create">
    <ElCard class="max-w-800px mx-auto" shadow="hover">
      <template #header>
        <div class="card-header">
          <span class="text-lg font-bold">Tạo Kho Mới</span>
        </div>
      </template>

      <ElAlert
        title="Hệ thống hiện chỉ hỗ trợ kho hình chữ nhật hoặc vuông. Ở bước này bạn khai báo kích thước bao ngoài của kho; sau khi tạo có thể cấu hình chi tiết khu vực, giá kệ và layout trong màn hình layout/3D."
        type="info"
        show-icon
        class="mb-20px"
      />

      <ElForm ref="formRef" :model="form" :rules="rules" label-width="160px">
        <ElFormItem label="Tên kho" prop="warehouseName">
          <ElInput v-model="form.warehouseName" placeholder="Nhập tên kho" />
        </ElFormItem>

        <ElFormItem label="Địa chỉ kho" prop="address">
          <ElInput v-model="form.address" placeholder="Ví dụ: Quận 7, TP. Hồ Chí Minh" clearable />
        </ElFormItem>

        <ElFormItem label="Chiều dài (m)" prop="length">
          <ElInputNumber v-model="form.length" :min="1" :max="1000" :step="1" />
        </ElFormItem>

        <ElFormItem label="Chiều rộng (m)" prop="width">
          <ElInputNumber v-model="form.width" :min="1" :max="1000" :step="1" />
        </ElFormItem>

        <ElFormItem label="Chiều cao (m)" prop="height">
          <ElInputNumber v-model="form.height" :min="1" :max="50" :step="1" />
        </ElFormItem>

        <ElFormItem label="Loại kho" prop="warehouseType">
          <ElSelect v-model="form.warehouseType" placeholder="Chọn loại kho">
            <ElOption
              v-for="opt in warehouseTypeOptions"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </ElSelect>
        </ElFormItem>

        <ElFormItem>
          <ElButton type="primary" :loading="submitting" @click="handleSubmit">
            <Icon icon="vi-ant-design:save-outlined" />
            Lưu
          </ElButton>
          <ElButton @click="handleCancel">
            <Icon icon="vi-ant-design:arrow-left-outlined" />
            Hủy
          </ElButton>
        </ElFormItem>
      </ElForm>
    </ElCard>
  </div>
</template>

<style scoped lang="less">
.warehouse-create {
  padding: 20px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.max-w-800px {
  max-width: 800px;
}

.mx-auto {
  margin-right: auto;
  margin-left: auto;
}

.mb-20px {
  margin-bottom: 20px;
}
</style>
