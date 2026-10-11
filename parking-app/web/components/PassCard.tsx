"use client";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import type { Booking } from "@/lib/contract";
import { inr, rel, when } from "@/lib/format";

export const WHATSAPP_NUMBER = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? "";

/** Pass status line (DRV-10). */
export function passStatus(b: Booking, now: number): { label: string; live: boolean } {
  if (b.status === "cancelled") return { label: "Cancelled", live: false };
  if (b.status === "pending_payment") return { label: "Confirming payment…", live: false };
  const from = Date.parse(b.from), to = Date.parse(b.to);
  if (b.status === "completed" || now >= to) return { label: "Completed", live: false };
  if (now < from) return { label: "Starts in " + rel(from - now), live: false };
  return { label: "Live · ends in " + rel(to - now), live: true };
}

/** One pass: real QR of the pass code (what staff scan in stage 7), details, extend and cancel. */
export function PassCard({ b, now, onExtend, onCancel, busy }: {
  b: Booking; now: number; onExtend?: () => void; onCancel?: () => void; busy?: boolean;
}) {
  const [qr, setQr] = useState("");
  useEffect(() => { QRCode.toString(b.code, { type: "svg", margin: 1, errorCorrectionLevel: "M" }).then(setQr).catch(() => setQr("")); }, [b.code]);
  const st = passStatus(b, now);
  const active = b.status === "confirmed" || b.status === "checked_in";
  const canExtend = active && now < Date.parse(b.to);
  const canCancel = b.status === "confirmed" && b.source !== "park_now" && now < Date.parse(b.from);
  return (
    <article className="pass" data-testid="pass" data-code={b.code}>
      <div className="ph"><div><h3>{b.lot_name}</h3><div style={{ fontSize: 13, opacity: 0.85 }}><span className="lotcode">{b.lot_code}</span></div></div>
        {b.source === "park_now" && <span className="tag">Park now</span>}</div>
      <div className="pb">
        <span className={`status ${st.live ? "live" : ""}`}>{st.label}</span>
        {active && qr && <div className="qr" role="img" aria-label={`Entry QR code for pass ${b.code}`} dangerouslySetInnerHTML={{ __html: qr }} />}
        <dl className="kv" style={{ margin: 0 }}>
          <dt>Pass</dt><dd className="mono">{b.code}</dd>
          <dt>Vehicle</dt><dd className="mono">{b.plate}</dd>
          <dt>From</dt><dd>{when(b.from)}</dd>
          <dt>Until</dt><dd>{when(b.to)}</dd>
          <dt>Paid</dt><dd className="num">{inr(b.total_paise)}{b.promo_code ? ` · ${b.promo_code}` : ""}</dd>
          <dt>Sent to</dt><dd className="num">WhatsApp {b.phone.replace(/^\+91(\d{5})(\d{5})$/, "+91 $1 $2")}</dd>
          {WHATSAPP_NUMBER && <><dt>Help</dt><dd><a href={`https://wa.me/${WHATSAPP_NUMBER}`}>WhatsApp us</a></dd></>}
        </dl>
        {(canExtend || canCancel) && (
          <div className="row2">
            {canExtend && onExtend && <button className="btn" type="button" disabled={busy} onClick={onExtend}>Extend 1 hour</button>}
            {canCancel && onCancel && <button className="btn ghost" type="button" disabled={busy} onClick={onCancel}>Cancel free</button>}
          </div>
        )}
      </div>
    </article>
  );
}
