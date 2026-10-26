const BASE = `${(import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? ''}/api`;
const TOKEN_KEY = 'dhukuti.token';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string | null) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY)),
};

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

async function handle<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    if (res.status === 401) {
      tokenStore.set(null);
      if (!location.pathname.startsWith('/login')) location.assign('/login');
    }
    const e = (body as { error?: { code: string; message: string; details?: unknown } }).error;
    throw new ApiError(res.status, e?.code ?? 'ERROR', e?.message ?? `Request failed (${res.status})`, e?.details);
  }
  return body as T;
}

function headers(json = true): HeadersInit {
  const h: Record<string, string> = {};
  const t = tokenStore.get();
  if (t) h.Authorization = `Bearer ${t}`;
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

export const api = {
  get: <T = any>(path: string) => fetch(BASE + path, { headers: headers(false) }).then((r) => handle<T>(r)),
  post: <T = any>(path: string, body?: unknown) => fetch(BASE + path, { method: 'POST', headers: headers(), body: JSON.stringify(body ?? {}) }).then((r) => handle<T>(r)),
  put: <T = any>(path: string, body?: unknown) => fetch(BASE + path, { method: 'PUT', headers: headers(), body: JSON.stringify(body ?? {}) }).then((r) => handle<T>(r)),
  patch: <T = any>(path: string, body?: unknown) => fetch(BASE + path, { method: 'PATCH', headers: headers(), body: JSON.stringify(body ?? {}) }).then((r) => handle<T>(r)),
  del: <T = any>(path: string, body?: unknown) => fetch(BASE + path, { method: 'DELETE', headers: headers(), body: JSON.stringify(body ?? {}) }).then((r) => handle<T>(r)),
  /** multipart upload: fields + optional file */
  form: <T = any>(path: string, fields: Record<string, unknown>, file?: File | null, fileField = 'receipt') => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null && v !== '') fd.append(k, String(v));
    if (file) fd.append(fileField, file);
    return fetch(BASE + path, { method: 'POST', headers: headers(false), body: fd }).then((r) => handle<T>(r));
  },
  /** authenticated binary download (receipts, CSV/PDF exports) */
  blob: async (path: string) => {
    const res = await fetch(BASE + path, { headers: headers(false) });
    if (!res.ok) await handle(res);
    return res.blob();
  },
};

export async function download(path: string, filename: string) {
  const blob = await api.blob(path);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function openBlob(path: string) {
  const blob = await api.blob(path);
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
