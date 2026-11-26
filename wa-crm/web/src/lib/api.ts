'use client';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';
export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? 'Converse';

export class ApiError extends Error {
  constructor(public status: number, public body: Record<string, unknown>) {
    super(typeof body.error === 'string' ? body.error : `HTTP ${status}`);
  }
}

const KEY = 'wacrm.token';
export const tokenStore = {
  get: () => (typeof window === 'undefined' ? null : window.localStorage.getItem(KEY)),
  set: (t: string) => window.localStorage.setItem(KEY, t),
  clear: () => window.localStorage.removeItem(KEY),
};

/** JSON call to the API with the session token. A 401 clears the session and returns to login. */
export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; token?: string | null } = {}): Promise<T> {
  const token = init.token === undefined ? tokenStore.get() : init.token;
  const res = await fetch(`${API_URL}${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: {
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 && token && init.token === undefined && typeof window !== 'undefined' && !path.startsWith('/auth/')) {
    tokenStore.clear();
    window.location.href = '/login';
  }
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

/** Human message for an API error code. */
export function errorText(e: unknown): string {
  if (!(e instanceof ApiError)) return 'Something went wrong. Please try again.';
  // A send that reached WhatsApp but was refused comes back as the saved failed message.
  if (e.body.error === 'meta_error' && typeof e.body.step === 'string') {
    const steps: Record<string, string> = { exchange_code: 'confirming your Facebook login', subscribe_app: 'linking your WhatsApp account',
      register_number: 'registering the phone number', number_details: 'reading the number details' };
    return `Meta stopped the setup while ${steps[e.body.step] ?? e.body.step}: ${String(e.body.detail ?? 'no reason given')}. Nothing was connected; you can try again.`;
  }
  if (e.body.status === 'failed' && e.body.error_code) {
    const meta: Record<string, string> = {
      '190': 'WhatsApp refused the access token. Reconnect this number in Settings with a valid permanent token.',
      '131047': 'More than 24 hours since the customer wrote. Send an approved template instead.',
      '131026': 'WhatsApp could not deliver this message (the number may not be on WhatsApp).',
      '131056': 'Too many messages to this number too quickly. Wait a moment and try again.',
      '132001': 'This template does not exist in WhatsApp or is not approved for this language.',
    };
    return meta[String(e.body.error_code)] ?? `WhatsApp rejected the message (code ${String(e.body.error_code)}).`;
  }
  if (e.message === 'keyword_in_use') {
    return `The keyword "${String(e.body.keyword)}" is already used by the live flow "${String(e.body.flow)}". Pause that flow or change the keyword.`;
  }
  const map: Record<string, string> = {
    invalid_credentials: 'Email or password is wrong.',
    email_taken: 'An account with this email already exists.',
    plan_limit: 'Your plan limit is reached. Upgrade to add more.',
    account_suspended: 'Your account is paused for an unpaid bill. Open Billing to pay.',
    outside_service_window: 'More than 24 hours since the customer wrote. Send an approved template instead.',
    template_not_approved: 'This template is not approved by Meta yet.',
    forbidden: 'You do not have access to this.',
    already_a_member: 'This person is already on your team.',
    contact_exists: 'A contact with this number already exists.',
    meta_error: 'WhatsApp rejected the request. Check the details and try again.',
    sku_in_use: 'Another product already uses this SKU.',
    product_unavailable: 'One of the products is hidden or no longer exists.',
    mixed_currencies: 'All products in one order must use the same currency.',
    slot_unavailable: 'That time was just taken or is no longer bookable. Pick another time.',
    billing_not_configured: 'Billing is not set up on this server yet.',
    invalid_flow: 'The flow has a problem: check every step is connected and there is one Start.',
    empty_audience: 'No contacts match this audience.',
    parameter_count: 'Fill in every variable in the template.',
    ai_not_configured: 'AI replies are not switched on for this server yet.',
    ai_provider_error: 'The AI service did not answer. Try again in a moment.',
    nothing_to_reply_to: 'The customer has not written anything yet.',
  };
  const issue = Array.isArray(e.body.issues) ? (e.body.issues[0] as { message?: string } | undefined)?.message : undefined;
  return (map[e.message] ?? `Request failed (${e.message}).`) + (issue ? ` ${issue}.` : '');
}

export interface Principal { userId: string; tenantId: string; role: 'owner' | 'admin' | 'agent'; exp: number }

export function decodeToken(token: string | null): Principal | null {
  if (!token) return null;
  try {
    const p = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')));
    if (!p.tid || !p.role || p.exp * 1000 < Date.now()) return null;
    return { userId: p.sub, tenantId: p.tid, role: p.role, exp: p.exp };
  } catch {
    return null;
  }
}

export const money = (paise: number) =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
