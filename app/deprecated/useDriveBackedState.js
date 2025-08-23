// useDriveBackedState.js
import { useEffect, useRef, useState, useCallback } from "react";

/**
 * useDriveBackedState
 * React state that auto-saves a JSON object to Google Drive appDataFolder.
 *
 * Returns: [state, setState, { status, flush, connect }]
 * - status: "idle" | "loading" | "saving" | "needs_auth" | "error"
 * - connect(): prompts the user to sign in/consent (must be user-triggered)
 * - flush(): force-save pending changes immediately
 *
 * Prereqs:
 * <script src="https://accounts.google.com/gsi/client" async defer></script>
 * OAuth scope: https://www.googleapis.com/auth/drive.appdata
 */
export function useDriveBackedState(initialValue, opts) {
  const {
    fileName = "app-state.json",
    clientId,
    debounceMs = 1000,
    onLoadError,
    onSaveError,
  } = opts ?? {};

  if (!clientId) {
    throw new Error("useDriveBackedState requires a Google OAuth clientId.");
  }

  // ---------- locals ----------
  const [state, setState] = useState(initialValue);
  const [status, setStatus] = useState("idle"); // idle | loading | saving | needs_auth | error
  const fileIdRef = useRef(null);
  const tokenRef = useRef(null);
  const pendingSaveRef = useRef(null);
  const timerRef = useRef(null);
  const inflightSaveRef = useRef(Promise.resolve());
  const destroyedRef = useRef(false);

  // ---------- auth ----------
  const ensureAccessToken = useCallback(
    (interactive = false) =>
      new Promise((resolve, reject) => {
        if (!window.google?.accounts?.oauth2) {
          return reject(
            new Error(
              "Google Identity Services not loaded. Include <script src='https://accounts.google.com/gsi/client' async defer></script>"
            )
          );
        }
        const scope = "https://www.googleapis.com/auth/drive.appdata";
        const tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope,
          callback: (resp) => {
            if (resp?.error) return reject(new Error(resp.error));
            tokenRef.current = resp.access_token;
            resolve(resp.access_token);
          },
        });

        // Silent if already granted; otherwise requires user gesture.
        tokenClient.requestAccessToken({
          prompt: interactive ? "consent" : "",
        });
      }),
    [clientId]
  );
// const tokenClientRef = useRef(null);
// const initTokenClient = useCallback(() => {
//    if (!window.google?.accounts?.oauth2) {
//      throw new Error("GIS not loaded");
//    }
//    if (!tokenClientRef.current) {
//      tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
//        client_id: clientId,
//        scope: "https://www.googleapis.com/auth/drive.appdata",
//        callback: (resp) => {
//          if (resp?.error) {
//            throw new Error(resp.error);
//          }
//          tokenRef.current = resp.access_token;
//        },
//      });
//    }
//    return tokenClientRef.current;
//  }, [clientId]);

//  const requestToken = useCallback((interactive) => {
//    const tc = initTokenClient();
//    return new Promise((resolve, reject) => {
//      // GIS delivers result via callback above; we poll tokenRef to detect it
//      const onDone = () => tokenRef.current ? resolve(tokenRef.current) : reject(new Error("Token not granted"));
//      try {
//        tc.requestAccessToken({ prompt: interactive ? "consent" : "" });
//       // Wait a microtask so callback can run
//       queueMicrotask(onDone);
//     } catch (e) { reject(e); }
//   });
// }, [initTokenClient]);

//   const authedFetch = useCallback(
//     async (input, init = {}, retryOn401 = true) => {
//       const token = tokenRef.current || (await ensureAccessToken(false));
//       const res = await fetch(input, {
//         ...init,
//         headers: {
//           ...(init.headers || {}),
//           Authorization: `Bearer ${token}`,
//         },
//       });

//       if (res.status === 401 && retryOn401) {
//         // token likely expired; try to refresh silently
//         tokenRef.current = null;
//         try {
//           const fresh = await ensureAccessToken(false);
//           const res2 = await fetch(input, {
//             ...init,
//             headers: {
//               ...(init.headers || {}),
//               Authorization: `Bearer ${fresh}`,
//             },
//           });
//           return res2;
//         } catch (e) {
//           // Don’t pop interactive UI mid-background save; let caller surface error/UI.
//           return res;
//         }
//       }

