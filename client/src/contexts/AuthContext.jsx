import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AuthContext = createContext(null);
export const LS_TOKEN = 'taos_auth_token';

// Silenced Google login — flip to false to re-enable the Google sign-in flow
export const AUTH_BYPASS = true;

async function fetchMe(token) {
  const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error('auth failed');
  return res.json();
}

async function fetchBypass() {
  const res = await fetch('/api/auth/bypass', { method: 'POST' });
  if (!res.ok) throw new Error('bypass unavailable');
  return res.json();
}

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem(LS_TOKEN);

    const bypass = () => fetchBypass()
      .then(data => {
        localStorage.setItem(LS_TOKEN, data.token);
        setUser(data.user);
      })
      .catch(err => {
        console.warn('[auth] bypass failed:', err.message);
        localStorage.removeItem(LS_TOKEN);
      });

    if (token) {
      fetchMe(token)
        .then(u => setUser(u))
        .catch(() => AUTH_BYPASS ? bypass() : localStorage.removeItem(LS_TOKEN))
        .finally(() => setLoading(false));
      return;
    }

    if (AUTH_BYPASS) {
      bypass().finally(() => setLoading(false));
      return;
    }

    setLoading(false);
  }, []);

  const login = useCallback(async (googleCredential) => {
    const res = await fetch('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: googleCredential }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    localStorage.setItem(LS_TOKEN, data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    localStorage.removeItem(LS_TOKEN);
    if (window.google?.accounts?.id) window.google.accounts.id.disableAutoSelect();
    setUser(null);
    // With bypass on, logout is a no-op — immediately re-authenticate
    if (AUTH_BYPASS) {
      try {
        const data = await fetchBypass();
        localStorage.setItem(LS_TOKEN, data.token);
        setUser(data.user);
      } catch (err) { console.warn('[auth] bypass re-login failed:', err.message); }
    }
  }, []);

  const canAccess = useCallback((moduleKey) => {
    if (!user) return false;
    if (user.modules?.includes('*')) return true;
    return user.modules?.includes(moduleKey) ?? false;
  }, [user]);

  // Returns true if the user can see a brand (by brand.id)
  const canAccessBrand = useCallback((brandId) => {
    if (!user) return false;
    if (!user.brands || user.brands.includes('*')) return true;
    return user.brands.includes(brandId);
  }, [user]);

  // Helper for admin API calls
  const authFetch = useCallback((url, opts = {}) => {
    const token = localStorage.getItem(LS_TOKEN);
    return fetch(url, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(opts.headers || {}),
      },
    });
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, canAccess, canAccessBrand, authFetch }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
