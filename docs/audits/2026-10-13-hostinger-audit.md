# Hostinger audit — 13 Oct 2026

Read-only audit of the Hostinger account via the Hostinger connector. No changes were made.

## Verdict

The account has no shared/cloud hosting in use. Everything runs on one KVM 4 VPS (Coolify): mail, Coolify, n8n, CRM, billing, WhatsApp and client apps. Biggest risk: that single box is backed up only weekly (up to 7 days of data loss).

## Fix now

| # | Issue | Evidence | Fix |
|---|---|---|---|
| 1 | DKIM for marvice.tech broken | `default._domainkey` TXT = `v=DKIM1; k=rsa; p=MIIB` (key truncated). DMARC is `p=quarantine; adkim=s; aspf=s`. | Paste the full DKIM value from BillionMail into the TXT record. |
| 2 | Weekly backups only | 2 restore points: 2 Oct, 9 Oct 2026 (Hostinger PBS, KUL). | Daily DB backups to off-server S3 via Coolify (Cloudflare R2 / Backblaze B2). Keep Hostinger weekly as second layer. |
| 3 | 503 on marvice.tech and urbannightmedia.in | WebFetch returned 503; builder site returned 502. May be the session's network, not the sites. | Check in a browser; if real, the Coolify app behind it is down. |

## Soon

- SSH (22) open to any IP; Coolify panel public at coolify.marvice.tech. Restrict SSH to office IPs or Tailscale.
- Root `authorized_keys` messy: expired Hostinger-managed key (expired 5 Oct) merged on one line with a `claude-billionmail` key; duplicate `coolify-generated-ssh-key`. Clean up; remove the agent key once BillionMail work is done.
- No reboot in 39.5 days; kernel security patches need a reboot. Schedule a quiet-hour reboot (2–5 min full outage incl. mail).
- RAM 48% → 66% (8.3 → 11.1 GB of 16 GB) over 6–12 Oct; mostly a step on 7 Oct, then slow creep. Alert at 85%; find the growing container.
- `urbanightmedia.online` is a misspelling (one "n"). Apex does not resolve; zone holds malformed records (`superadmin.urbannightmedia.online` etc., which resolve under the wrong name). Only `superadmin.` and `api.` point to the VPS. If unused, turn off auto-renew before 23 Feb 2027 (saves ₹3,506.44/yr).

## VPS (srv1373084.hstgr.cloud, 91.108.110.216)

| Metric | Value (6–12 Oct 2026) |
|---|---|
| Plan | KVM 4: 4 vCPU, 16 GB RAM, 200 GB disk, Ubuntu 24.04 + Coolify |
| CPU | 16–21% typical, peak 32% |
| RAM | 66% now, rising |
| Disk | 42 GB (21%); brief spike to 94 GB on 7 Oct |
| Firewall `marvice-coolify-prod` | 22, 80, 443 TCP+UDP, 25, 465, 587, 993, ICMP — all from any |
| Billing | ₹47,976 / 2 yrs, next 30 Jan 2028, auto-renew on |

## Domains

| Domain | Renewal / yr | Expires | Points to | Verdict |
|---|---|---|---|---|
| marvice.tech | ₹6,216.44 | 14 Feb 2027 | VPS (mail, Coolify, n8n, CRM, billing…) | Keep — core |
| urbanightmedia.online | ₹3,506.44 | 22 Mar 2027 | Apex not resolving; misspelt | Drop if `api.`/`superadmin.` unused |
| urbannightmedia.in | ₹899 (2-yr term) | 27 May 2027 | VPS | Keep |
| thepaayaproject.in + .com | ₹2,415.44 | 17 Jun 2027 | Hostinger parking | Parked |
| beyondconceptz.in + .com | ₹2,415.44 | 7 Sep 2027 | Hostinger parking IP | Parked |
| hourhand.cloud | ₹2,536.44 | 11 Oct 2027 | Hostinger parking | New (11 Oct 2026) |

Parked + typo domains: ₹10,874/yr. Client brands should move to client billing. Prices as billed; the API does not show GST treatment.

## Other subscriptions

- Premium Web Hosting: no websites on it; auto-renew off; expires 14 Feb 2027 (renewal ₹2,628). Let lapse unless used under another login.
- Reach 100 (email marketing): trial, auto-renews ₹1,548 on 7 Sep 2027.
- Website Builder site `billie-builder-hjtgzfgd5hieqlbd.hostingersite.com` returned 502.

## Actions taken 13 Oct 2026

- 14:51 UTC — VPS restarted (action 119837671, success; state running).
- urbanightmedia.online auto-renew disabled (subscription AzyyJIVEa3anu38bW now `non_renewing`, expires 22 Mar 2027).
- SSH key cleanup NOT done via API: the remove-key operation does not let you choose which key, so it could strip Coolify's key. Do it on the server instead.
- SSH-to-my-IP NOT done: waiting for the office IP(s).

## Pending / next session

1. DKIM fix — needs the full key from BillionMail.
2. Coolify container audit — needs a read-only token stored as `COOLIFY_TOKEN` in the session environment (never in chat or git), and the simple-workflow `pre-bash-safety.sh` hook allowing calls to coolify.marvice.tech.
3. Revoke the Coolify token that was pasted in chat on 13 Oct.

Not visible via the Hostinger API: container health, app logs, database sizes, SSH password-auth setting.
