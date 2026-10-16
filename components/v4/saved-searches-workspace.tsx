"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type SearchResult = { id: string; kind: "job" | "company"; title: string; summary: string; href: string; updatedAt: string };
type SavedSearch = {
  id: string;
  name: string;
  query: { text: string; scope: "all" | "jobs" | "companies" };
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
  lastRunResult: { totalCount: number; results: SearchResult[]; moreAvailable: boolean } | null;
};
type Value = Record<string, unknown>;

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({})) as Value;
  if (!response.ok) {
    const error = body.error && typeof body.error === "object" ? body.error as Value : {};
    throw new Error(typeof error.message === "string" ? error.message : `Request failed (${response.status}).`);
  }
  return body as T;
}

function displayDate(value: string | null): string {
  if (!value) return "Never run";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Run date unavailable" : date.toLocaleString();
}

export function SavedSearchesWorkspace() {
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [scope, setScope] = useState<SavedSearch["query"]["scope"]>("all");
  const [busy, setBusy] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await requestJson<{ searches?: SavedSearch[] }>("/api/v4/saved-searches");
      setSearches(result.searches ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Saved searches could not be loaded.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    try {
      const result = await requestJson<{ search: SavedSearch }>("/api/v4/saved-searches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, query: { text, scope } }),
      });
      setSearches((current) => [...current, result.search]);
      setName("");
      setText("");
      setMessage(`Saved “${result.search.name}”. Run it whenever you want to check your local records.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The search could not be saved.");
    }
  }

  async function run(search: SavedSearch) {
    setActiveId(search.id);
    setError(null);
    setMessage(null);
    try {
      const result = await requestJson<{ search: SavedSearch }>(`/api/v4/saved-searches/${encodeURIComponent(search.id)}/run`, { method: "POST" });
      setSearches((current) => current.map((item) => item.id === search.id ? result.search : item));
      const total = result.search.lastRunResult?.totalCount ?? 0;
      setMessage(`“${search.name}” found ${total} local match${total === 1 ? "" : "es"}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The saved search could not run.");
    } finally {
      setActiveId(null);
    }
  }

  async function remove(search: SavedSearch) {
    setActiveId(search.id);
    setError(null);
    setMessage(null);
    try {
      await requestJson(`/api/v4/saved-searches/${encodeURIComponent(search.id)}`, { method: "DELETE" });
      setSearches((current) => current.filter((item) => item.id !== search.id));
      setMessage(`Deleted “${search.name}”.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The saved search could not be deleted.");
    } finally {
      setActiveId(null);
    }
  }

  return <section className="workspace-frame__page">
    <div className="standalone-header">
      <p className="eyebrow">Personal research</p>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="workspace-title">Saved searches</h1>
          <p className="workspace-description">Save a local search and run it when you choose. Searches read only your saved company and job records; they do not refresh sources or call paid services.</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => void load()} disabled={busy}>{busy ? "Loading…" : "Refresh"}</button>
      </div>
    </div>
    {error && <div className="status-banner" role="alert">{error}</div>}
    {message && <div className="status-banner" role="status">{message}</div>}

    <div className="grid gap-5 xl:grid-cols-[.8fr_1.2fr]">
      <form className="standalone-card h-fit" onSubmit={(event) => void save(event)}>
        <p className="eyebrow">Create a saved search</p>
        <label className="filter-field">Name<input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="Product roles in Dublin" required /></label>
        <label className="filter-field">Search text<input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800" value={text} onChange={(event) => setText(event.target.value)} minLength={2} maxLength={120} placeholder="product manager" required /></label>
        <label className="filter-field">Search local data<select value={scope} onChange={(event) => setScope(event.target.value as SavedSearch["query"]["scope"])}><option value="all">Companies and jobs</option><option value="jobs">Jobs</option><option value="companies">Companies</option></select></label>
        <p className="mt-3 text-xs leading-5 text-slate-500">Run searches manually to see what is already in your workspace. A run never searches the web or changes source data.</p>
        <button className="primary-button mt-4" type="submit" disabled={busy || !name.trim() || text.trim().length < 2}>Save search</button>
      </form>

      <section className="standalone-card" aria-labelledby="saved-search-list-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="eyebrow">Your searches</p><h2 id="saved-search-list-title" className="mt-1 text-xl font-semibold text-slate-900">Saved locally</h2></div>
          <a className="secondary-button" href="/notifications">In-app digest settings</a>
        </div>
        {busy && searches.length === 0 ? <p className="mt-4 text-sm text-slate-500">Loading saved searches…</p> : searches.length ? <div className="mt-4 space-y-3">{searches.map((search) => <article className="rounded-xl border border-slate-200 p-4" key={search.id}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0"><h3 className="font-semibold text-slate-900">{search.name}</h3><p className="mt-1 text-sm text-slate-600">“{search.query.text}” · {search.query.scope === "all" ? "Companies and jobs" : search.query.scope}</p><p className="mt-1 text-xs text-slate-500">Last run: {displayDate(search.lastRunAt)}</p></div>
            <div className="flex flex-wrap gap-2"><button className="secondary-button" type="button" disabled={busy || activeId !== null} onClick={() => void run(search)}>{activeId === search.id ? "Running…" : "Run search"}</button><button className="secondary-button" type="button" disabled={busy || activeId !== null} onClick={() => void remove(search)}>Delete</button></div>
          </div>
          {search.lastRunResult && <div className="mt-4 border-t border-slate-100 pt-3">
            <p className="text-xs font-semibold text-slate-600">{search.lastRunResult.moreAvailable ? `Showing ${search.lastRunResult.results.length} of ${search.lastRunResult.totalCount} matches` : `${search.lastRunResult.totalCount} match${search.lastRunResult.totalCount === 1 ? "" : "es"}`}</p>
            {search.lastRunResult.results.length ? <ul className="mt-2 space-y-2">{search.lastRunResult.results.map((result) => <li className="rounded-lg bg-slate-50 px-3 py-2" key={`${result.kind}:${result.id}`}><a className="font-medium text-sm text-blue-700 hover:underline" href={result.href}>{result.title}</a><span className="ml-2 badge badge-muted">{result.kind}</span><p className="mt-1 text-xs text-slate-500">{result.summary}</p></li>)}</ul> : <p className="mt-2 text-sm text-slate-500">No local records matched this search.</p>}
          </div>}
        </article>)}</div> : <div className="empty-state mt-4"><p className="font-semibold text-slate-800">No saved searches yet</p><p className="mt-1 text-sm text-slate-500">Create one on the left, then run it to save a local result snapshot.</p></div>}
      </section>
    </div>
  </section>;
}
