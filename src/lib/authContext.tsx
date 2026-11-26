import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  authenticatePreviewUser,
  fetchUserProfileById,
  hasAnyAdminAccount,
  registerFirstPreviewAdmin,
} from '@/lib/portalStore';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import type { UserProfile } from '@/types/portal';

interface AuthContextValue {
  user: UserProfile | null;
  loading: boolean;
  needsFirstRunAdminSetup: boolean;
  isSupabaseMode: boolean;
  signIn: (email: string, password: string) => Promise<UserProfile>;
  setupFirstPreviewAdmin: (params: {
    email: string;
    password: string;
    fullName: string;
  }) => Promise<UserProfile>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [needsFirstRunAdminSetup, setNeedsFirstRunAdminSetup] = useState<boolean>(false);

  const hydrateFromSupabase = useCallback(async (userId: string, fallbackEmail?: string, meta?: Record<string, unknown>) => {
    const profile = await fetchUserProfileById(userId);
    if (profile) {
      setUser(profile);
      return profile;
    }
    // Graceful fallback if auth trigger hasn't settled yet
    const role = meta?.role === 'admin' ? 'admin' : 'client';
    const fallback: UserProfile = {
      id: userId,
      email: fallbackEmail ?? '',
      fullName: String(meta?.full_name ?? ''),
      role,
      clientDirectoryId: meta?.client_directory_id ? String(meta.client_directory_id) : null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setUser(fallback);
    return fallback;
  }, []);

  useEffect(() => {
    let mounted = true;

    async function init() {
      if (!isSupabaseConfigured || !supabase) {
        const hasAdmin = await hasAnyAdminAccount();
        if (mounted) {
          setNeedsFirstRunAdminSetup(!hasAdmin);
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
      if (!isSupabaseConfigured || !supabase) {
        const profile = await authenticatePreviewUser(email, password);
        setUser(profile);
        setNeedsFirstRunAdminSetup(false);
        return profile;
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error || !data.user) {
        throw new Error(error?.message || 'Unable to sign in with those credentials.');
      }

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

  const setupFirstPreviewAdmin = useCallback(
    async (params: { email: string; password: string; fullName: string }): Promise<UserProfile> => {
      const admin = await registerFirstPreviewAdmin(params);
      setUser(admin);
      setNeedsFirstRunAdminSetup(false);
      return admin;
    },
    []
  );

  const signOut = useCallback(async () => {
    if (isSupabaseConfigured && supabase) {
      await supabase.auth.signOut();
    }
    setUser(null);
    const hasAdmin = await hasAnyAdminAccount();
    setNeedsFirstRunAdminSetup(!hasAdmin);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!user) return;
    const latest = await fetchUserProfileById(user.id);
    if (latest) setUser(latest);
  }, [user]);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        needsFirstRunAdminSetup,
        isSupabaseMode: isSupabaseConfigured,
        signIn,
        setupFirstPreviewAdmin,
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
