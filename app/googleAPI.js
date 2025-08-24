"use client";
import { useEffect, useRef, useState, useCallback } from "react";

const oauth2_client_id =
  "515332392313-ai7bb9n5g30jv88ic202j8slu4f18h5n.apps.googleusercontent.com";

const SCOPES = "https://www.googleapis.com/auth/drive.appdata";

let gisLoadedPromise = null;
let lastAccessToken = null;
let tokenClient = null; // GIS token client instance

function loadGisScript() {
  if (gisLoadedPromise) return gisLoadedPromise;
  gisLoadedPromise = new Promise((resolve, reject) => {
    if (typeof window === "undefined") return resolve();
    if (window.google?.accounts?.oauth2) return resolve();
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load Google Identity Services."));
    document.head.appendChild(s);
  });
  return gisLoadedPromise;
}

function ensureTokenClient() {
  if (typeof window === "undefined") return null;
  if (tokenClient) return tokenClient;
  if (!window.google?.accounts?.oauth2) return null;
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: oauth2_client_id,
    scope: SCOPES,
    callback: () => {
      /* set per-request */
    },
  });
  return tokenClient;
}

/**
 * Requests an OAuth 2.0 access token for Drive AppData.
 * Resolves with the access token string.
 */
export async function requestDriveAppDataCredentials(
  { prompt = "", timeoutMs = 15000, resolveNullOnTimeout } = {}
) {
  if (typeof window === "undefined" || !oauth2_client_id) return null;
  await loadGisScript();

  return new Promise((resolve, reject) => {
    try {
      const client = ensureTokenClient();
      if (!client) return reject(new Error("GIS not available"));

      let settled = false;
      const to = setTimeout(() => {
        if (settled) return;
        settled = true;
        // For silent attempts it's safe to treat timeout as "no token available".
        const silent = prompt === "";
        const allowNull = resolveNullOnTimeout ?? silent;
        if (allowNull) return resolve(null);
        reject(new Error("token_timeout"));
      }, Math.max(1000, timeoutMs | 0));

      client.callback = (resp) => {
        if (settled) return;
        settled = true;
        clearTimeout(to);
        if (resp && resp.access_token) {
          lastAccessToken = resp.access_token;
          resolve(resp.access_token);
        } else {
          const err = new Error(resp?.error || "token_failed");
          err.details = resp;
          reject(err);
        }
      };

  // Request: prompt "" for silent, "consent" for interactive
      client.requestAccessToken({ prompt });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Automatically request credentials when the page finishes loading.
 */
export function setupGoogleDriveAppDataAuthOnLoad() {
  if (typeof window === "undefined") return;
  window.addEventListener(
    "load",
    () => {
  // Try silent on load; ignore failures/timeouts to avoid noisy logs.
  requestDriveAppDataCredentials({ prompt: "" }).catch(() => {});
    },
    { once: true }
  );
}

// Initialize on page load
if (typeof window !== "undefined") {
  setupGoogleDriveAppDataAuthOnLoad();
}

// Optional helper to retrieve the last token if needed elsewhere
export function getLastAccessToken() {
  return lastAccessToken;
}

// Ensure we have a token; try silent retrieval before prompting.
async function ensureAccessToken({ interactive = false } = {}) {
  if (lastAccessToken) return lastAccessToken;
  try {
  const token = await requestDriveAppDataCredentials({ prompt: "" });
  if (token) return token;
  if (!interactive) throw new Error("no_token");
  return await requestDriveAppDataCredentials({ prompt: "consent" });
  } catch (e) {
    if (!interactive) throw e;
    return await requestDriveAppDataCredentials({ prompt: "consent" });
  }
}

// Small fetch helper that injects Authorization header and retries once on 401 by refreshing the token silently.
async function fetchWithDriveToken(
  input,
  init = {},
  {
    retryOnAuth = true,
    interactiveOnAuthFail = false,
    timeoutMs = 15000,
  } = {}
) {
  // Ensure token (silent first)
  const token = await ensureAccessToken({ interactive: false });
  const headers = new Headers(init.headers || {});
  if (!headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);

  // Install timeout via AbortController
  const ac = new AbortController();
  const userSignal = init.signal;
  const onUserAbort = () => ac.abort(userSignal.reason || "aborted");
  if (userSignal) {
    if (userSignal.aborted) ac.abort(userSignal.reason || "aborted");
    else userSignal.addEventListener("abort", onUserAbort, { once: true });
  }
  const to = setTimeout(() => ac.abort("timeout"), Math.max(2000, timeoutMs | 0));

  try {
    let res = await fetch(input, { ...init, headers, signal: ac.signal });
    if ((res.status === 401 || res.status === 403) && retryOnAuth) {
      // clear token and optionally attempt interactive
      lastAccessToken = null;
      try {
        await ensureAccessToken({ interactive: interactiveOnAuthFail });
      } catch (_) {
        // if we can't get a token, throw original response
        const err = new Error("unauthorized");
        err.status = res.status;
        throw err;
      }
      const headers2 = new Headers(init.headers || {});
      if (!headers2.has("Authorization"))
        headers2.set("Authorization", `Bearer ${lastAccessToken}`);
      res = await fetch(input, { ...init, headers: headers2, signal: ac.signal });
    }
    return res;
  } finally {
    clearTimeout(to);
    if (userSignal) userSignal.removeEventListener("abort", onUserAbort);
  }
}

/**
 * Reads the application's config.json from Google Drive AppData folder.
 * Returns parsed JSON object or null if not found or not readable.
 */
export async function readAppDataConfig() {
  if (typeof window === 'undefined') return null;
  try {
    // Timeout/abort protection
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort('read_timeout'), 15000);
    // 1) Find file by name in appDataFolder
    const q = "name = 'config.json' and trashed = false";
    const base = 'https://www.googleapis.com/drive/v3/files';
    const url = `${base}?spaces=appDataFolder&q=${encodeURIComponent(q)}&fields=files(id,name,modifiedTime,size)`;
    let res = await fetchWithDriveToken(
      url,
      { method: 'GET', signal: ac.signal },
      { timeoutMs: 15000, retryOnAuth: true, interactiveOnAuthFail: false }
    );
    if (!res.ok) {
      // If unauthorized or other fatal error, return null
      clearTimeout(to);
      return null;
    }
    const list = await res.json();
    const file = (list.files && list.files[0]) || null;
    if (!file || !file.id) { clearTimeout(to); return null; } // not found

    // 2) Download content
    const downloadUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`;
    res = await fetchWithDriveToken(
      downloadUrl,
      { method: 'GET', signal: ac.signal },
      { timeoutMs: 15000, retryOnAuth: true, interactiveOnAuthFail: false }
    );
    if (!res.ok) { clearTimeout(to); return null; }
    const text = await res.text();
    clearTimeout(to);
    try {
      return JSON.parse(text);
    } catch (_) {
      // Not valid JSON, return null rather than throwing
      return null;
    }
  } catch (e) {
    // Swallow errors and return null for a simple helper
    return null;
  }
}

/**
 * Creates or updates config.json in the Google Drive AppData folder.
 * Returns minimal metadata { id, name, modifiedTime, size } on success, or null on failure.
 */
export async function writeAppDataConfig(data) {
  if (typeof window === 'undefined') return null;
  try {
    // Ensure JSON string
    const content = JSON.stringify(data ?? {});
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort('write_timeout'), 15000);

    // 1) See if the file already exists
    const q = "name = 'config.json' and trashed = false";
    const base = 'https://www.googleapis.com/drive/v3/files';
    const listUrl = `${base}?spaces=appDataFolder&q=${encodeURIComponent(q)}&fields=files(id,name)`;
    let res = await fetchWithDriveToken(
      listUrl,
      { method: 'GET', signal: ac.signal },
      { timeoutMs: 15000, retryOnAuth: true, interactiveOnAuthFail: true }
    );
    if (!res.ok) return null;
    const list = await res.json();
    const existing = (list.files && list.files[0]) || null;

    // 2a) Update existing via media upload
    if (existing && existing.id) {
      const updateUrl = `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existing.id)}?uploadType=media&fields=id,name,modifiedTime,size`;
      res = await fetchWithDriveToken(
        updateUrl,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json; charset=UTF-8' },
          body: content,
          signal: ac.signal,
        },
        { timeoutMs: 15000, retryOnAuth: true, interactiveOnAuthFail: true }
      );
      if (!res.ok) return null;
      clearTimeout(to);
      return await res.json();
    }

    // 2b) Create new via multipart/related (metadata + content)
    const boundary = `-------tgdrive-${Math.random().toString(16).slice(2)}`;
    const metadata = { name: 'config.json', parents: ['appDataFolder'] };
    const multipartBody = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      content,
      `--${boundary}--`,
      ''
    ].join('\r\n');

    const createUrl = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime,size';
    res = await fetchWithDriveToken(
      createUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body: multipartBody,
        signal: ac.signal,
      },
      { timeoutMs: 15000, retryOnAuth: true, interactiveOnAuthFail: true }
    );
    if (!res.ok) return null;
    clearTimeout(to);
    return await res.json();
  } catch (e) {
    return null;
  }
}

/**
 * React hook: useGoogleDriveState
 * Behaves like useState for a JSON-serializable object, with persistence to Drive AppData (config.json).
 * - On mount, loads initial value from readAppDataConfig() once; if null, uses provided initialValue.
 * - On updates, debounces and persists with writeAppDataConfig(), avoiding concurrent writes.
 * Returns [state, setState, controls]
 * controls = { status: 'loading' | 'idle' | 'saving', flush: () => Promise<void>, lastError, lastSavedAt }
 */
export function useGoogleDriveState(initialValue, options = {}) {
  const { debounceMs = 800, autoSave = true, onLoadError, onSaveError } = options;

  const [state, _setState] = useState(initialValue);
  const [status, setStatus] = useState('loading');
  const lastSavedAtRef = useRef(null);
  const lastErrorRef = useRef(null);

  const mountedRef = useRef(true);
  const loadedRef = useRef(false); // whether initial load finished
  const saveRequestedWhileLoadingRef = useRef(false);
  const debounceRef = useRef(null);
  const savingRef = useRef(false); // in-flight write
  const queuedRef = useRef(false); // queued save after current write
  const latestRef = useRef(initialValue);

  useEffect(() => {
    latestRef.current = state;
  }, [state]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Initial load from Drive
  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort('initial_load_timeout'), 15000);
    (async () => {
      try {
        const data = await readAppDataConfig();
        if (cancelled || !mountedRef.current) return;
        if (data != null) {
          _setState(data);
          latestRef.current = data;
        }
        loadedRef.current = true;
        if (mountedRef.current) setStatus('idle');
      } catch (e) {
        lastErrorRef.current = e;
        if (onLoadError) onLoadError(e);
        loadedRef.current = true;
        if (mountedRef.current) setStatus('error');
      } finally {
        clearTimeout(to);
        // If changes were queued during loading, schedule a save now
        if (saveRequestedWhileLoadingRef.current && autoSave) {
          saveRequestedWhileLoadingRef.current = false;
          scheduleSave();
        }
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
      clearTimeout(to);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const performSave = useCallback(async () => {
    if (!mountedRef.current) return;
    if (!loadedRef.current) {
      saveRequestedWhileLoadingRef.current = true;
      return;
    }
    if (savingRef.current) {
      queuedRef.current = true;
      return;
    }
    savingRef.current = true;
    setStatus('saving');
    try {
      const meta = await writeAppDataConfig(latestRef.current);
      lastSavedAtRef.current = meta?.modifiedTime || new Date().toISOString();
    } catch (e) {
      lastErrorRef.current = e;
      if (onSaveError) onSaveError(e);
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setStatus('idle');
      if (queuedRef.current) {
        queuedRef.current = false;
        // Chain another save for the latest state
        performSave();
      }
    }
  }, [onSaveError]);

  const scheduleSave = useCallback(() => {
    if (!autoSave) return;
    if (!mountedRef.current) return;
    if (!loadedRef.current) {
      saveRequestedWhileLoadingRef.current = true;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const wait = Math.max(0, Number(debounceMs) || 0);
    debounceRef.current = setTimeout(() => {
      performSave();
    }, wait);
  }, [autoSave, debounceMs, performSave]);

  const setState = useCallback((updater) => {
    _setState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      return next;
    });
    // latestRef is updated via effect, but ensure it's fresh for rapid updates
    latestRef.current = typeof updater === 'function' ? updater(latestRef.current) : updater;
    scheduleSave();
  }, [scheduleSave]);

  const flush = useCallback(async () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    await performSave();
  }, [performSave]);

  return [state, setState, { status, flush, lastError: lastErrorRef.current, lastSavedAt: lastSavedAtRef.current }];
}
