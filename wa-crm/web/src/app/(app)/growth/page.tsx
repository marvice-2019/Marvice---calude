'use client';

import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { Empty, PageHeader, useApi } from '@/components/ui';
import type { Waba } from '@/lib/types';

const digits = (p: string) => p.replace(/\D/g, '');

export default function GrowthPage() {
  const wabas = useApi<{ data: Waba[] }>('/waba');
  const numbers = (wabas.data?.data ?? []).flatMap((w) => w.numbers);
  const [phone, setPhone] = useState('');
  useEffect(() => { if (!phone && numbers[0]) setPhone(digits(numbers[0].displayPhone)); }, [numbers, phone]);

  return (
    <div className="space-y-6 p-6">
      <PageHeader title="Growth tools" subtitle="Bring customers into WhatsApp from your Instagram bio, ads, packaging, shop counter and website." />
      {wabas.data && numbers.length === 0 ? <Empty title="Connect a WhatsApp number first">Settings → WhatsApp numbers.</Empty> : (
        <>
          <div className="card max-w-sm p-4">
            <label className="label" htmlFor="gp">Number</label>
            <select id="gp" className="input" value={phone} onChange={(e) => setPhone(e.target.value)}>
              {numbers.map((n) => <option key={n.id} value={digits(n.displayPhone)}>{n.verifiedName ?? 'Number'} · {n.displayPhone}</option>)}
            </select>
          </div>
          {phone && <LinkBuilder phone={phone} />}
          {phone && <WidgetBuilder phone={phone} />}
        </>
      )}
    </div>
  );
}

function Copy({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return <button type="button" className="btn btn-secondary" onClick={async () => { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); }}>{done ? 'Copied' : 'Copy'}</button>;
}

function LinkBuilder({ phone }: { phone: string }) {
  const [text, setText] = useState('Hi! I saw your post and want to know more.');
  const link = useMemo(() => `https://wa.me/${phone}${text ? `?text=${encodeURIComponent(text)}` : ''}`, [phone, text]);
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => { QRCode.toDataURL(link, { width: 512, margin: 2, errorCorrectionLevel: 'M' }).then(setQr).catch(() => setQr(null)); }, [link]);
  return (
    <section className="card p-5">
      <h2 className="font-semibold">Click-to-chat link and QR code</h2>
      <p className="mb-4 text-sm text-muted">Tip: start the message with a word an Automation flow listens for (for example “PRICE”), so the bot answers instantly and you know where the lead came from.</p>
      <div className="grid gap-5 md:grid-cols-[1fr_200px]">
        <div className="space-y-3">
          <div><label className="label" htmlFor="lt">Message the customer sends (they can edit it)</label>
            <textarea id="lt" className="input" rows={3} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} /></div>
          <div><label className="label" htmlFor="ll">Link</label>
            <div className="flex gap-2"><input id="ll" className="input" readOnly value={link} onFocus={(e) => e.target.select()} /><Copy value={link} /></div></div>
        </div>
        <div className="text-center">
          {qr && <img src={qr} alt="QR code that opens this WhatsApp chat" className="mx-auto w-48 rounded-lg border border-line" />}
          {qr && <a className="mt-2 inline-block text-sm text-brand hover:underline" href={qr} download={`whatsapp-${phone}.png`}>Download PNG</a>}
        </div>
      </div>
    </section>
  );
}

function WidgetBuilder({ phone }: { phone: string }) {
  const [w, setW] = useState({ label: 'Chat with us', greeting: 'Hi there 👋 How can we help?', text: 'Hi!', position: 'right', color: '#25D366' });
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const attr = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const snippet = `<script src="${origin}/widget.js" data-phone="${phone}" data-text="${attr(w.text)}" data-label="${attr(w.label)}" data-greeting="${attr(w.greeting)}" data-position="${w.position}" data-color="${w.color}" async></script>`;
  return (
    <section className="card p-5">
      <h2 className="font-semibold">Website chat button</h2>
      <p className="mb-4 text-sm text-muted">Paste the code before <code className="rounded bg-canvas px-1">&lt;/body&gt;</code> on your site, or in WordPress via a header/footer plugin. No cookies, so no consent banner change.</p>
      <div className="grid gap-3 md:grid-cols-2">
        <div><label className="label" htmlFor="wl">Button text</label><input id="wl" className="input" maxLength={40} value={w.label} onChange={(e) => setW({ ...w, label: e.target.value })} /></div>
        <div><label className="label" htmlFor="wg">Greeting bubble (empty to hide)</label><input id="wg" className="input" maxLength={120} value={w.greeting} onChange={(e) => setW({ ...w, greeting: e.target.value })} /></div>
        <div><label className="label" htmlFor="wt">First message</label><input id="wt" className="input" maxLength={300} value={w.text} onChange={(e) => setW({ ...w, text: e.target.value })} /></div>
        <div className="flex gap-3">
          <div className="flex-1"><label className="label" htmlFor="wp">Position</label>
            <select id="wp" className="input" value={w.position} onChange={(e) => setW({ ...w, position: e.target.value })}><option value="right">Bottom right</option><option value="left">Bottom left</option></select></div>
          <div><label className="label" htmlFor="wc">Colour</label><input id="wc" type="color" className="h-10 w-16 rounded border border-line" value={w.color} onChange={(e) => setW({ ...w, color: e.target.value })} /></div>
        </div>
      </div>
      <label className="label mt-4" htmlFor="ws">Code</label>
      <div className="flex items-start gap-2"><textarea id="ws" className="input font-mono text-xs" rows={3} readOnly value={snippet} onFocus={(e) => e.target.select()} /><Copy value={snippet} /></div>
    </section>
  );
}
