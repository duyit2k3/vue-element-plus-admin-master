export interface UserLoginType {
  username: string
  password: string
}

export interface UserType {
  username: string
  password?: string
  role: string
  roleId?: string
  accessToken?: string
  email?: string
  fullName?: string
  accountId?: number
}