//       return res;
//     },
//     [ensureAccessToken]
//   );

  // ---------- drive helpers ----------
  const driveSearchByName = useCallback(
    async (name) => {
      const params = new URLSearchParams({
        q: `name='${name.replaceAll("'", "\\'")}' and trashed=false and 'appDataFolder' in parents`,
        spaces: "appDataFolder",
        pageSize: "1",
        fields: "files(id,name)",
      });
      const res = await authedFetch(
        `https://www.googleapis.com/drive/v3/files?${params.toString()}`
      );
      if (!res.ok) throw new Error(`Drive search failed: ${res.status}`);
      const data = await res.json();
      return data.files?.[0] ?? null;
    },
    [authedFetch]
  );

  const driveCreateFile = useCallback(
    async (name) => {
      const metadata = {
        name,
        parents: ["appDataFolder"],
        mimeType: "application/json",
      };
      const res = await authedFetch(
        "https://www.googleapis.com/drive/v3/files?fields=id,name",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(metadata),
        }
      );
      if (!res.ok) throw new Error(`Drive create failed: ${res.status}`);
      return res.json(); // {id, name}
    },
    [authedFetch]
  );

  const driveUpdateJson = useCallback(
    async (id, obj) => {
      const body = JSON.stringify(obj ?? {});
      const res = await authedFetch(
        `https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body,
        }
      );
      if (!res.ok) throw new Error(`Drive update failed: ${res.status}`);
    },
    [authedFetch]
  );

  const driveDownloadJson = useCallback(
    async (id) => {
      const res = await authedFetch(
        `https://www.googleapis.com/drive/v3/files/${id}?alt=media`,
        { method: "GET" }
      );
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Drive download failed: ${res.status}`);
      const text = await res.text();
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    },
    [authedFetch]
  );

  const ensureFileId = useCallback(
    async (name) => {
      if (fileIdRef.current) return fileIdRef.current;
      const existing = await driveSearchByName(name);
      if (existing?.id) {
        fileIdRef.current = existing.id;
        return existing.id;
      }
      const created = await driveCreateFile(name);
      fileIdRef.current = created.id;
      return created.id;
    },
    [driveSearchByName, driveCreateFile]
  );

  // ---------- save logic ----------
  const saveWithRetry = useCallback(
    async (fileId, jsonObj) => {
      let attempt = 0;
      const maxAttempts = 5;

      while (true) {
        try {
          await driveUpdateJson(fileId, jsonObj);
          return;
        } catch (err) {
          attempt += 1;
          const msg = String(err?.message || "");
          const shouldRetry =
            /429|5\d\d|Rate Limit|quota|timeout|network/i.test(msg) &&
            attempt < maxAttempts;

          if (!shouldRetry) throw err;

          // Exponential backoff + jitter
          const base = 400;
          const wait =
            Math.min(8000, base * Math.pow(2, attempt - 1)) *
            (0.5 + Math.random());
          await new Promise((r) => setTimeout(r, wait));
        }
      }
    },
    [driveUpdateJson]
  );

  const scheduleSave = useCallback(
    (jsonObj) => {
      pendingSaveRef.current = jsonObj;

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(async () => {
        timerRef.current = null;

        const payload = pendingSaveRef.current;
        pendingSaveRef.current = null;
        if (payload == null) return;

        setStatus("saving");

        inflightSaveRef.current = inflightSaveRef.current.then(async () => {
          try {
            const id = await ensureFileId(fileName);
            await saveWithRetry(id, payload);
            if (!destroyedRef.current) setStatus("idle");
          } catch (err) {
            if (!destroyedRef.current) setStatus("error");
            onSaveError?.(err);
          }
        });

        await inflightSaveRef.current;
      }, debounceMs);
    },
    [debounceMs, ensureFileId, fileName, onSaveError, saveWithRetry]
  );

  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const payload = pendingSaveRef.current;
    pendingSaveRef.current = null;
    if (payload == null) return;

    setStatus("saving");
    inflightSaveRef.current = inflightSaveRef.current.then(async () => {
      try {
        const id = await ensureFileId(fileName);
        await saveWithRetry(id, payload);
        if (!destroyedRef.current) setStatus("idle");
      } catch (err) {
        if (!destroyedRef.current) setStatus("error");
        onSaveError?.(err);
      }
    });

    await inflightSaveRef.current;
  }, [ensureFileId, fileName, onSaveError, saveWithRetry]);

  // ---------- connect (interactive auth + initial load) ----------
  const connect = useCallback(async () => {
    try {
      setStatus("loading");
      await ensureAccessToken(true); // user gesture path
      const id = await ensureFileId(fileName);
      const cloud = await driveDownloadJson(id);
      if (cloud && typeof cloud === "object") setState(cloud);
      setStatus("idle");
    } catch (err) {
      setStatus("error");
      onLoadError?.(err);
    }
  }, [ensureAccessToken, ensureFileId, driveDownloadJson, fileName, onLoadError]);

  // ---------- mount: try silent auth ----------
  useEffect(() => {
    destroyedRef.current = false;

    (async () => {
      try {
        setStatus("loading");
        await ensureAccessToken(false); // silent attempt
        const id = await ensureFileId(fileName);
        const cloud = await driveDownloadJson(id);
        if (cloud && typeof cloud === "object") setState(cloud);
        setStatus("idle");
      } catch (err) {
        // Not authorized yet; the UI should call connect() on a user gesture.
        setStatus("needs_auth");
      }
    })();

    const onUnload = () => {
      if (timerRef.current) {
        // best-effort (browser may cancel)
        flush();
      }
    };
    window.addEventListener("beforeunload", onUnload);

    return () => {
      destroyedRef.current = true;
      window.removeEventListener("beforeunload", onUnload);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [driveDownloadJson, ensureAccessToken, ensureFileId, fileName, flush]);

  // ---------- public setter ----------
  const setAndBackup = useCallback(
    (updater) => {
      setState((prev) => {
        const next =
          typeof updater === "function" ? updater(prev) : updater;
        // Only schedule a save if we’re already authorized
        if (tokenRef.current) {
          scheduleSave(next);
        } else {
          // No token yet; wait until connect()/silent flow completes.
          pendingSaveRef.current = next;
        }
        return next;
      });
    },
    [scheduleSave]
  );

  return [state, setAndBackup, { status, flush, connect }];
}
