import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  authenticatePreviewUser,
  fetchUserProfileById,
  setActiveSessionUser,
} from '@/lib/portalStore';
import {
  AUTH_RATE_LIMIT,
  assertWithinRateLimit,
  clearRateLimit,
  recordRateLimitFailure,
} from '@/lib/rateLimit';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { loginCredentialsSchema } from '@/lib/validation';
import type { UserProfile } from '@/types/portal';

interface AuthContextValue {
  user: UserProfile | null;
  loading: boolean;
  isSupabaseMode: boolean;
  signIn: (email: string, password: string) => Promise<UserProfile>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const PREVIEW_SESSION_KEY = 'nasher_portal_preview_session_user_id_v1';

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const hydrateFromSupabase = useCallback(async (userId: string, fallbackEmail?: string, meta?: Record<string, unknown>) => {
    const profile = await fetchUserProfileById(userId);
    if (profile) {
      setActiveSessionUser(profile);
      setUser(profile);
      return profile;
    }
    // Least-privilege fallback if auth trigger hasn't settled yet: never trust client user_metadata for role or directory
    const fallback: UserProfile = {
      id: userId,
      email: fallbackEmail ?? '',
      fullName: typeof meta?.full_name === 'string' ? meta.full_name.slice(0, 160) : '',
      role: 'client',
      clientDirectoryId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setActiveSessionUser(fallback);
    setUser(fallback);
    return fallback;
  }, []);

  useEffect(() => {
    let mounted = true;

    async function init() {
      if (!isSupabaseConfigured || !supabase) {
        let restoredUser: UserProfile | null = null;
        try {
          // Migrate off persistent localStorage if an older session exists
          const legacyId = localStorage.getItem(PREVIEW_SESSION_KEY);
          if (legacyId) {
            localStorage.removeItem(PREVIEW_SESSION_KEY);
          }
          const savedUserId = sessionStorage.getItem(PREVIEW_SESSION_KEY) ?? legacyId;
          if (savedUserId) {
            restoredUser = await fetchUserProfileById(savedUserId);
            if (restoredUser) {
              sessionStorage.setItem(PREVIEW_SESSION_KEY, restoredUser.id);
              setActiveSessionUser(restoredUser);
            } else {
              sessionStorage.removeItem(PREVIEW_SESSION_KEY);
              setActiveSessionUser(null);
            }
          }
        } catch {
          // ignore storage errors
        }
        if (mounted) {
          if (restoredUser) setUser(restoredUser);
          setLoading(false);
        }
        return;
      }

      const { data } = await supabase.auth.getSession();
      const sessionUser = data.session?.user;
      if (sessionUser && mounted) {
        await hydrateFromSupabase(
          sessionUser.id,
          sessionUser.email,
          sessionUser.user_metadata as Record<string, unknown>
        );
      }
      if (mounted) setLoading(false);
    }

    init();

    if (!isSupabaseConfigured || !supabase) {
      return () => {
        mounted = false;
      };
    }

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!mounted) return;
      if (!session?.user) {
        setActiveSessionUser(null);
        setUser(null);
        return;
      }
      await hydrateFromSupabase(
        session.user.id,
        session.user.email,
        session.user.user_metadata as Record<string, unknown>
      );
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [hydrateFromSupabase]);

  const signIn = useCallback(
    async (email: string, password: string): Promise<UserProfile> => {
      const parsed = loginCredentialsSchema.safeParse({ identifier: email, password });
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message || 'Invalid credentials.');
      }

      if (!isSupabaseConfigured || !supabase) {
        const profile = await authenticatePreviewUser(parsed.data.identifier, parsed.data.password);
        try {
          sessionStorage.setItem(PREVIEW_SESSION_KEY, profile.id);
          localStorage.removeItem(PREVIEW_SESSION_KEY);
        } catch {
          // ignore storage errors
        }
        setActiveSessionUser(profile);
        setUser(profile);
        return profile;
      }

      const cleanInput = parsed.data.identifier.toLowerCase();
      const rlKey = `supabase_login:${cleanInput}`;
      assertWithinRateLimit(rlKey, AUTH_RATE_LIMIT);

      const authEmail = cleanInput.includes('@')
        ? cleanInput
        : `${cleanInput.replace(/[^a-z0-9._-]/g, '')}@npb-portal.local`;
      const { data, error } = await supabase.auth.signInWithPassword({
        email: authEmail,
        password: parsed.data.password,
      });

      if (error || !data.user) {
        recordRateLimitFailure(rlKey, AUTH_RATE_LIMIT);
        throw new Error(error?.message || 'Unable to sign in with those credentials.');
      }

      clearRateLimit(rlKey);
      const profile = await hydrateFromSupabase(
        data.user.id,
        data.user.email,
        data.user.user_metadata as Record<string, unknown>
      );
      if (!profile) {
        throw new Error('Signed in, but no user profile record was found in user_profiles.');
      }
      return profile;
    },
    [hydrateFromSupabase]
  );

  const signOut = useCallback(async () => {
    setActiveSessionUser(null);
    if (isSupabaseConfigured && supabase) {
      await supabase.auth.signOut();
    } else {
      try {
        sessionStorage.removeItem(PREVIEW_SESSION_KEY);
        localStorage.removeItem(PREVIEW_SESSION_KEY);
      } catch {
        // ignore storage errors
      }
    }
    setUser(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!user) return;
    const latest = await fetchUserProfileById(user.id);
    if (latest) {
      setActiveSessionUser(latest);
      setUser(latest);
    }
  }, [user]);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isSupabaseMode: isSupabaseConfigured,
        signIn,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>.');
  }
  return ctx;
}
