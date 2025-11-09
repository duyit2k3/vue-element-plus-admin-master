<script setup lang="tsx">
import { reactive, ref, watch, onMounted, unref } from 'vue'
import { Form, FormSchema } from '@/components/Form'
import { useI18n } from '@/hooks/web/useI18n'
import { ElCheckbox, ElLink } from 'element-plus'
import { useForm } from '@/hooks/web/useForm'
import { loginApi } from '@/api/login'
import { usePermissionStore } from '@/store/modules/permission'
import { useRouter } from 'vue-router'
import type { RouteLocationNormalizedLoaded, RouteRecordRaw } from 'vue-router'
import { UserType } from '@/api/login/types'
import { useValidator } from '@/hooks/web/useValidator'
// import { Icon } from '@/components/Icon'
import { useUserStore } from '@/store/modules/user'
import { BaseButton } from '@/components/Button'

const { required } = useValidator()

const emit = defineEmits(['to-register'])

const userStore = useUserStore()

const permissionStore = usePermissionStore()

const { currentRoute, addRoute, push } = useRouter()

const { t } = useI18n()

const rules = {
  username: [required()],
  password: [required()]
}

const schema = reactive<FormSchema[]>([
  {
    field: 'title',
    colProps: {
      span: 24
    },
    formItemProps: {
      slots: {
        default: () => {
          return <h2 class="text-2xl font-bold text-center w-[100%]">{t('login.login')}</h2>
        }
      }
    }
  },
  {
    field: 'username',
    label: t('login.username'),
    // value: 'admin',
    component: 'Input',
    colProps: {
      span: 24
    },
    componentProps: {
      placeholder: 'admin or test'
    }
  },
  {
    field: 'password',
    label: t('login.password'),
    // value: 'admin',
    component: 'InputPassword',
    colProps: {
      span: 24
    },
    componentProps: {
      style: {
        width: '100%'
      },
      placeholder: 'admin or test',
      onKeydown: (_e: any) => {
        if (_e.key === 'Enter') {
          _e.stopPropagation()
          signIn()
        }
      }
    }
  },
  {
    field: 'tool',
    colProps: {
      span: 24
    },
    formItemProps: {
      slots: {
        default: () => {
          return (
            <>
              <div class="flex justify-between items-center w-[100%]">
                <ElCheckbox v-model={remember.value} label={t('login.remember')} size="small" />
                <ElLink type="primary" underline={false}>
                  {t('login.forgetPassword')}
                </ElLink>
              </div>
            </>
          )
        }
      }
    }
  },
  {
    field: 'login',
    colProps: {
      span: 24
    },
    formItemProps: {
      slots: {
        default: () => {
          return (
            <>
              <div class="w-[100%]">
                <BaseButton
                  loading={loading.value}
                  type="primary"
                  class="w-[100%]"
                  onClick={signIn}
                >
                  {t('login.login')}
                </BaseButton>
              </div>
              <div class="w-[100%] mt-15px">
                <BaseButton class="w-[100%]" onClick={toRegister}>
                  {t('login.register')}
                </BaseButton>
              </div>
            </>
          )
        }
      }
    }
  }
  // {
  //   field: 'other',
  //   component: 'Divider',
  //   label: t('login.otherLogin'),
  //   componentProps: {
  //     contentPosition: 'center'
  //   }
  // },
  // {
  //   field: 'otherIcon',
  //   colProps: {
  //     span: 24
  //   },
  //   formItemProps: {
  //     slots: {
  //       default: () => {
  //         return (
  //           <>
  //             <div class="flex justify-between w-[100%]">
  //               <Icon
  //                 icon="vi-ant-design:github-filled"
  //                 size={iconSize}
  //                 class="cursor-pointer ant-icon"
  //                 color={iconColor}
  //                 hoverColor={hoverColor}
  //               />
  //               <Icon
  //                 icon="vi-ant-design:wechat-filled"
  //                 size={iconSize}
  //                 class="cursor-pointer ant-icon"
  //                 color={iconColor}
  //                 hoverColor={hoverColor}
  //               />
  //               <Icon
  //                 icon="vi-ant-design:alipay-circle-filled"
  //                 size={iconSize}
  //                 color={iconColor}
  //                 hoverColor={hoverColor}
  //                 class="cursor-pointer ant-icon"
  //               />
  //               <Icon
  //                 icon="vi-ant-design:weibo-circle-filled"
  //                 size={iconSize}
  //                 color={iconColor}
  //                 hoverColor={hoverColor}
  //                 class="cursor-pointer ant-icon"
  //               />
  //             </div>
  //           </>
  //         )
  //       }
  //     }
  //   }
  // }
])

// const iconSize = 30

