import { toNextJsHandler } from "better-auth/next-js";
import { authEnabled, getAuth } from "@/lib/auth/auth";

const notAvailable = () => Response.json({ error: "sign_in_needs_postgres" }, { status: 404 });

export async function GET(request: Request) {
  return authEnabled() ? toNextJsHandler(getAuth()).GET(request) : notAvailable();
}

export async function POST(request: Request) {
  return authEnabled() ? toNextJsHandler(getAuth()).POST(request) : notAvailable();
}
