import { useRouter } from 'vue-router'
import { useUserStore } from '@/store/modules/user'
import { usePermissionStore } from '@/store/modules/permission'
import { useTagsViewStore } from '@/store/modules/tagsView'
import authApi from '@/api/auth'
import { ElMessage } from 'element-plus'

export const useLogout = () => {
  const { push } = useRouter()
  const userStore = useUserStore()
  const permissionStore = usePermissionStore()
  const tagsViewStore = useTagsViewStore()

  const logout = async () => {
    try {
      // Gọi API logout
      await authApi.logout()

      // Xóa user info
      userStore.setUserInfo(undefined)
      userStore.setRoleRouters([])

      // Xóa tags view
      tagsViewStore.delAllViews()

      // Reset routes
      permissionStore.setIsAddRouters(false)

      // Redirect về login
      push('/login')

      ElMessage.success('Đăng xuất thành công')
    } catch (error) {
      console.error('Logout error:', error)

      // Vẫn logout ở client nếu API fail
      userStore.setUserInfo(undefined)
      userStore.setRoleRouters([])
      tagsViewStore.delAllViews()
      permissionStore.setIsAddRouters(false)
      push('/login')

      ElMessage.warning('Đã đăng xuất (offline)')
    }
  }

  return {
    logout
  }
}
