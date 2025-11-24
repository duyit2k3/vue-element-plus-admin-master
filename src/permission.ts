import router from './router'
import { useAppStoreWithOut } from '@/store/modules/app'
import type { RouteRecordRaw } from 'vue-router'
import { useTitle } from '@/hooks/web/useTitle'
import { useNProgress } from '@/hooks/web/useNProgress'
import { usePermissionStoreWithOut } from '@/store/modules/permission'
import { usePageLoading } from '@/hooks/web/usePageLoading'
import { NO_REDIRECT_WHITE_LIST } from '@/constants'
import { useUserStoreWithOut } from '@/store/modules/user'

const { start, done } = useNProgress()

const { loadStart, loadDone } = usePageLoading()

router.beforeEach(async (to, from, next) => {
  start()
  loadStart()
  const permissionStore = usePermissionStoreWithOut()
  const appStore = useAppStoreWithOut()
  const userStore = useUserStoreWithOut()

  if (userStore.getUserInfo) {
    if (to.path === '/login') {
      // Redirect based on user role after login
      const userRole = userStore.getUserInfo?.role?.toLowerCase()
      if (userRole === 'warehouse_owner' || userRole === 'customer') {
        next({ path: '/warehouse/overview' })
      } else {
        next({ path: '/dashboard/analysis' })
      }
    } else {
      // Kiểm tra nếu route not found và cần regenerate
      const needsRegenerate =
        !permissionStore.getIsAddRouters ||
        (to.matched.length === 0 && to.path !== '/404' && to.path !== '/login')

      if (!needsRegenerate) {
        next()
        return
      }

      console.log('Generating routes for:', to.path)

      // Danh sách quyền hoặc route được trả từ backend (tuỳ cấu hình)
      const roleRouters = userStore.getRoleRouters || []
      const hasRoleRouters = (roleRouters as Array<unknown>).length > 0

      // Kiểm tra xem có bật chức năng route động không
      if (appStore.getDynamicRouter) {
        if (appStore.serverDynamicRouter && hasRoleRouters) {
          await permissionStore.generateRoutes('server', roleRouters as AppCustomRouteRecordRaw[])
        } else if (appStore.serverDynamicRouter && !hasRoleRouters) {
          await permissionStore.generateRoutes('static')
        } else {
          await permissionStore.generateRoutes('frontEnd', roleRouters as string[])
        }
      } else {
        await permissionStore.generateRoutes('static')
      }

      permissionStore.getAddRouters.forEach((route) => {
        router.addRoute(route as unknown as RouteRecordRaw)
      })
      const redirectPath = from.query.redirect || to.path
      const redirect = decodeURIComponent(redirectPath as string)
      const nextData = to.path === redirect ? { ...to, replace: true } : { path: redirect }
      permissionStore.setIsAddRouters(true)
      next(nextData)
    }
  } else {
    if (NO_REDIRECT_WHITE_LIST.indexOf(to.path) !== -1) {
      // Nếu route nằm trong danh sách trắng (ví dụ: /login, /404), cho phép truy cập
      next()
    } else {
      // Nếu không, chuyển hướng đến trang đăng nhập và lưu lại đường dẫn gốc để redirect sau
      next(`/login?redirect=${to.path}`)
    }
  }
})

router.afterEach((to) => {
  useTitle(to?.meta?.title as string)
  done() // End Progress
  loadDone()
})
