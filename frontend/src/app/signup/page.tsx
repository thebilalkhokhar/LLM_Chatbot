"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { AxiosError } from "axios";
import { Loader2, Sparkles, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { useAuth } from "@/context/AuthContext";
import { EMAIL_REGEX } from "@/lib/utils";

export default function SignupPage() {
  const router = useRouter();
  const { signup, status } = useAuth();

  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "authenticated") {
      router.replace("/chat");
    }
  }, [status, router]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!EMAIL_REGEX.test(email.trim())) {
      setError("Please enter a valid email.");
      return;
    }
    if (username.trim().length < 3 || username.trim().length > 32) {
      setError("Username must be 3–32 characters.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setSubmitting(true);
    try {
      await signup({
        email: email.trim().toLowerCase(),
        username: username.trim(),
        password,
      });
      router.replace("/chat");
    } catch (err) {
      const axiosErr = err as AxiosError<{ message?: string }>;
      setError(
        axiosErr.response?.data?.message ??
          "Signup failed. Please try again with different credentials."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 py-10">
      <div className="auth-glow" aria-hidden />

      <div className="relative z-10 w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2 text-[var(--color-fg-muted)]">
          <Sparkles className="h-5 w-5 text-[var(--color-accent)]" />
          <span className="text-sm font-medium tracking-wide">AI Gateway</span>
        </div>

        <div className="glass rounded-[var(--radius-xl)] p-7">
          <header className="mb-7 space-y-1.5 text-center">
            <h1 className="text-2xl font-semibold text-[var(--color-fg)]">
              Create your account
            </h1>
            <p className="text-sm text-[var(--color-fg-muted)]">
              It takes less than a minute.
            </p>
          </header>

          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                type="text"
                autoComplete="username"
                placeholder="alice"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                minLength={3}
                maxLength={32}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                placeholder="At least 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>

            {error ? (
              <div
                role="alert"
                className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-xs text-[var(--color-danger)]"
              >
                {error}
              </div>
            ) : null}

            <Button
              type="submit"
              size="lg"
              className="mt-2 w-full"
              loading={submitting}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating account…
                </>
              ) : (
                <>
                  <UserPlus className="h-4 w-4" />
                  Create account
                </>
              )}
            </Button>
          </form>

          <p className="mt-6 text-center text-xs text-[var(--color-fg-muted)]">
            Already have an account?{" "}
            <Link
              href="/login"
              className="font-medium text-[var(--color-accent)] hover:text-[var(--color-accent-hover)]"
            >
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
