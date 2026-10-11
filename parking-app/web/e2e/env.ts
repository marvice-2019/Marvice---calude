// Ports and secrets for the local end-to-end stack only. Must match e2e/start-api.mjs.
const pgAdmin = process.env.TEST_PG_URL ?? "postgres://postgres@127.0.0.1:54329/postgres";

export const E2E = {
  dbUrl: pgAdmin.replace(/\/[^/]*$/, "/bayline_e2e"),
  apiPort: 3100,
  apiUrl: "http://127.0.0.1:3100",
  webPort: 3201,
  webUrl: "http://127.0.0.1:3201",
  webhookSecret: "e2e-webhook-secret"
};
