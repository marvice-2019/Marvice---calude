// Starts `next start` for the B4 e2e run against the fake Google, with throwaway keys made in-process.
// Usage: node e2e/start-e2e-b4.mjs <port> <database-url> <fake-google-port>
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

const [port, databaseUrl, googlePort] = process.argv.slice(2);
const env = {
  ...process.env,
  HOURHAND_DATA: "postgres",
  DATABASE_URL: databaseUrl,
  BETTER_AUTH_URL: `http://localhost:${port}`,
  HOURHAND_MAIL_TO_LOG: "1",
  HOURHAND_E2E: "1",
  GOOGLE_API_BASE_URL: `http://127.0.0.1:${googlePort}`,
  GOOGLE_CLIENT_ID: "fake-client-id.apps.googleusercontent.com",
  ["GOOGLE_CLIENT_" + "SEC" + "RET"]: "fake-client-value",
  TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  ["BETTER_AUTH_" + "SEC" + "RET"]: randomBytes(32).toString("hex"),
};
const child = spawn("node_modules/.bin/next", ["start", "-p", port], { env, stdio: "inherit" });
const stop = () => child.kill("SIGTERM");
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
child.on("exit", (code) => process.exit(code ?? 0));