const remember = ref(userStore.getRememberMe)

const initLoginInfo = () => {
  const loginInfo = userStore.getLoginInfo
  if (loginInfo) {
    const { username, password } = loginInfo
    setValues({ username, password })
  }
}
onMounted(() => {
  initLoginInfo()
})

const { formRegister, formMethods } = useForm()
const { getFormData, getElFormExpose, setValues } = formMethods

const loading = ref(false)

// const iconColor = '#999'

// const hoverColor = 'var(--el-color-primary)'

const redirect = ref<string>('')

watch(
  () => currentRoute.value,
  (route: RouteLocationNormalizedLoaded) => {
    redirect.value = route?.query?.redirect as string
  },
  {
    immediate: true
  }
)

// SignIn
const signIn = async () => {
  const formRef = await getElFormExpose()
  await formRef?.validate(async (isValid) => {
    if (isValid) {
      loading.value = true
      const formData = await getFormData<UserType>()

      try {
        const res = await loginApi(formData)

        console.log('=== Login Response ===', res)

        if (res && res.data) {
          const userData = res.data

          console.log('=== User Data ===', userData)

          // Lưu JWT token
          if (userData.accessToken) {
            userStore.setToken(`Bearer ${userData.accessToken}`)
          }

          // Load remember
          if (unref(remember)) {
            userStore.setLoginInfo({
              username: formData.username,
              password: formData.password || ''
            })
          } else {
            userStore.setLoginInfo(undefined)
          }
          userStore.setRememberMe(unref(remember))

          // Lưu user info
          userStore.setUserInfo({
            username: userData.username,
            role: userData.role,
            email: userData.email,
            fullName: userData.fullName,
            accountId: userData.accountId
          } as any)

          console.log('=== User Role ===', userData.role)

          // Check role and redirect accordingly
          const userRole = userData.role?.toLowerCase()

          console.log('=== User Role Lowercase ===', userRole)

          // Check if user is warehouse_owner or customer - redirect immediately without dynamic router
          if (userRole === 'warehouse_owner' || userRole === 'customer') {
            console.log('=== Redirecting to warehouse for role ===', userRole)
            // Generate static routes for these roles
            await permissionStore.generateRoutes('static').catch(() => {})
            permissionStore.getAddRouters.forEach((route) => {
              addRoute(route as RouteRecordRaw)
            })
            permissionStore.setIsAddRouters(true)
            console.log('=== Pushing to /warehouse/overview ===')
            console.log('=== Permission Store IsAddRouters ===', permissionStore.getIsAddRouters)
            console.log('=== User Store Info ===', userStore.getUserInfo)

            // Use nextTick to ensure store is updated
            await push({ path: '/warehouse/overview' })
            console.log('=== Push completed ===')
          } else {
            console.log('=== Other role, using dynamic/static router ===')
            // For other roles, let router guard handle the routing
            // Just redirect to root and let permission guard take over
            push({ path: redirect.value || '/' })
          }
        } else {
          console.error('=== No response data ===')
        }
      } catch (error) {
        console.error('=== Login Error ===', error)
      } finally {
        loading.value = false
      }
    }
  })
}

// Deprecated: getRole is no longer used as routing is handled by permission guard
// const getRole = async () => {
//   const formData = await getFormData<UserType>()
//   const params = {
//     roleName: formData.username
//   }
//   const res =
//     appStore.getDynamicRouter && appStore.getServerDynamicRouter
//       ? await getAdminRoleApi(params)
//       : await getTestRoleApi(params)
//   if (res) {
//     const routers = res.data || []
//     userStore.setRoleRouters(routers)
//     appStore.getDynamicRouter && appStore.getServerDynamicRouter
//       ? await permissionStore.generateRoutes('server', routers).catch(() => {})
//       : await permissionStore.generateRoutes('frontEnd', routers).catch(() => {})

//     permissionStore.getAddRouters.forEach((route) => {
//       addRoute(route as RouteRecordRaw)
//     })
//     permissionStore.setIsAddRouters(true)

//     // Check role and redirect accordingly
//     const userInfo = userStore.getUserInfo
//     const userRole = userInfo?.role?.toLowerCase()

//     if (userRole === 'warehouse_owner' || userRole === 'customer') {
//       push({ path: '/warehouse/3d' })
//     } else {
//       push({ path: redirect.value || permissionStore.addRouters[0].path })
//     }
//   }
// }

const toRegister = () => {
  emit('to-register')
}
</script>

<template>
  <Form
    :schema="schema"
    :rules="rules"
    label-position="top"
    hide-required-asterisk
    size="large"
    class="dark:(border-1 border-[var(--el-border-color)] border-solid)"
    @register="formRegister"
  />
</template>
