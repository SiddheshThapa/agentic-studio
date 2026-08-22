// Upload and removal of the reference PDFs the agents search.
"use client";

import { useState, useSyncExternalStore } from "react";
import { deleteDocument, ingestDocument } from "@/lib/api";
import { DEMO_DOCUMENTS, isDemo } from "@/lib/demo";
import {
  Card,
  ConfirmPanel,
  ErrorAlert,
  Explain,
  Field,
  InfoNote,
  PanelIntro,
  PrimaryButton,
  Skeleton,
  Spinner,
  SuccessNote,
  errorMessage,
  inputClass,
} from "@/components/ui";
import { DEMO_COPY, GLOSSARY, MAX_UPLOAD_MB, PANEL_COPY } from "@/lib/content";

// The backend has no "list documents" endpoint, so removal used to mean typing an
// exact filename from memory. Remembering what this browser uploaded is enough to
// turn that into a pick-from-a-list.
const STORAGE_KEY = "agentic-studio:uploaded-filenames";
const EMPTY: string[] = [];

// Read through useSyncExternalStore rather than an effect: localStorage is an
// external store, and this keeps the server render (always empty) from clashing
// with the client's first paint.
const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedList: string[] = EMPTY;

function subscribe(fn: () => void) {
  listeners.add(fn);
  window.addEventListener("storage", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", fn);
  };
}

/** Must return a referentially stable value when nothing changed, or React loops. */
function getSnapshot(): readonly string[] {
  // Demo Mode shows a fixed list and never reads or writes this browser's storage,
  // so the two modes cannot see each other's filenames. app/page.tsx remounts the
  // panel when the mode changes, so this is read fresh on every switch.
  if (isDemo()) return DEMO_DOCUMENTS;

  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return EMPTY;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      cachedList = raw ? (JSON.parse(raw) as string[]) : EMPTY;
    } catch {
      cachedList = EMPTY;
    }
  }
  return cachedList;
}

function getServerSnapshot(): readonly string[] {
  return EMPTY;
}

function writeRemembered(names: string[]) {
  if (isDemo()) return; // demo mode persists nothing
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(names));
  listeners.forEach((fn) => fn());
}

