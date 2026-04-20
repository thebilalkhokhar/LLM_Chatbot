"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { useAuth } from "@/context/AuthContext";

/**
 * Guard layout for everything under `/chat`.
 *
 * While auth is still bootstrapping we render a centered spinner
 * instead of flashing the login page. Once we know the user is
 * unauthenticated we redirect to `/login`.
 */
export default function ChatLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { status } = useAuth();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
    }
  }, [status, router]);

  if (status !== "authenticated") {
    return (
      <div className="flex min-h-screen items-center justify-center text-[var(--color-fg-muted)]">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return <div className="flex h-screen w-screen overflow-hidden">{children}</div>;
}
