// Starts `next start` against the fake iCloud only, with throwaway keys. Usage: node e2e/start-e2e-icloud.mjs <port> <database-url> <fake-caldav-port>
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

const [port, databaseUrl, calPort] = process.argv.slice(2);
const env = {
  ...process.env,
  HOURHAND_DATA: "postgres",
  DATABASE_URL: databaseUrl,
  BETTER_AUTH_URL: `http://localhost:${port}`,
  HOURHAND_MAIL_TO_LOG: "1",
  HOURHAND_E2E: "1",
  ICLOUD_CALDAV_URL: `http://127.0.0.1:${calPort}`,
  TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  ["BETTER_AUTH_" + "SEC" + "RET"]: randomBytes(32).toString("hex"),
};
delete env.GOOGLE_CLIENT_ID;
delete env.MICROSOFT_CLIENT_ID;
const child = spawn("node_modules/.bin/next", ["start", "-p", port], { env, stdio: "inherit" });
const stop = () => child.kill("SIGTERM");
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
child.on("exit", (code) => process.exit(code ?? 0));
