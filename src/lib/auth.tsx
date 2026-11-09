import type { Session } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase } from './supabase'
import { asPosts } from './commission'
import type { Post } from './commission'
import type { AppRole, Profile } from './supabase'

type AuthState = {
  loading: boolean
  session: Session | null
  profile: Profile | null
  role: AppRole | null
  isAdmin: boolean
  isStaff: boolean // 管理员或财务
  /** 我在哪些审批岗位上（提成单轮到哪一级由谁审） */
  posts: Post[]
  reloadProfile: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async (s: Session | null) => {
    if (!s) {
      setProfile(null)
      return
    }
    const { data } = await supabase.from('profiles').select('*').eq('id', s.user.id).maybeSingle()
    setProfile(data ?? null)
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
    return {
      loading,
      session,
      profile,
      role,
      isAdmin: role === 'admin',
      isStaff: role === 'admin' || role === 'finance',
      posts: role ? asPosts(profile?.approval_posts) : [],
      reloadProfile: () => loadProfile(session),
      signOut: async () => {
        await supabase.auth.signOut()
        setProfile(null)
      },
    }
  }, [loading, session, profile, loadProfile])

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
