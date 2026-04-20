"use client";

/**
 * FileUpload — drag-or-click PDF ingestion.
 *
 * Flow:
 *   1. User picks a PDF.
 *   2. We POST it as multipart/form-data to `/api/chat/upload`
 *      (which the Node gateway proxies to the Python `/upload`).
 *   3. On success we bubble the `vector_id` + filename up to the parent
 *      via `onUploaded`. The parent then stores it as the active PDF
 *      so future chat turns trigger the retriever node for RAG.
 */

import { FileText, Loader2, Paperclip, UploadCloud } from "lucide-react";
import {
  useCallback,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";

import { apiClient } from "@/lib/api-client";
import { cn } from "@/lib/utils";

export interface UploadResult {
  vectorId: string;
  filename: string;
  documents: number | null;
  chunks: number | null;
}

interface FileUploadProps {
  onUploaded: (result: UploadResult) => void;
  chatId?: string | null;
  disabled?: boolean;
  compact?: boolean;
}

export function FileUpload({
  onUploaded,
  chatId = null,
  disabled = false,
  compact = false,
}: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const upload = useCallback(
    async (file: File) => {
      if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
        setError("Only PDF files are supported.");
        return;
      }
      if (file.size > 20 * 1024 * 1024) {
        setError("PDF is too large (20 MB max).");
        return;
      }

      setError(null);
      setUploading(true);
      try {
        const form = new FormData();
        form.append("file", file, file.name);

        const { data } = await apiClient.post<{
          status: string;
          vector_id: string;
          filename: string;
          documents: number | null;
          chunks: number | null;
        }>("/chat/upload", form, {
          headers: { "Content-Type": "multipart/form-data" },
          params: chatId ? { chatId } : undefined,
        });

        onUploaded({
          vectorId: data.vector_id,
          filename: data.filename || file.name,
          documents: data.documents,
          chunks: data.chunks,
        });
      } catch (err) {
        const e = err as { response?: { data?: { message?: string } }; message?: string };
        setError(
          e.response?.data?.message ??
            e.message ??
            "Upload failed. Please try again."
        );
      } finally {
        setUploading(false);
      }
    },
    [chatId, onUploaded]
  );

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void upload(file);
    // Allow selecting the same file again later.
    e.target.value = "";
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void upload(file);
  };

  if (compact) {
    return (
      <>
        <button
          type="button"
          disabled={disabled || uploading}
          onClick={() => inputRef.current?.click()}
          title="Attach a PDF for retrieval-augmented answers"
          aria-label="Attach PDF"
          className={cn(
            "inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)]",
            "text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-fg)]",
            "disabled:cursor-not-allowed disabled:opacity-60"
          )}
        >
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Paperclip className="h-4 w-4" />
          )}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={onChange}
        />
        {error ? (
          <div
            role="alert"
            className="ml-2 text-xs text-[var(--color-danger)]"
          >
            {error}
          </div>
        ) : null}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        aria-disabled={disabled || uploading}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[var(--radius-lg)] border border-dashed px-4 py-6 text-center transition-colors",
          dragOver
            ? "border-[var(--color-accent)] bg-[var(--color-accent)]/5"
            : "border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-border-strong)]",
          (disabled || uploading) && "pointer-events-none opacity-60"
        )}
      >
        {uploading ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin text-[var(--color-accent)]" />
            <div className="text-sm text-[var(--color-fg-muted)]">
              Uploading and indexing…
            </div>
          </>
        ) : (
          <>
            <UploadCloud className="h-5 w-5 text-[var(--color-accent)]" />
            <div className="space-y-0.5">
              <div className="text-sm font-medium text-[var(--color-fg)]">
                Attach a PDF
              </div>
              <div className="text-xs text-[var(--color-fg-muted)]">
                Drag & drop or click to browse (max 20 MB)
              </div>
            </div>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={onChange}
        />
      </div>

      {error ? (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-xs text-[var(--color-danger)]"
        >
          <FileText className="h-3.5 w-3.5" />
          {error}
        </div>
      ) : null}
    </div>
  );
}
