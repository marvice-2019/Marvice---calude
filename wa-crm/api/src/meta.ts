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
  timestamp: Date;
  raw: unknown;
}

export interface StatusUpdate {
  phoneNumberId: string;
  waMessageId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  errorCode: string | null;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Flattens a WhatsApp Cloud API webhook body into messages and status updates. */
export function parseWebhook(body: unknown): { messages: InboundMessage[]; statuses: StatusUpdate[] } {
  const messages: InboundMessage[] = [];
  const statuses: StatusUpdate[] = [];
  for (const entry of arr(obj(body).entry)) {
    for (const change of arr(obj(entry).changes)) {
      const value = obj(obj(change).value);
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
        messages.push({
          phoneNumberId, from, profileName: names.get(from) ?? null, waMessageId: id, type,
          body, timestamp: new Date(Number(str(msg.timestamp) ?? 0) * 1000 || Date.now()), raw: m,
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
  return { messages, statuses };
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) =>
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
