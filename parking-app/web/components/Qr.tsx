"use client";
import QRCode from "qrcode";
import { useEffect, useState } from "react";

// Rendered on the device so a saved pass still shows at a basement gate with no signal.
export function Qr({ value, label }: { value: string; label: string }) {
  const [svg, setSvg] = useState("");
  useEffect(() => { QRCode.toString(value, { type: "svg", margin: 0, errorCorrectionLevel: "M" }).then(setSvg).catch(() => setSvg("")); }, [value]);
  return <div className="qr" role="img" aria-label={label} dangerouslySetInnerHTML={{ __html: svg }} />;
}
