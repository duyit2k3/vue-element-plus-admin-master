import request from '@/axios'

// Auth API endpoints
const authApi = {
  login: (email: string, password: string) => {
    return request.post<LoginResponse>({
      url: '/Auth/login',
      data: { email, password }
    })
  },
  logout: () => {
    return request.post<LogoutResponse>({
      url: '/Auth/logout'
    })
  }
}

export default authApi

// Types
export interface LoginRequest {
  email: string
  password: string
}

export interface LoginResponse {
  statusCode: number
  message: string
  data: {
    accessToken: string
    accountId: number
    username: string
    fullName: string
    email: string
    role: string
  }
}

export interface LogoutResponse {
  statusCode: number
  message: string
  data: null
}
