"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

type RecordValue = Record<string, unknown>;
type Contact = { id: string; companyId: string; name: string | null; role: string | null; email: string | null; linkedinUrl: string | null; sourceUrl: string | null; contactType: string; doNotContact: boolean };
type Company = { id: string; name: string };
type Draft = { id: string; companyId: string; contactId: string | null; subject: string; body: string; approvalState: string; updatedAt: string };

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({})) as RecordValue;
  if (!response.ok) {
    const error = body.error && typeof body.error === "object" ? body.error as RecordValue : {};
    throw new Error(typeof error.message === "string" ? error.message : `Request failed (${response.status}).`);
  }
  return body as T;
}

export function V4OutreachPanel() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [contactId, setContactId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [companyResult, contactResult, draftResult] = await Promise.all([
        requestJson<{ companies?: Company[] }>("/api/companies"),
        requestJson<{ contacts?: Contact[] }>("/api/v4/contacts"),
        requestJson<{ drafts?: Draft[] }>("/api/v4/outreach"),
      ]);
      setCompanies(companyResult.companies ?? []);
      setContacts(contactResult.contacts ?? []);
      setDrafts(draftResult.drafts ?? []);
      if (!companyId && companyResult.companies?.[0]) setCompanyId(companyResult.companies[0].id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Outreach drafts could not be loaded.");
    } finally {
      setBusy(false);
    }
  }, [companyId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const companyContacts = useMemo(() => contacts.filter((contact) => contact.companyId === companyId), [contacts, companyId]);
  const selectedContact = contacts.find((contact) => contact.id === contactId) ?? null;

  function chooseCompany(value: string) {
    setCompanyId(value);
    const firstContact = contacts.find((contact) => contact.companyId === value && !contact.doNotContact);
    setContactId(firstContact?.id ?? "");
  }

  async function createDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!companyId || !contactId) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await requestJson("/api/v4/outreach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyId, contactId, subject, body }),
      });
      setSubject("");
      setBody("");
      setMessage("Draft saved. Review and approve this individual message before sending.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The outreach draft could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function changeDraft(draftId: string, action: "approve" | "send") {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const endpoint = action === "approve" ? `/api/v4/outreach/${encodeURIComponent(draftId)}/approve` : `/api/v4/outreach/${encodeURIComponent(draftId)}/send`;
      await requestJson(endpoint, { method: "POST" });
      setMessage(action === "approve" ? "Draft approved. Choose Send approved when you are ready." : "Gmail confirmed the approved message.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `The draft could not be ${action}d.`);
    } finally {
      setBusy(false);
    }
  }

  return <section className="settings-card mt-6" aria-labelledby="v4-outreach-heading">
    <div className="standalone-header !mb-4">
      <p className="eyebrow">Version 4 outreach</p>
      <h2 id="v4-outreach-heading" className="text-xl font-semibold text-slate-900">Public recruiter drafts</h2>
      <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">Create one editable message for one verified public contact. Every message stays a draft until you approve it, and Gmail is called only after you press Send approved.</p>
    </div>
    {error && <div className="status-banner" role="alert">{error}</div>}
    {message && <div className="status-banner" role="status">{message}</div>}
    <div className="grid gap-5 lg:grid-cols-[.8fr_1.2fr]">
      <form className="standalone-card" onSubmit={(event) => void createDraft(event)}>
        <p className="eyebrow">New individual draft</p>
        <label className="filter-field">Company<select value={companyId} onChange={(event) => chooseCompany(event.target.value)} required><option value="">Choose a company</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>
        <label className="filter-field">Public contact<select value={contactId} onChange={(event) => setContactId(event.target.value)} required><option value="">Choose a contact</option>{companyContacts.map((contact) => <option key={contact.id} value={contact.id} disabled={contact.doNotContact || !contact.email}>{contact.name ?? "Unnamed contact"} · {contact.email ?? "email unavailable"}{contact.doNotContact ? " · do not contact" : ""}</option>)}</select></label>
        {selectedContact && <p className="text-xs leading-5 text-slate-500">Recipient: {selectedContact.email ?? "Email unavailable"}. Source review is required; the app never guesses an address.</p>}
        <label className="filter-field">Subject<input value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={200} required /></label>
        <label className="filter-field">Message<textarea value={body} onChange={(event) => setBody(event.target.value)} rows={8} maxLength={20000} required /></label>
        <button className="primary-button mt-3" type="submit" disabled={busy || !companyId || !contactId || !subject.trim() || !body.trim()}>Save draft for review</button>
      </form>
      <section className="standalone-card" aria-labelledby="v4-drafts-heading">
        <p className="eyebrow">Approval queue</p>
        <h3 id="v4-drafts-heading" className="mt-1 text-lg font-semibold text-slate-900">Individual drafts</h3>
        {drafts.length ? <div className="mt-4 space-y-3">{drafts.map((draft) => {
          const contact = contacts.find((item) => item.id === draft.contactId);
          const company = companies.find((item) => item.id === draft.companyId);
          return <article className="rounded-xl border border-slate-200 p-3" key={draft.id}>
            <div className="flex flex-wrap items-start justify-between gap-3"><div><strong className="text-sm text-slate-800">{draft.subject}</strong><p className="mt-1 text-xs text-slate-500">{company?.name ?? "Company"} · {contact?.email ?? "email unavailable"}</p></div><span className="badge badge-muted">{draft.approvalState}</span></div>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600">{draft.body}</p>
            <div className="mt-3 flex flex-wrap gap-2">{draft.approvalState === "draft" && <button className="secondary-button" type="button" disabled={busy} onClick={() => void changeDraft(draft.id, "approve")}>Approve this send</button>}{draft.approvalState === "approved" && <button className="primary-button" type="button" disabled={busy} onClick={() => void changeDraft(draft.id, "send")}>Send approved</button>}</div>
          </article>;
        })}</div> : <p className="empty-state mt-4">No Version 4 outreach drafts yet.</p>}
      </section>
    </div>
  </section>;
}
