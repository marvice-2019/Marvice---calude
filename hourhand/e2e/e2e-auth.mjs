// Sign-in end to end against the local server only. Usage: node e2e/e2e-auth.mjs <port> <server-log-path>
import { readFileSync } from "node:fs";

/** The last sign-in link the log mailer printed for `email` (the email's "Sign in:" line). */
const lastLink = (text, email) => [...text.matchAll(/\[dev\] email to ([^:]+): Your Hourhand sign-in link\n[\s\S]*?\nSign in: (\S+)/g)]
  .filter((m) => m[1] === email).at(-1)?.[2];

const [port, logPath] = process.argv.slice(2);
const B = `http://localhost:${port}`;
let fail = 0;
const check = (ok, label) => { if (!ok) fail++; console.log(`${ok ? "OK  " : "FAIL"} ${label}`); };
const t = () => AbortSignal.timeout(15000);

/** A minimal cookie jar: name -> value, plus the raw Set-Cookie headers seen. */
function jar() {
  const cookies = new Map();
  const seen = [];
  return {
    seen,
    header: () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
    take(res) {
      for (const raw of res.headers.getSetCookie()) {
        seen.push(raw);
        const [pair] = raw.split(";");
        const i = pair.indexOf("=");
        const name = pair.slice(0, i), value = pair.slice(i + 1);
        if (/max-age=0|expires=thu, 01 jan 1970/i.test(raw) || value === "") cookies.delete(name); else cookies.set(name, value);
      }
    },
  };
}

async function get(path, j) {
  const res = await fetch(B + path, { redirect: "manual", headers: j ? { cookie: j.header() } : {}, signal: t() });
  j?.take(res);
  return res;
}

async function requestLink(email) {
  const res = await fetch(`${B}/api/auth/sign-in/magic-link`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: B },
    body: JSON.stringify({ email, callbackURL: "/dashboard/event-types", errorCallbackURL: "/sign-in?error=link" }),
    signal: t(),
  });
  await new Promise((r) => setTimeout(r, 300));
  return { status: res.status, url: lastLink(readFileSync(logPath, "utf8"), email) };
}

async function signIn(email) {
  const j = jar();
  const { status, url } = await requestLink(email);
  check(status === 200 && url, `magic link requested for ${email} -> ${status}`);
  const verify = await get(url.replace(/^https?:\/\/[^/]+/, ""), j);
  return { j, verify };
}

await new Promise((r) => setTimeout(r, 2500));

// a. signed out
const out = await get("/dashboard/event-types");
check(out.status === 307 && (out.headers.get("location") ?? "").includes("/sign-in"), `signed-out dashboard -> ${out.status} ${out.headers.get("location")}`);

// b. Priya signs in
const priya = await signIn("priya@example.in");
const sessionCookie = priya.j.seen.find((c) => /session_token=/.test(c)) ?? "";
check(priya.verify.status >= 300 && priya.verify.status < 400, `verify link -> ${priya.verify.status} to ${priya.verify.headers.get("location")}`);
check(/httponly/i.test(sessionCookie) && /samesite=lax/i.test(sessionCookie), `session cookie is HttpOnly + SameSite=Lax: ${sessionCookie.split(";").slice(1).join(";").trim()}`);

// c. dashboard shows Priya's data, not Arun's
const dash = await get("/dashboard/bookings", priya.j);
const html = await dash.text();
check(dash.status === 200 && !html.includes("Divya Menon"), `bookings with session -> ${dash.status}, Arun's guest not shown`);
const types = await (await get("/dashboard/event-types", priya.j)).text();
check(/coaching|Coaching/.test(types) && !/\bchat\b/i.test(types.replace(/chat-/g, "")), "event types show Priya's (coaching), not Arun's (chat)");

// a link works once
const { url: usedOnce } = await requestLink("priya@example.in");
await get(usedOnce.replace(/^https?:\/\/[^/]+/, ""), jar());
const again = await get(usedOnce.replace(/^https?:\/\/[^/]+/, ""), jar());
check((again.headers.get("location") ?? "").includes("error"), `reusing a link -> ${again.status} ${again.headers.get("location")}`);

// d. a new host gets a valid slug
const fresh = await signIn("newhost@example.com");
const settings = await (await get("/dashboard/settings", fresh.j)).text();
check(settings.includes("newhost@example.com"), "new host is signed in and sees their settings");

// e. sign out of all devices, using a second session for Priya
const priya2 = await signIn("priya@example.in");
const settingsPage = await get("/dashboard/settings", priya2.j);
check(settingsPage.status === 200, `Priya's second session opens settings -> ${settingsPage.status}`);
const revoke = await fetch(`${B}/api/auth/revoke-sessions`, { method: "POST", headers: { cookie: priya2.j.header(), origin: B, "content-type": "application/json" }, body: "{}", signal: t() });
check(revoke.status === 200, `revoke all sessions -> ${revoke.status}`);
const oldCookie = await get("/dashboard/event-types", priya.j);
check(oldCookie.status === 307, `first session after revoke -> ${oldCookie.status} (expect redirect to sign-in)`);

// f. public pages still work signed out
const pub = await get("/priya/coaching");
check(pub.status === 200, `public booking page -> ${pub.status}`);
const from = new Date().toISOString(), to = new Date(Date.now() + 7 * 864e5).toISOString();
const slots = await get(`/api/slots?slug=priya&event=coaching&from=${from}&to=${to}&tz=Asia/Kolkata`);
check(slots.status === 200, `slots API signed out -> ${slots.status}`);

process.exit(fail ? 1 : 0);
