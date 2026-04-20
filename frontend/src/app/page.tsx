"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";

import { useAuth } from "@/context/AuthContext";

export default function RootPage() {
  const router = useRouter();
  const { status } = useAuth();

  useEffect(() => {
    if (status === "loading") return;
    if (status === "authenticated") {
      router.replace("/chat");
    } else {
      router.replace("/login");
    }
  }, [status, router]);

  return (
    <div className="flex min-h-screen items-center justify-center text-[var(--color-fg-muted)]">
      <Loader2 className="h-5 w-5 animate-spin" />
    </div>
  );
}
