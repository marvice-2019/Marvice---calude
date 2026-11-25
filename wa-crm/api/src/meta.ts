import { createHmac, timingSafeEqual } from 'node:crypto';

/** Checks Meta's X-Hub-Signature-256 header against the raw request body. */
export function isValidSignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  const given = Buffer.from(header.slice(7), 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export interface InboundMessage {
  phoneNumberId: string;
  from: string;
  profileName: string | null;
  waMessageId: string;
  type: string;
  body: string | null;
  /** Id of the button or list row the customer tapped, if any. */
  replyId: string | null;
  timestamp: Date;
  raw: unknown;
}

export interface StatusUpdate {
  phoneNumberId: string;
  waMessageId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  errorCode: string | null;
}

export interface TemplateUpdate {
  wabaId: string;
  event: string;
  metaTemplateId: string | null;
  name: string | null;
  language: string | null;
  reason: string | null;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Flattens a WhatsApp Cloud API webhook body into messages and status updates. */
export function parseWebhook(body: unknown): {
  messages: InboundMessage[]; statuses: StatusUpdate[]; templateUpdates: TemplateUpdate[];
} {
  const messages: InboundMessage[] = [];
  const statuses: StatusUpdate[] = [];
  const templateUpdates: TemplateUpdate[] = [];
  for (const entry of arr(obj(body).entry)) {
    for (const change of arr(obj(entry).changes)) {
      const value = obj(obj(change).value);
      // Template review results arrive per WABA (entry.id), not per phone number.
      if (obj(change).field === 'message_template_status_update') {
        const wabaId = str(obj(entry).id), event = str(value.event);
        const tid = value.message_template_id;
        if (wabaId && event) {
          templateUpdates.push({ wabaId, event, metaTemplateId: tid == null ? null : String(tid),
            name: str(value.message_template_name), language: str(value.message_template_language),
            reason: str(value.reason) });
        }
        continue;
      }
      const phoneNumberId = str(obj(value.metadata).phone_number_id);
      if (!phoneNumberId) continue;
      const names = new Map<string, string>();
      for (const c of arr(value.contacts)) {
        const waId = str(obj(c).wa_id);
        const name = str(obj(obj(c).profile).name);
        if (waId && name) names.set(waId, name);
      }
      for (const m of arr(value.messages)) {
        const msg = obj(m);
        const id = str(msg.id), from = str(msg.from), type = str(msg.type);
        if (!id || !from || !type) continue;
        const body = type === 'text' ? str(obj(msg.text).body)
          : str(obj(msg.button).text) ?? str(obj(obj(msg.interactive).button_reply).title)
            ?? str(obj(obj(msg.interactive).list_reply).title) ?? str(obj(msg[type]).caption);
        const replyId = str(obj(obj(msg.interactive).button_reply).id) ?? str(obj(obj(msg.interactive).list_reply).id)
          ?? str(obj(msg.button).payload);
        messages.push({
          phoneNumberId, from, profileName: names.get(from) ?? null, waMessageId: id, type,
          body, replyId, timestamp: new Date(Number(str(msg.timestamp) ?? 0) * 1000 || Date.now()), raw: m,
        });
      }
      for (const s of arr(value.statuses)) {
        const st = obj(s);
        const id = str(st.id), status = str(st.status);
        if (!id || (status !== 'sent' && status !== 'delivered' && status !== 'read' && status !== 'failed')) continue;
        const code = obj(arr(st.errors)[0]).code;
        statuses.push({ phoneNumberId, waMessageId: id, status, errorCode: code == null ? null : String(code) });
      }
    }
  }
  return { messages, statuses, templateUpdates };
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) =>
  Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class MetaApiError extends Error {
  constructor(public status: number, public detail: unknown) {
    super(`Meta API error ${status}`);
  }
}

/** Sends a free-form text message. Only valid inside the 24-hour customer-service window. */
export async function sendText(
  fetchFn: FetchLike, graphVersion: string, phoneNumberId: string, accessToken: string, to: string, text: string,
): Promise<string> {
  const res = await fetchFn(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { body: text } }),
  });
  const data = obj(await res.json().catch(() => ({})));
  const wamid = str(obj(arr(data.messages)[0]).id);
  if (!res.ok || !wamid) throw new MetaApiError(res.status, data.error ?? data);
  return wamid;
}

const graph = (ver: string, path: string) => `https://graph.facebook.com/${ver}/${path}`;
const authJson = (token: string) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });

export interface TemplateDefinition {
  name: string;
  language: string;
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  components: unknown[];
}

/** Submits a template for Meta review. Returns Meta's template id and initial status. */
export async function createTemplate(fetchFn: FetchLike, ver: string, wabaId: string, token: string, t: TemplateDefinition) {
  const res = await fetchFn(graph(ver, `${wabaId}/message_templates`), {
    method: 'POST', headers: authJson(token), body: JSON.stringify(t) });
  const data = obj(await res.json().catch(() => ({})));
  const id = data.id == null ? null : String(data.id);
  if (!res.ok || !id) throw new MetaApiError(res.status, data.error ?? data);
  return { id, status: str(data.status) ?? 'PENDING' };
}

export interface MetaTemplate {
  id: string; name: string; language: string; status: string; category: string;
  components: unknown[]; rejected_reason?: string;
}

/** Lists every template on a WABA, following Meta's paging. */
export async function listTemplates(fetchFn: FetchLike, ver: string, wabaId: string, token: string): Promise<MetaTemplate[]> {
  const out: MetaTemplate[] = [];
  let url: string | null = graph(ver, `${wabaId}/message_templates?limit=100`);
  for (let page = 0; url && page < 50; page++) {
    const res = await fetchFn(url, { method: 'GET', headers: { authorization: `Bearer ${token}` } });
    const data = obj(await res.json().catch(() => ({})));
    if (!res.ok) throw new MetaApiError(res.status, data.error ?? data);
    for (const t of arr(data.data)) out.push(t as MetaTemplate);
    url = str(obj(data.paging).next);
  }
  return out;
}

/** Sends an approved template. Allowed at any time, including outside the 24-hour window. */
export async function sendTemplate(
  fetchFn: FetchLike, ver: string, phoneNumberId: string, token: string, to: string,
  t: { name: string; language: string; components?: unknown[] },
): Promise<string> {
  const template: Obj = { name: t.name, language: { code: t.language } };
  if (t.components?.length) template.components = t.components;
  const res = await fetchFn(graph(ver, `${phoneNumberId}/messages`), {
    method: 'POST', headers: authJson(token),
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'template', template }) });
  const data = obj(await res.json().catch(() => ({})));
  const wamid = str(obj(arr(data.messages)[0]).id);
  if (!res.ok || !wamid) throw new MetaApiError(res.status, data.error ?? data);
  return wamid;
}

/** Sends any Cloud API message object ({type, text|interactive|image|...}). Returns the wamid. */
export async function sendRaw(fetchFn: FetchLike, ver: string, phoneNumberId: string, token: string, to: string,
  message: Record<string, unknown>): Promise<string> {
  const res = await fetchFn(graph(ver, `${phoneNumberId}/messages`), {
    method: 'POST', headers: authJson(token),
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, ...message }) });
  const data = obj(await res.json().catch(() => ({})));
  const wamid = str(obj(arr(data.messages)[0]).id);
  if (!res.ok || !wamid) throw new MetaApiError(res.status, data.error ?? data);
  return wamid;
}
