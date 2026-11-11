import type { Session } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase } from './supabase'
import type { AppRole, Profile } from './supabase'

type AuthState = {
  loading: boolean
  session: Session | null
  profile: Profile | null
  role: AppRole | null
  isAdmin: boolean
  isStaff: boolean // 管理员或财务
  /** 我在提成单审批流的哪几级上（审批岗位，存级别的 key） */
  posts: string[]
  reloadProfile: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  // 资料是哪个账号的：登录后 session 先有、资料还在读，这时按“还在加载”算，免得闪一下“账号还没有开通”
  const [profileUid, setProfileUid] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async (s: Session | null) => {
    if (!s) {
      setProfile(null)
      setProfileUid(null)
      return
    }
    const { data } = await supabase.from('profiles').select('*').eq('id', s.user.id).maybeSingle()
    setProfile(data ?? null)
    setProfileUid(s.user.id)
  }, [])

  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return
      setSession(data.session)
      await loadProfile(data.session)
      if (alive) setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        // 不能在回调里直接 await supabase 调用，放到下一轮
        setTimeout(() => {
          void loadProfile(s).then(() => setLoading(false))
        }, 0)
      }
    })
    return () => {
      alive = false
      sub.subscription.unsubscribe()
    }
  }, [loadProfile])

  const value = useMemo<AuthState>(() => {
    const role = profile && profile.active ? profile.role : null
    const profileReady = !session || profileUid === session.user.id
    return {
      loading: loading || !profileReady,
      session,
      profile,
      role,
      isAdmin: role === 'admin',
      isStaff: role === 'admin' || role === 'finance',
      posts: role ? (profile?.approval_posts ?? []) : [],
      reloadProfile: () => loadProfile(session),
      signOut: async () => {
        await supabase.auth.signOut()
        setProfile(null)
      },
    }
  }, [loading, session, profile, profileUid, loadProfile])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

export const ROLE_LABEL: Record<AppRole, string> = {
  admin: '管理员',
  finance: '财务',
  sales: '业务员',
}
