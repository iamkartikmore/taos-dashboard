import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AuthContext = createContext(null);
const LS_TOKEN = 'taos_auth_token';

async function fetchMe(token) {
  const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error('auth failed');
  return res.json();
}

export function AuthProvider({ children }) {
  const [user, setUser]     = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem(LS_TOKEN);
    if (!token) { setLoading(false); return; }
    fetchMe(token)
      .then(u => setUser(u))
      .catch(() => localStorage.removeItem(LS_TOKEN))
      .finally(() => setLoading(false));
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

  const logout = useCallback(() => {
    localStorage.removeItem(LS_TOKEN);
    // Revoke Google session so the picker shows again next time
    if (window.google?.accounts?.id) window.google.accounts.id.disableAutoSelect();
    setUser(null);
  }, []);

  // Returns true if user can access a given module key ('*' in modules = all access)
  const canAccess = useCallback((moduleKey) => {
    if (!user) return false;
    if (user.modules?.includes('*')) return true;
    return user.modules?.includes(moduleKey) ?? false;
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, canAccess }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
