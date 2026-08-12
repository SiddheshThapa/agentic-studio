// Upload and removal of the reference PDFs the agents search.
"use client";

import { useState, useSyncExternalStore } from "react";
import { deleteDocument, ingestDocument } from "@/lib/api";
import {
  Card,
  ErrorAlert,
  Explain,
  Field,
  InfoNote,
  PrimaryButton,
  SuccessNote,
  errorMessage,
  inputClass,
} from "@/components/ui";
import { GLOSSARY, MAX_UPLOAD_MB } from "@/lib/content";

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
function getSnapshot(): string[] {
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

function getServerSnapshot(): string[] {
  return EMPTY;
}

function writeRemembered(names: string[]) {
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
    <div className="space-y-6">
      <Card className="space-y-2">
        <h2 className="font-semibold">Why upload anything?</h2>
        <p className="text-sm leading-relaxed text-slate-400">
          The agents answer from your documents, not from general knowledge. Upload your compliance
          guidelines so Compliance Check has rules to cite, and past-film write-ups so Script Analysis
          has comparisons to draw on. Without uploads the agents still run, but their answers are
          generic.
        </p>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="space-y-5">
          <div>
            <h2 className="font-semibold">Upload a document</h2>
            <p className="mt-1 text-sm text-slate-500">
              PDF only, up to {MAX_UPLOAD_MB}MB. Text is extracted, split into chunks
              <Explain term="chunks">{GLOSSARY.chunks}</Explain> and sorted automatically
              <Explain term="collections">{GLOSSARY.collections}</Explain>
            </p>
          </div>

          <label
            className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed py-10 transition-colors ${
              tooBig ? "border-red-800 bg-red-950/20" : "border-slate-800 hover:border-slate-700"
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
            <span className="text-sm text-slate-300">{file ? file.name : "Click to choose a PDF"}</span>
            <span className="text-xs text-slate-600">
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

          {uploading && (
            <p className="text-center text-xs text-slate-600">
              Long PDFs take a while — every chunk is sent for classification and indexing.
            </p>
          )}
          {uploadStatus && <SuccessNote>{uploadStatus}</SuccessNote>}
          {uploadError && <ErrorAlert message={uploadError} />}
        </Card>

        <Card className="space-y-5">
          <div>
            <h2 className="font-semibold">Remove a document</h2>
            <p className="mt-1 text-sm text-slate-500">
              Deletes every chunk that came from one file. The agents stop seeing it immediately.
            </p>
          </div>

          {remembered.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-slate-500">Uploaded from this browser — click to fill in:</p>
              <div className="flex flex-wrap gap-1.5">
                {remembered.map((name) => (
                  <button
                    key={name}
                    onClick={() => setFilename(name)}
                    className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                      filename === name
                        ? "border-blue-600 bg-blue-950/40 text-blue-300"
                        : "border-slate-800 text-slate-400 hover:border-slate-700"
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
            <div className="animate-fade-in-up space-y-2 rounded-lg border border-red-900 bg-red-950/20 p-3">
              <p className="text-sm text-red-200">
                Remove every chunk from &quot;{filename}&quot;? You would need to re-upload the file to
                undo this.
              </p>
              <div className="flex gap-2">
                <PrimaryButton
                  onClick={handleDelete}
                  disabled={deleting}
                  loading={deleting}
                  tone="red"
                  className="flex-1"
                >
                  Yes, remove it
                </PrimaryButton>
                <button
                  onClick={() => setConfirming(false)}
                  className="rounded-lg border border-slate-700 px-4 text-sm text-slate-400 transition-colors hover:text-slate-200"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {deleteStatus && <InfoNote>{deleteStatus}</InfoNote>}
          {deleteError && <ErrorAlert message={deleteError} />}
        </Card>
      </div>
    </div>
  );
}
