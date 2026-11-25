'use client';

import { useEffect, useRef, useState } from 'react';
import { useApi } from '@/components/ui';
import { api, errorText } from '@/lib/api';

// Meta Embedded Signup. FB.login opens Meta's popup with our configuration; the popup posts the chosen
// WABA id and phone number id back as a message, and the login callback returns a one-time code.
// Both halves arrive separately and in either order, so we submit once we hold both.
interface EsConfig { enabled: boolean; appId: string | null; configId: string | null; graphVersion: string }
interface FbSdk {
  init(o: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }): void;
  login(cb: (r: { authResponse?: { code?: string } | null }) => void, o: Record<string, unknown>): void;
}
declare global { interface Window { FB?: FbSdk; fbAsyncInit?: () => void } }

const FB_ORIGIN = /^https:\/\/([a-z0-9-]+\.)?facebook\.com$/;

function loadSdk(cfg: EsConfig): Promise<FbSdk> {
  if (window.FB) return Promise.resolve(window.FB);
  return new Promise((resolve, reject) => {
    window.fbAsyncInit = () => {
      window.FB!.init({ appId: cfg.appId!, autoLogAppEvents: true, xfbml: false, version: cfg.graphVersion });
      resolve(window.FB!);
    };
    const s = document.createElement('script');
    s.src = 'https://connect.facebook.net/en_US/sdk.js';
    s.async = true; s.crossOrigin = 'anonymous';
    s.onerror = () => reject(new Error('Could not load Facebook. Check that nothing is blocking facebook.com.'));
    document.body.appendChild(s);
  });
}

export function EmbeddedSignup({ onConnected }: { onConnected: (text: string) => void }) {
  const cfg = useApi<EsConfig>('/waba/embedded-signup/config');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const got = useRef<{ code?: string; wabaId?: string; phoneNumberId?: string }>({});

  async function finish() {
    const { code, wabaId, phoneNumberId } = got.current;
    if (!code || !wabaId || !phoneNumberId) return;
    got.current = {};
    try {
      const r = await api<{ displayPhone: string | null; verifiedName: string | null }>('/waba/embedded-signup', { body: { code, wabaId, phoneNumberId } });
      onConnected(`Connected ${r.verifiedName ?? ''} ${r.displayPhone ?? ''}`.trim() + '.');
    } catch (e) { setError(errorText(e)); }
    setBusy(false);
  }

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (!FB_ORIGIN.test(e.origin)) return;
      let d: { type?: string; event?: string; data?: { waba_id?: string; phone_number_id?: string; current_step?: string } };
      try { d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch { return; }
      if (d?.type !== 'WA_EMBEDDED_SIGNUP') return;
      if (d.event === 'FINISH' || d.event === 'FINISH_ONLY_WABA') {
        got.current.wabaId = d.data?.waba_id; got.current.phoneNumberId = d.data?.phone_number_id;
        if (!got.current.phoneNumberId) { setError('Meta finished without a phone number. Add a number to the account and try again.'); setBusy(false); return; }
        void finish();
      } else if (d.event === 'CANCEL') { setError(`Setup was closed${d.data?.current_step ? ` at "${d.data.current_step}"` : ''}. Nothing was connected.`); setBusy(false); }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!cfg.data?.enabled) return null;
  return (
    <div className="mb-4 rounded-lg border border-line bg-canvas p-4">
      <p className="mb-3 text-sm">Fastest way: log in with Facebook, pick or create your WhatsApp Business account, and verify the number. We do the rest.</p>
      {error && <p role="alert" className="mb-2 text-sm text-danger">{error}</p>}
      <button className="btn btn-primary" disabled={busy} onClick={async () => {
        setError(null); setBusy(true); got.current = {};
        try {
          const FB = await loadSdk(cfg.data!);
          FB.login((r) => {
            const code = r.authResponse?.code;
            if (!code) { setError('Facebook login was cancelled.'); setBusy(false); return; }
            got.current.code = code; void finish();
          }, { config_id: cfg.data!.configId, response_type: 'code', override_default_response_type: true, extras: { setup: {}, sessionInfoVersion: 3 } });
        } catch (e) { setError(errorText(e)); setBusy(false); }
      }}>{busy ? 'Waiting for Facebook…' : 'Connect with Facebook'}</button>
    </div>
  );
}
