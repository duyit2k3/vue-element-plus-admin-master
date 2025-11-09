<script setup lang="ts">
import { useLogout } from '@/hooks/web/useLogout'
import { ElMessageBox } from 'element-plus'

const { logout } = useLogout()

const handleLogout = async () => {
  try {
    await ElMessageBox.confirm('Bạn có chắc chắn muốn đăng xuất?', 'Xác nhận', {
      confirmButtonText: 'Đăng xuất',
      cancelButtonText: 'Hủy',
      type: 'warning'
    })
    await logout()
  } catch {
    // User cancelled
  }
}
</script>

<template>
  <el-button type="danger" @click="handleLogout">
    <el-icon class="mr-5px">
      <svg-icon name="vi-ant-design:logout-outlined" />
    </el-icon>
    Đăng xuất
  </el-button>
</template>
