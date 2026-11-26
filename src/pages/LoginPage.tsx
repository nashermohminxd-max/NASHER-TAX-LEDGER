import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  Eye,
  EyeOff,
  Loader2,
  X,
} from 'lucide-react';
import { z } from 'zod';
import { useAuth } from '@/lib/authContext';
import { AUTH_RATE_LIMIT, assertWithinRateLimit, recordRateLimitFailure } from '@/lib/rateLimit';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const resetEmailSchema = z.string().trim().email('Please enter a valid email address.').max(160);

const REMEMBER_EMAIL_KEY = 'npb_tax_ledger_remember_email_v1';

export const LoginPage: React.FC = () => {
  const { signIn } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState<string>(() => {
    try {
      return localStorage.getItem(REMEMBER_EMAIL_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [rememberMe, setRememberMe] = useState<boolean>(() => {
    try {
      return Boolean(localStorage.getItem(REMEMBER_EMAIL_KEY));
    } catch {
      return false;
    }
  });
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [infoModal, setInfoModal] = useState<'FORGOT' | null>(null);
  const [resetEmail, setResetEmail] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  const [resetNotice, setResetNotice] = useState('');

  useEffect(() => {
    if (!rememberMe) {
      try {
        localStorage.removeItem(REMEMBER_EMAIL_KEY);
      } catch {
        // ignore
      }
    }
  }, [rememberMe]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (rememberMe && email.trim()) {
        try {
          localStorage.setItem(REMEMBER_EMAIL_KEY, email.trim());
        } catch {
          // ignore
        }
      }

      const profile = await signIn(email, password);

      if (profile.role === 'admin') {
        navigate('/admin', { replace: true });
      } else {
        navigate('/client', { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetNotice('');
    const parsedEmail = resetEmailSchema.safeParse(resetEmail);
    if (!parsedEmail.success) {
      setResetNotice(parsedEmail.error.issues[0]?.message || 'Enter a valid email address.');
      return;
    }
    if (!isSupabaseConfigured || !supabase) {
      setResetNotice(
        'In local preview mode, ask your NPB CPA Administrator to assign a new password in the Admin Portal.'
      );
      return;
    }
    const rlKey = `pw_reset:${parsedEmail.data.toLowerCase()}`;
    try {
      assertWithinRateLimit(rlKey, AUTH_RATE_LIMIT);
    } catch (err) {
      setResetNotice(err instanceof Error ? err.message : 'Too many requests.');
      return;
    }
    setResetBusy(true);
    try {
      recordRateLimitFailure(rlKey, AUTH_RATE_LIMIT);
      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(parsedEmail.data, {
        redirectTo: `${window.location.origin}/login`,
      });
      if (resetErr) throw resetErr;
      setResetNotice('Password recovery link sent. Check your inbox.');
    } catch (err) {
      setResetNotice(err instanceof Error ? err.message : 'Unable to send recovery email.');
    } finally {
      setResetBusy(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-gradient-to-b from-[#4B8FD8] via-[#9DC6ED] to-[#EEF5FC] flex flex-col items-center justify-center p-4 sm:p-8">
      {/* NPB Accounting Firm Atmospheric Background Layer */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        {/* Soft Daylight Cloud Horizon Illumination */}
        <div
          className="absolute inset-x-0 bottom-0 h-[62%]"
          style={{
            background:
              'radial-gradient(ellipse 85% 65% at 20% 85%, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.45) 45%, transparent 75%), radial-gradient(ellipse 90% 70% at 82% 82%, rgba(255,255,255,0.95) 0%, rgba(241,247,255,0.5) 50%, transparent 78%), radial-gradient(ellipse 65% 50% at 50% 95%, rgba(255,255,255,0.96) 0%, rgba(235,244,255,0.6) 55%, transparent 82%)',
          }}
        />

        {/* Crisp Subtle Accounting Ledger Grid Lines */}
        <div
          className="absolute inset-0 opacity-25"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgba(255,255,255,0.45) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.45) 1px, transparent 1px)',
            backgroundSize: '72px 72px',
          }}
        />

        {/* Concentric Precision Arcs Framing the Center Card */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-[540px] w-[540px] rounded-full border border-white/40" />
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-[760px] w-[760px] rounded-full border border-white/35" />
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-[1000px] w-[1000px] rounded-full border border-white/25" />

        {/* Subtle NPB Firm Emblem Anchors on Left & Right Canvas */}
        <div className="hidden xl:flex absolute left-10 top-10 h-14 w-14 items-center justify-center overflow-hidden rounded-full border border-white/80 bg-white/90 shadow-sm backdrop-blur-md">
          <img
            src="/assets/aistudio/_72398019-0A06-4C5A-A7ED-05B462ABEA26__a9cdb4ac.png"
            alt="NPB Noverben P. Bachiller, CPA Tax and Accounting Services"
            referrerPolicy="no-referrer"
            className="absolute left-1/2 top-1/2 h-auto w-[113%] max-w-none -translate-x-[51.7%] -translate-y-[53%]"
          />
        </div>

        <div className="hidden xl:flex absolute right-12 bottom-10 h-24 w-24 items-center justify-center overflow-hidden rounded-full border border-white/75 bg-white/85 shadow-sm backdrop-blur-md">
          <img
            src="/assets/aistudio/_72398019-0A06-4C5A-A7ED-05B462ABEA26__a9cdb4ac.png"
            alt="Noverben P. Bachiller, CPA"
            referrerPolicy="no-referrer"
            className="absolute left-1/2 top-1/2 h-auto w-[113%] max-w-none -translate-x-[51.7%] -translate-y-[53%]"
          />
        </div>
      </div>

      {/* Centered Frosted Glass Login Card */}
      <main className="relative z-10 w-full max-w-[432px]">
        <div className="rounded-[28px] border-2 border-white/95 bg-gradient-to-b from-white/72 via-white/78 to-white/88 px-6 py-8 sm:px-9 sm:py-9 shadow-[0_24px_60px_-15px_rgba(15,35,66,0.22)] backdrop-blur-2xl">
          {/* Circular Firm Logo Emblem */}
          <div className="relative mx-auto flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border border-white bg-white shadow-sm">
            <img
              src="/assets/aistudio/_72398019-0A06-4C5A-A7ED-05B462ABEA26__a9cdb4ac.png"
              alt="NPB CPA Logo"
              referrerPolicy="no-referrer"
              className="absolute left-1/2 top-1/2 h-auto w-[113%] max-w-none -translate-x-[51.7%] -translate-y-[53%]"
            />
          </div>

          <div className="mt-4 text-center">
            <h1 className="font-display text-2xl font-bold tracking-tight leading-snug text-slate-900">
              Welcome back
            </h1>
            <p className="mt-1 text-xs font-medium leading-normal text-slate-600">
              Please enter your details to sign in.
            </p>
            <p className="mt-2 text-[11px] font-semibold leading-normal text-[#0B4DA2]">
              Noverben P. Bachiller, CPA · Tax & Accounting Services
            </p>
          </div>

          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-slate-300/80" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              NPB Portal
            </span>
            <div className="h-px flex-1 bg-slate-300/80" />
          </div>

          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50/95 px-3.5 py-2.5 text-xs font-medium text-rose-800">
              <AlertCircle className="h-4 w-4 text-rose-600 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">

            <div>
              <label className="block text-xs font-semibold leading-normal text-slate-800">
                Username
              </label>
              <input
                type="text"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your username..."
                className="mt-1.5 w-full rounded-xl border border-slate-400/50 bg-white/55 px-3.5 py-2.5 text-sm leading-normal text-slate-900 placeholder:text-slate-400 focus:border-[#0B4DA2] focus:bg-white/90 focus:outline-none transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-800">
                Password
              </label>
              <div className="relative mt-1.5">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={1}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password..."
                  className="w-full rounded-xl border border-slate-400/50 bg-white/55 py-2.5 pl-3.5 pr-10 text-sm leading-normal text-slate-900 placeholder:text-slate-400 focus:border-[#0B4DA2] focus:bg-white/90 focus:outline-none transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 inline-flex items-center justify-center rounded-lg p-1 text-[#0B4DA2] hover:bg-white/70 cursor-pointer"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5 text-xs leading-normal">
              <label className="inline-flex items-center gap-2 font-medium text-slate-800 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-400 text-slate-900 focus:ring-slate-900 cursor-pointer"
                />
                <span>Remember me</span>
              </label>

              <button
                type="button"
                onClick={() => {
                  setResetEmail(email);
                  setResetNotice('');
                  setInfoModal('FORGOT');
                }}
                className="inline-flex items-center font-medium text-slate-800 underline underline-offset-2 hover:text-[#0B4DA2] whitespace-nowrap cursor-pointer"
              >
                Forgot password?
              </button>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl bg-[#18181B] px-4 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 disabled:opacity-60 cursor-pointer"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {submitting ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </div>
      </main>

      {/* Forgot Password Modal */}
      {infoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-2xl border border-white bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-base font-bold text-slate-900">
                Reset Portal Password
              </h2>
              <button
                type="button"
                onClick={() => setInfoModal(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handlePasswordReset} className="mt-3 space-y-3">
              <p className="text-xs text-slate-600 leading-relaxed">
                Enter your registered email address to request recovery instructions, or contact Noverben P. Bachiller, CPA.
              </p>
              <input
                type="email"
                required
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                placeholder="Enter your email..."
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:border-[#0B4DA2] focus:outline-none"
              />
              {resetNotice && (
                <p className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-700">
                  {resetNotice}
                </p>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setInfoModal(null)}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 cursor-pointer"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={resetBusy}
                  className="rounded-lg bg-[#0B4DA2] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#093D82] cursor-pointer disabled:opacity-60"
                >
                  {resetBusy ? 'Sending...' : 'Send Recovery'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
