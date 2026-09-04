import { createContext, useContext, useEffect, useState } from "react";
import { api, getToken, setToken } from "@/lib/api";

export type AuthUser = {
  id: string;
  email: string;
  full_name: string;
  role: "admin" | "sales" | "srour" | "retailer";
  assigned_warehouse: "A" | "B";
  is_active: boolean;
  created_at: string;
};

type AuthResponse = {
  access_token: string;
  token_type: string;
  user: AuthUser;
};

interface AuthContextType {
  user: AuthUser | null;
  session: { access_token: string } | null;
  loading: boolean;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: { message: string } | null }>;
  signIn: (email: string, password: string) => Promise<{ error: { message: string } | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [session, setSession] = useState<{ access_token: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }

    api<AuthUser>("/auth/me")
      .then((me) => {
        setUser(me);
        setSession({ access_token: token });
      })
      .catch(() => {
        setToken(null);
        setUser(null);
        setSession(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const signUp = async (email: string, password: string, fullName: string) => {
    try {
      const data = await api<AuthResponse>("/auth/signup", {
        method: "POST",
        body: JSON.stringify({ email, password, full_name: fullName }),
      });
      setToken(data.access_token);
      setUser(data.user);
      setSession({ access_token: data.access_token });
      return { error: null };
    } catch (error: any) {
      return { error: { message: error.message || "Sign up failed" } };
    }
  };

  const signIn = async (email: string, password: string) => {
    try {
      const data = await api<AuthResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setToken(data.access_token);
      setUser(data.user);
      setSession({ access_token: data.access_token });
      return { error: null };
    } catch (error: any) {
      return { error: { message: error.message || "Sign in failed" } };
    }
  };

  const signOut = async () => {
    setToken(null);
    setUser(null);
    setSession(null);
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signUp, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
