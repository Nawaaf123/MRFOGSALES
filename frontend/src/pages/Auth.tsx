import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

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
    mode === "login" ? "Sign In" : mode === "signup" ? "Sign Up" : "Retailer Signup";
  const description =
    mode === "login"
      ? "Welcome back to MR FOG® Sales Manager"
      : mode === "signup"
        ? "Create your MR FOG® account"
        : "Request access as a retailer. An admin must approve your request.";

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary/5 via-background to-accent/5 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
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
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading
                ? "Loading..."
                : mode === "login"
                  ? "Sign In"
                  : mode === "signup"
                    ? "Sign Up"
                    : "Submit Request"}
            </Button>
          </form>

          <div className="mt-4 space-y-2 text-center text-sm text-muted-foreground">
            {mode === "login" ? (
              <>
                <button
                  type="button"
                  className="underline underline-offset-2 hover:text-foreground"
                  onClick={() => switchMode("signup")}
                >
                  Need an account? Sign up
                </button>
                <div>
                  <button
                    type="button"
                    className="underline underline-offset-2 hover:text-foreground"
                    onClick={() => switchMode("retailer")}
                  >
                    Applying as a retailer?
                  </button>
                </div>
              </>
            ) : mode === "signup" ? (
              <>
                <button
                  type="button"
                  className="underline underline-offset-2 hover:text-foreground"
                  onClick={() => switchMode("login")}
                >
                  Already have an account? Sign in
                </button>
                <div>
                  <button
                    type="button"
                    className="underline underline-offset-2 hover:text-foreground"
                    onClick={() => switchMode("retailer")}
                  >
                    Retailer signup instead
                  </button>
                </div>
              </>
            ) : (
              <button
                type="button"
                className="underline underline-offset-2 hover:text-foreground"
                onClick={() => switchMode("login")}
              >
                Back to sign in
              </button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Auth;
