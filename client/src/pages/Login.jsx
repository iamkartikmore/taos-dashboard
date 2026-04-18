import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Zap, AlertTriangle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

export default function Login() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const btnRef  = useRef();
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(false);

  const from = location.state?.from?.pathname || '/';

  // Redirect if already logged in
  useEffect(() => {
    if (user) navigate(from, { replace: true });
  }, [user, from, navigate]);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || !window.google?.accounts?.id) return;

    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: async ({ credential }) => {
        setLoading(true);
        setError('');
        try {
          await login(credential);
          navigate(from, { replace: true });
        } catch (e) {
          setError(e.message);
          setLoading(false);
        }
      },
    });

    window.google.accounts.id.renderButton(btnRef.current, {
      theme: 'filled_black',
      size: 'large',
      width: 280,
      text: 'signin_with',
      shape: 'rectangular',
    });
  }, []);

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl bg-gray-900 border border-gray-800 shadow-2xl flex flex-col items-center gap-6 px-8 py-10">

        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand-600 flex items-center justify-center">
            <Zap size={18} className="text-white" />
          </div>
          <div>
            <div className="text-lg font-bold text-white leading-tight">TAOS Elite</div>
            <div className="text-xs text-slate-500">Meta Ops Dashboard</div>
          </div>
        </div>

        <div className="w-full h-px bg-gray-800" />

        <p className="text-sm text-slate-400 text-center leading-relaxed">
          Sign in with your Google account to access the dashboard.
        </p>

        {error && (
          <div className="w-full flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-900/30 border border-red-700/40 text-red-300 text-sm">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex flex-col items-center gap-3 w-full">
          {loading ? (
            <div className="w-7 h-7 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          ) : (
            <div ref={btnRef} />
          )}

          {!GOOGLE_CLIENT_ID && (
            <p className="text-xs text-amber-400 text-center mt-1">
              VITE_GOOGLE_CLIENT_ID is not configured.
            </p>
          )}
        </div>

        <p className="text-[11px] text-slate-600 text-center">
          Access is restricted to authorised email addresses only.
        </p>
      </div>
    </div>
  );
}
