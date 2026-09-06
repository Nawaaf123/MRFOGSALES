import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import mrFogLogo from "@/assets/mr-fog-logo.jpg";

type AuthMode = "login" | "signup" | "retailer";

const Auth = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const modeParam = searchParams.get("mode");
  const initialMode: AuthMode =
    modeParam === "retailer" ? "retailer" : modeParam === "signup" ? "signup" : "login";

  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [requestedShopName, setRequestedShopName] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    if (modeParam === "retailer") setMode("retailer");
    else if (modeParam === "signup") setMode("signup");
    else setMode("login");
  }, [modeParam]);

  const switchMode = (next: AuthMode) => {
    setMode(next);
    if (next === "retailer") setSearchParams({ mode: "retailer" });
    else if (next === "signup") setSearchParams({ mode: "signup" });
    else setSearchParams({});
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (mode === "login") {
        const { error } = await signIn(email, password);
        if (error) {
          toast({
            title: "Error",
            description: error.message,
            variant: "destructive",
          });
        } else {
          navigate("/dashboard");
        }
      } else if (mode === "signup") {
        const { error } = await signUp(email, password, fullName);
        if (error) {
          toast({
            title: "Error",
            description: error.message,
            variant: "destructive",
          });
        } else {
          toast({
            title: "Success",
            description: "Account created! Please sign in.",
          });
          switchMode("login");
        }
      } else {
        await api("/retailer-signups", {
          method: "POST",
          body: JSON.stringify({
            email: email.trim(),
            full_name: fullName.trim(),
            phone: phone.trim() || null,
            requested_shop_name: requestedShopName.trim(),
            message: message.trim() || null,
            password,
          }),
        });
        toast({
          title: "Request submitted",
          description: "Wait for admin approval",
        });
        setFullName("");
        setPhone("");
        setRequestedShopName("");
        setMessage("");
        setPassword("");
        setEmail("");
        switchMode("login");
      }
    } catch (error: unknown) {
      const apiError = error as ApiError;
      toast({
        title: "Error",
        description: apiError?.message || "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const title =
    mode === "login" ? "Sign in" : mode === "signup" ? "Create account" : "Retailer access";
  const description =
    mode === "login"
      ? "Welcome back to MR FOG Sales Manager"
      : mode === "signup"
        ? "Set up your team account"
        : "Request retailer access — an admin must approve it";

  const modes: { id: AuthMode; label: string }[] = [
    { id: "login", label: "Sign in" },
    { id: "signup", label: "Sign up" },
    { id: "retailer", label: "Retailer" },
  ];

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-white p-4">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/[0.14] via-white to-primary/[0.05]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-24 top-10 h-72 w-72 rounded-full bg-primary/20 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 bottom-0 h-64 w-64 rounded-full bg-primary/10 blur-3xl"
      />

      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-primary/15 bg-white/90 shadow-lg shadow-primary/10 backdrop-blur-sm">
        <div className="border-b border-primary/10 bg-gradient-to-r from-primary/15 to-transparent px-6 py-6 text-center">
          <img
            src={mrFogLogo}
            alt="MR FOG"
            className="mx-auto mb-3 h-12 object-contain"
          />
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>

        <div className="space-y-5 px-6 py-5">
          <div className="flex gap-1 rounded-xl border border-border bg-muted/50 p-1">
            {modes.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => switchMode(m.id)}
                className={cn(
                  "h-9 flex-1 rounded-lg text-sm font-medium transition-colors",
                  mode === m.id
                    ? "bg-primary text-primary-foreground shadow-sm shadow-primary/25"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {m.label}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {(mode === "signup" || mode === "retailer") && (
              <div className="space-y-2">
                <Label htmlFor="fullName">Full Name</Label>
                <Input
                  id="fullName"
                  type="text"
                  placeholder="John Doe"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  className="h-11"
                />
              </div>
            )}
            {mode === "retailer" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone (optional)</Label>
                  <Input
                    id="phone"
                    type="tel"
                    placeholder="(555) 555-5555"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="h-11"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="shopName">Requested Shop Name</Label>
                  <Input
                    id="shopName"
                    type="text"
                    placeholder="My Shop"
                    value={requestedShopName}
                    onChange={(e) => setRequestedShopName(e.target.value)}
                    required
                    className="h-11"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="message">Message (optional)</Label>
                  <Textarea
                    id="message"
                    placeholder="Anything we should know?"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={2}
                    className="resize-none"
                  />
                </div>
              </>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="h-11"
              />
            </div>
            <Button
              type="submit"
              className="h-11 w-full shadow-sm shadow-primary/25"
              disabled={loading}
            >
              {loading
                ? "Loading..."
                : mode === "login"
                  ? "Sign in"
                  : mode === "signup"
                    ? "Create account"
                    : "Submit request"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Auth;
