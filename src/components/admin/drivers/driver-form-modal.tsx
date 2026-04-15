"use client";

/**
 * Driver create / edit modal.
 *
 * - Create: POST /api/drivers with every editable field.
 * - Edit: PATCH /api/drivers/:id — server now supports all columns, so
 *   the edit form mirrors the create form (no more status-only mode).
 *
 * Field-level validation mirrors the server rules; inline error
 * messages use fields[] from the server's 400 response.
 */
import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
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
  licenseExpiry: string;
  address: string;
  status: string;
  rating: string;
};

function emptyForm(initial?: DriverView): FormState {
  return {
    name:          initial?.name ?? "",
    email:         initial?.email ?? "",
    phone:         initial?.phone ?? "",
    licenseNumber: initial?.licenseNumber ?? "",
    licenseExpiry: initial?.licenseExpiry ? String(initial.licenseExpiry).slice(0, 10) : "",
    address:       initial?.address ?? "",
    status:        initial?.status ?? "AVAILABLE",
    rating:        initial?.rating != null ? String(initial.rating) : "",
  };
}

export function DriverFormModal({ initial, onClose, onSaved }: Props) {
  const isEdit = !!initial;
  const [form, setForm] = useState<FormState>(() => emptyForm(initial));
  const [submitting, setSubmitting] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Reset when `initial` changes (opening modal for a different driver).
  useEffect(() => {
    setForm(emptyForm(initial));
    setTopError(null);
    setFieldErrors({});
  }, [initial]);

  function up<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => ({ ...f, [k]: v }));
    if (fieldErrors[k]) setFieldErrors((e) => ({ ...e, [k]: "" }));
  }

  // Only send fields that changed (edit) or all fields (create).
  function buildPayload(): Record<string, unknown> {
    if (!isEdit) {
      return {
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone.trim(),
        licenseNumber: form.licenseNumber.trim(),
        licenseExpiry: form.licenseExpiry,
        address: form.address.trim() || null,
        status: form.status,
      };
    }
    const orig = emptyForm(initial);
    const payload: Record<string, unknown> = {};
    if (form.name !== orig.name) payload.name = form.name.trim();
    if (form.email !== orig.email) payload.email = form.email.trim().toLowerCase();
    if (form.phone !== orig.phone) payload.phone = form.phone.trim();
    if (form.licenseNumber !== orig.licenseNumber) payload.licenseNumber = form.licenseNumber.trim();
    if (form.licenseExpiry !== orig.licenseExpiry) payload.licenseExpiry = form.licenseExpiry;
    if (form.status !== orig.status) payload.status = form.status;
    if (form.address !== orig.address) payload.address = form.address.trim() || null;
    if (form.rating !== orig.rating && form.rating !== "") payload.rating = Number(form.rating);
    return payload;
  }

  function validate(): string | null {
    if (!isEdit) {
      if (!form.name.trim()) return "name_required";
      if (!form.email.trim() || !form.email.includes("@")) return "email_invalid";
      if (!form.licenseNumber.trim()) return "license_required";
      if (!form.licenseExpiry) return "license_expiry_required";
    }
    if (form.rating) {
      const n = Number(form.rating);
      if (!Number.isFinite(n) || n < 0 || n > 5) return "rating_invalid";
    }
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTopError(null); setFieldErrors({});

    const clientErr = validate();
    if (clientErr) {
      const msg: Record<string, string> = {
        name_required: "Name is required.",
        email_invalid: "A valid email is required.",
        license_required: "Licence number is required.",
        license_expiry_required: "Licence expiry is required.",
        rating_invalid: "Rating must be between 0 and 5.",
      };
      setTopError(msg[clientErr] ?? "Please check the form.");
      return;
    }

    const payload = buildPayload();
    if (isEdit && Object.keys(payload).length === 0) {
      setTopError("No changes to save.");
      return;
    }

    setSubmitting(true);
    try {
      const res = isEdit
        ? await fetch(`/api/drivers/${encodeURIComponent(initial!.id)}`, {
            method: "PATCH",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/drivers", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

      if (res.status === 403) { setTopError("You don't have permission to do this."); return; }
      if (res.status === 409) {
        let detail = "A driver with that value already exists.";
        try { const j = await res.json(); detail = j.detail || detail; } catch {}
        setTopError(detail); return;
      }
      if (res.status === 400) {
        try {
          const j = await res.json();
          if (j.fields && typeof j.fields === "object") {
            setFieldErrors(j.fields);
            setTopError(j.detail ?? "Some fields are invalid.");
            return;
          }
          setTopError(j.detail ?? "Bad request.");
        } catch { setTopError("Bad request."); }
        return;
      }
      if (!res.ok) { setTopError(`Request failed (${res.status}).`); return; }

      onSaved(isEdit ? `Updated ${form.name || initial?.name}.` : `Created ${form.name}.`);
    } catch {
      setTopError("Network error. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? `Edit ${initial?.name ?? "driver"}` : "New driver"}
      description={isEdit ? "Leave fields unchanged to skip them." : undefined}
      widthPx={520}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button type="submit" form="driver-form" loading={submitting}>
            {isEdit ? "Save changes" : "Create driver"}
          </Button>
        </>
      }
    >
      <form id="driver-form" onSubmit={submit} noValidate className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label="Full name"
            required={!isEdit}
            value={form.name}
            onChange={(e) => up("name", e.target.value)}
            error={fieldErrors.name}
            autoComplete="name"
            placeholder="Jane Doe"
          />
          <Input
            label="Email"
            type="email"
            required={!isEdit}
            value={form.email}
            onChange={(e) => up("email", e.target.value)}
            error={fieldErrors.email}
            autoComplete="email"
            placeholder="jane@example.com"
          />
          <Input
            label="Phone"
            type="tel"
            value={form.phone}
            onChange={(e) => up("phone", e.target.value)}
            error={fieldErrors.phone}
            autoComplete="tel"
            placeholder="+47 40 00 00 00"
          />
          <Input
            label="Licence number"
            required={!isEdit}
            value={form.licenseNumber}
            onChange={(e) => up("licenseNumber", e.target.value)}
            error={fieldErrors.licenseNumber}
            placeholder="NO-12345678"
          />
          <Input
            label="Licence expiry"
            type="date"
            required={!isEdit}
            value={form.licenseExpiry}
            onChange={(e) => up("licenseExpiry", e.target.value)}
            error={fieldErrors.licenseExpiry}
            hint="YYYY-MM-DD"
          />
          <Select
            label="Status"
            value={form.status}
            onChange={(e) => up("status", e.target.value)}
            error={fieldErrors.status}
          >
            {DRIVER_STATUSES.map((s) => (
              <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
            ))}
          </Select>
          <Input
            label="Address"
            wrapperClassName="md:col-span-2"
            value={form.address}
            onChange={(e) => up("address", e.target.value)}
            error={fieldErrors.address}
            autoComplete="street-address"
          />
          {isEdit && (
            <Input
              label="Rating (0–5)"
              wrapperClassName="md:col-span-2"
              type="number"
              step="0.1" min="0" max="5"
              value={form.rating}
              onChange={(e) => up("rating", e.target.value)}
              error={fieldErrors.rating}
              hint="Optional; leave blank to keep current."
            />
          )}
        </div>

        {topError && (
          <div
            role="alert"
            className="rounded-md border border-danger-border bg-danger-bg text-danger text-sm px-3 py-2"
          >
            {topError}
          </div>
        )}
      </form>
    </Modal>
  );
}
