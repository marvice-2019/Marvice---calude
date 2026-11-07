import type { Metadata } from "next";

export const metadata: Metadata = { robots: { index: false, follow: false } };

// Interim admin styling (stage 2). Stage 5 replaces it with the full admin UI on the brand tokens.
const css = `
.admin-shell,.admin-shell *{box-sizing:border-box}
.admin-shell{min-height:100dvh;display:grid;place-items:center;padding:16px;background:#03070d;color:#eaf2f8;font:16px/1.5 system-ui,sans-serif}
.admin-card{width:min(100%,420px);padding:28px;border:1px solid rgba(255,255,255,.1);border-radius:16px;background:#08111b}
.admin-card h1{margin:0 0 16px;font-size:1.5rem}
.admin-form{display:grid;gap:14px}
.admin-form label{display:grid;gap:6px;color:#8da2b5;font-size:.9rem}
.admin-form input{min-height:44px;padding:0 12px;border:1px solid rgba(255,255,255,.18);border-radius:10px;background:#0e1b29;color:#eaf2f8;font-size:1rem}
.admin-card button{min-height:44px;padding:0 18px;border:0;border-radius:10px;background:#2bb8dc;color:#03070d;font-weight:700;font-size:1rem;cursor:pointer}
.admin-card button:disabled{opacity:.6}
.admin-card :focus-visible{outline:2px solid #eaf2f8;outline-offset:2px}
.admin-error{color:#ff8a8a;font-size:.9rem;min-height:1em;margin:0}
.admin-ok{color:#7fe3c4}
`;

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="admin-shell">
      <style>{css}</style>
      {children}
    </div>
  );
}
