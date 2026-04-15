"use client";

/**
 * Create / edit driver modal.
 *
 * When `initial` is provided, submits PATCH /api/drivers/:id with only
 * the fields this endpoint accepts (status/rating/totalTrips — extending
 * that is a server-side change). When omitted, submits POST /api/drivers
 * with the full new-driver payload.
 *
 * Handles: loading state (disabled submit, spinner), error state (banner
 * + per-field validation), keyboard (Esc closes, Enter submits), focus
 * trap (focuses first field on mount).
 */
import { useEffect, useRef, useState } from "react";
import type { DriverView } from "./types";
import { DRIVER_STATUSES } from "./types";

type Props = {
  initial?: DriverView;
  onClose: () => void;
  onSaved: (msg: string) => void;
};

type FormState = {
  name: string;
  email: string;
  phone: string;
  licenseNumber: string;
  licenseExpiry: string; // YYYY-MM-DD
  address: string;
  status: string;
};

function initialForm(initial?: DriverView): FormState {
  return {
    name: initial?.name ?? "",
    email: initial?.email ?? "",
    phone: initial?.phone ?? "",
    licenseNumber: initial?.licenseNumber ?? "",
    licenseExpiry: initial?.licenseExpiry ? String(initial.licenseExpiry).slice(0, 10) : "",
    address: "",
    status: initial?.status ?? "AVAILABLE",
  };
}

export function DriverFormModal({ initial, onClose, onSaved }: Props) {
  const isEdit = !!initial;
  const [form, setForm] = useState<FormState>(() => initialForm(initial));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => { firstFieldRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Client validation — the server repeats all of these, but fast feedback here.
    if (!isEdit) {
      if (!form.name.trim()) return setError("Name is required.");
      if (!form.email.trim() || !form.email.includes("@")) return setError("A valid email is required.");
      if (!form.licenseNumber.trim()) return setError("Licence number is required.");
      if (!form.licenseExpiry) return setError("Licence expiry date is required.");
    }

    setSubmitting(true);
    try {
      const res = isEdit
        ? await fetch(`/api/drivers/${encodeURIComponent(initial.id)}`, {
            method: "PATCH",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: form.status }),
          })
        : await fetch("/api/drivers", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: form.name.trim(),
              email: form.email.trim().toLowerCase(),
              phone: form.phone.trim(),
              licenseNumber: form.licenseNumber.trim(),
              licenseExpiry: form.licenseExpiry,
              address: form.address.trim() || null,
              status: form.status,
            }),
          });

      if (res.status === 403) { setError("You don’t have permission to do this."); return; }
      if (res.status === 409) { setError("A driver with that email already exists."); return; }
      if (!res.ok) {
        let detail = "";
        try { const j = await res.json(); detail = j.detail || j.error || ""; } catch { /* ignore */ }
        setError(detail || `Request failed (${res.status}).`);
        return;
      }
      onSaved(isEdit ? `Updated ${form.name || initial?.name}.` : `Created ${form.name}.`);
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="driver-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-xl border border-[rgba(255,255,255,0.09)] bg-[#0c0f18] shadow-2xl max-h-[92vh] overflow-y-auto">
        <header className="flex items-center justify-between px-5 py-4 border-b border-[rgba(255,255,255,0.05)]">
          <h2 id="driver-modal-title" className="text-base font-bold">
            {isEdit ? `Edit ${initial?.name ?? "driver"}` : "New driver"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-[#4d5a72] hover:text-[#8b96b0] text-xl leading-none"
          >×</button>
        </header>

        <form onSubmit={submit} className="p-5 space-y-4" noValidate>
          {isEdit ? (
            <Field label="Status">
              <select
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                className={fieldClass}
              >
                {DRIVER_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
              </select>
            </Field>
          ) : (
            <>
              <Field label="Full name" required>
                <input
                  ref={firstFieldRef}
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className={fieldClass}
                  placeholder="Jane Doe"
                  autoComplete="name"
                  required
                />
              </Field>
              <Field label="Email" required>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  className={fieldClass}
                  placeholder="jane@example.com"
                  autoComplete="email"
                  required
                />
              </Field>
              <Field label="Phone">
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  className={fieldClass}
                  placeholder="+47 40 00 00 00"
                  autoComplete="tel"
                />
              </Field>
              <Field label="Licence number" required>
                <input
                  value={form.licenseNumber}
                  onChange={(e) => setForm((f) => ({ ...f, licenseNumber: e.target.value }))}
                  className={fieldClass}
                  placeholder="NO-12345678"
                  required
                />
              </Field>
              <Field label="Licence expiry" required hint="YYYY-MM-DD">
                <input
                  type="date"
                  value={form.licenseExpiry}
                  onChange={(e) => setForm((f) => ({ ...f, licenseExpiry: e.target.value }))}
                  className={fieldClass}
                  required
                />
              </Field>
              <Field label="Address">
                <input
                  value={form.address}
                  onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                  className={fieldClass}
                  autoComplete="street-address"
                />
              </Field>
              <Field label="Status">
                <select
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                  className={fieldClass}
                >
                  {DRIVER_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
                </select>
              </Field>
            </>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-md border border-[rgba(239,68,68,0.22)] bg-[rgba(239,68,68,0.10)] text-[#ef4444] text-sm px-3 py-2"
            >
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 rounded-md border border-[rgba(255,255,255,0.09)] text-[#8b96b0] hover:text-[#edf0f8] hover:border-[rgba(255,255,255,0.22)] text-sm disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 rounded-md bg-[#3b7ff5] hover:bg-[#619af8] text-white text-sm font-medium disabled:opacity-60 min-w-[110px]"
            >
              {submitting ? "Saving…" : isEdit ? "Save changes" : "Create driver"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const fieldClass =
  "w-full rounded-md bg-[#07090f] border border-[rgba(255,255,255,0.09)] px-3 py-2 text-sm text-[#edf0f8] placeholder:text-[#4d5a72] focus:border-[#3b7ff5] focus:outline-none focus:ring-1 focus:ring-[#3b7ff5]";

function Field({
  label, required, hint, children,
}: {
  label: string; required?: boolean; hint?: string; children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-wider font-mono text-[#8b96b0] mb-1">
        {label}{required && <span className="ml-1 text-[#ef4444]">*</span>}
      </span>
      {children}
      {hint && <span className="block mt-1 text-[11px] text-[#4d5a72]">{hint}</span>}
    </label>
  );
}