export default function DocumentsPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [uploading, setUploading] = useState(false);

  const [filename, setFilename] = useState("");
  const [deleteStatus, setDeleteStatus] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const remembered = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function remember(name: string) {
    writeRemembered(Array.from(new Set([name, ...remembered])).slice(0, 20));
  }

  function forget(name: string) {
    writeRemembered(remembered.filter((n) => n !== name));
  }

  const tooBig = file != null && file.size > MAX_UPLOAD_MB * 1024 * 1024;

  async function handleUpload() {
    if (!file || tooBig) return;
    setUploading(true);
    setUploadStatus("");
    setUploadError("");
    try {
      const res = await ingestDocument(file);
      setUploadStatus(
        res.inserted_chunks === 0
          ? `"${file.name}" was already in the knowledge base — nothing new was added.`
          : `"${file.name}" was split into ${res.inserted_chunks} searchable chunks. The agents can use it now.`
      );
      remember(file.name);
      setFile(null);
    } catch (err) {
      setUploadError(errorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setDeleteStatus("");
    setDeleteError("");
    try {
      const res = await deleteDocument(filename);
      setDeleteStatus(
        res.deleted_chunks === 0
          ? `Nothing matched "${filename}". The name must match the uploaded file exactly, including the .pdf ending.`
          : `Removed ${res.deleted_chunks} chunks from "${filename}". The agents can no longer see it.`
      );
      if (res.deleted_chunks > 0) forget(filename);
      setConfirming(false);
    } catch (err) {
      setDeleteError(errorMessage(err));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-8">
      <PanelIntro eyebrow={PANEL_COPY.documents.eyebrow} title={PANEL_COPY.documents.title}>
        {PANEL_COPY.documents.intro}
      </PanelIntro>

      <InfoNote>
        Upload your compliance guidelines so Compliance Check has rules to cite, and past-film
        write-ups so Script Analysis has comparisons to draw on. Without uploads the agents still run,
        but their answers are generic.
      </InfoNote>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="space-y-5">
          <div>
            <h3 className="text-title font-semibold text-ink-50">{PANEL_COPY.sectionUpload}</h3>
            <p className="mt-1.5 text-label leading-relaxed text-ink-400">
              PDF only, up to {MAX_UPLOAD_MB}MB. Text is extracted, split into chunks
              <Explain term="chunks">{GLOSSARY.chunks}</Explain> and sorted automatically
              <Explain term="collections">{GLOSSARY.collections}</Explain>
            </p>
          </div>

          {/* The dropzone is the one place a dashed border earns its keep: it is
              literally an empty slot waiting for a file. */}
          <label
            className={`group flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[var(--radius-surface)] border border-dashed py-12 transition-all duration-[var(--duration-base)] ease-[var(--ease-out-quint)] ${
              tooBig
                ? "border-red-500/40 bg-red-500/[0.06]"
                : file
                ? "border-iris-400/40 bg-iris-400/[0.06]"
                : "border-white/12 bg-white/[0.02] hover:border-iris-400/40 hover:bg-iris-400/[0.04]"
            }`}
          >
            <input
              type="file"
              accept=".pdf,application/pdf"
              onChange={(e) => {
                setFile(e.target.files?.[0] || null);
                setUploadStatus("");
                setUploadError("");
              }}
              className="hidden"
            />
            <span
              className={`flex h-10 w-10 items-center justify-center rounded-full border text-lg transition-colors ${
                file ? "border-iris-400/40 text-iris-300" : "border-white/12 text-ink-500"
              }`}
              aria-hidden
            >
              ↑
            </span>
            <span className="text-label font-medium text-ink-100">
              {file ? file.name : "Click to choose a PDF"}
            </span>
            <span className="text-xs text-ink-500">
              {file
                ? `${(file.size / 1024 / 1024).toFixed(1)}MB${tooBig ? " — too large" : ""}`
                : "or drag one onto this box"}
            </span>
          </label>

          {tooBig && (
            <InfoNote tone="amber">
              This file is over the {MAX_UPLOAD_MB}MB limit and would be rejected. Split it into smaller
              PDFs and upload them one at a time.
            </InfoNote>
          )}

          <PrimaryButton
            onClick={handleUpload}
            disabled={!file || uploading || tooBig}
            loading={uploading}
            className="w-full"
          >
            {uploading ? "Reading and indexing…" : "Upload and index"}
          </PrimaryButton>

          {/* Indexing is slow and gives no progress, so the wait gets its own
              treatment rather than only a spinner inside the button. */}
          {uploading && (
            <div className="space-y-2 rounded-[var(--radius-control)] border border-iris-400/20 bg-iris-400/[0.05] p-3">
              <div className="flex items-center gap-2 text-xs text-iris-200">
                <Spinner className="h-3.5 w-3.5" />
                Reading, splitting and classifying
              </div>
              <Skeleton className="h-2 w-full" />
              <Skeleton className="h-2 w-4/5" />
              <p className="text-[11px] text-ink-400">
                Long PDFs take a while — every chunk is sent for classification and indexing.
              </p>
            </div>
          )}
          {uploadStatus && <SuccessNote>{uploadStatus}</SuccessNote>}
          {uploadError && <ErrorAlert message={uploadError} />}
        </Card>

        <Card className="space-y-5">
          <div>
            <h3 className="text-title font-semibold text-ink-50">{PANEL_COPY.sectionRemove}</h3>
            <p className="mt-1.5 text-label leading-relaxed text-ink-400">
              Deletes every chunk that came from one file. The agents stop seeing it immediately.
            </p>
          </div>

          {isDemo() && <InfoNote tone="amber">{DEMO_COPY.documentsNote}</InfoNote>}

          {remembered.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-micro font-medium uppercase text-ink-500">
                {isDemo() ? "Example documents" : "Uploaded from this browser"}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {remembered.map((name) => (
                  <button
                    key={name}
                    onClick={() => setFilename(name)}
                    className={`press rounded-full border px-2.5 py-1 text-xs ${
                      filename === name
                        ? "border-iris-400/50 bg-iris-400/10 text-iris-200"
                        : "border-white/8 bg-white/[0.02] text-ink-400 hover:border-white/15 hover:text-ink-100"
                    }`}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <Field
            label="Filename"
            required
            help="Must match exactly what was uploaded, including the .pdf ending. There is no partial matching."
            example="studio-guidelines-2026.pdf"
          >
            <input
              value={filename}
              onChange={(e) => {
                setFilename(e.target.value);
                setConfirming(false);
                setDeleteStatus("");
              }}
              placeholder="guidelines.pdf"
              className={inputClass}
            />
          </Field>

          {!confirming ? (
            <PrimaryButton
              onClick={() => setConfirming(true)}
              disabled={!filename.trim()}
              tone="red"
              className="w-full"
            >
              Remove from knowledge base
            </PrimaryButton>
          ) : (
            // Same ConfirmPanel every destructive action in the app now uses.
            <ConfirmPanel
              title="Remove this document?"
              what={`Every chunk from "${filename}" is deleted and the agents stop seeing it immediately.`}
              risk="You would need to re-upload the file to undo this."
              confirmLabel="Yes, remove it"
              busy={deleting}
              onConfirm={handleDelete}
              onCancel={() => setConfirming(false)}
            />
          )}

          {deleteStatus && <InfoNote>{deleteStatus}</InfoNote>}
          {deleteError && <ErrorAlert message={deleteError} />}
        </Card>
      </div>
    </div>
  );
}
