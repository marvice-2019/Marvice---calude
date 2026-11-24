# Lead form → n8n

The selection request form (contact page and the slide-in panel on every page) posts JSON to `LEAD_ENDPOINT` in `_build/data.py`. While that is empty, the form opens a pre-filled email to sales@luftek.in instead, so no lead is lost. If the endpoint errors or is unreachable, the form also falls back to email.

## Set up (about 10 minutes)

1. In n8n: **Import from file** → `n8n-luftek-leads.json`.
2. Open **Email sales** and attach a Gmail credential for the mailbox that should send the alerts (or swap the node for SMTP / Send Email).
3. Activate the workflow and copy the **Production URL** of **Lead webhook** (ends in `/webhook/luftek-lead`).
4. Paste it into `LEAD_ENDPOINT = "..."` in `_build/data.py`, run `python3 luftek-website/_build/build.py`, commit, and redeploy.

The webhook only accepts browser posts from luftek.marvice.tech, luftek.in and www.luftek.in (CORS). It rejects payloads with no name, an invalid email or a filled honeypot (422). It retries the email 3 times and returns 502 if delivery still fails; the site then falls back to email.

## Payload

`ref, category, product, application, airflow, quantity, city, project, timeline, name, company, email, phone, role, message, page, submitted_at, source{utm_source, utm_medium, utm_campaign, utm_term, utm_content, gclid, fbclid, landing, referrer}`

## Worth adding next

A Google Sheets "Append row" node after **Valid lead?**, for a running lead log with source and campaign, which is the basis for cost-per-lead reporting.
