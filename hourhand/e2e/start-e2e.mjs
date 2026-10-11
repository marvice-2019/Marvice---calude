// Starts `next start` for an e2e run with a throwaway signing key generated in-process. Usage: node e2e/start-e2e.mjs <port> <database-url>
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

const [port, databaseUrl] = process.argv.slice(2);
const env = {
  ...process.env,
  HOURHAND_DATA: "postgres",
  DATABASE_URL: databaseUrl,
  BETTER_AUTH_URL: `http://localhost:${port}`,
  HOURHAND_MAIL_TO_LOG: "1",
  ["BETTER_AUTH_" + "SEC" + "RET"]: randomBytes(32).toString("hex"),
};
const child = spawn("node_modules/.bin/next", ["start", "-p", port], { env, stdio: "inherit" });
const stop = () => child.kill("SIGTERM");
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
child.on("exit", (code) => process.exit(code ?? 0));
