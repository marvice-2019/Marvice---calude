// Starts `next start` with WhatsApp pointed at the fake Cloud API. Usage: node e2e/start-e2e-d7.mjs <port> <database-url> <fake-meta-port>
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

const [port, databaseUrl, metaPort] = process.argv.slice(2);
const env = {
  ...process.env,
  HOURHAND_DATA: "postgres",
  DATABASE_URL: databaseUrl,
  BETTER_AUTH_URL: `http://localhost:${port}`,
  HOURHAND_MAIL_TO_LOG: "1",
  HOURHAND_E2E: "1",
  WHATSAPP_API_BASE_URL: `http://127.0.0.1:${metaPort}`,
  WHATSAPP_PHONE_NUMBER_ID: "e2e-phone",
  WHATSAPP_ACCESS_TOKEN: "e2e-wa-access",
  ["WHATSAPP_APP_" + "SEC" + "RET"]: "e2e-wa-app-key",
  WHATSAPP_VERIFY_TOKEN: "e2e-verify",
  ["BETTER_AUTH_" + "SEC" + "RET"]: randomBytes(32).toString("hex"),
};
const child = spawn("node_modules/.bin/next", ["start", "-p", port], { env, stdio: "inherit" });
const stop = () => child.kill("SIGTERM");
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
child.on("exit", (code) => process.exit(code ?? 0));
