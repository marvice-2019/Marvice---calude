import { authEnabled } from "./auth/auth";
import { hostPlan } from "./billing/account";
import { getPool } from "./data/pg-store";
import { whatsappConfig } from "./whatsapp-cloud";

/** Whether the booking form offers WhatsApp updates for this host: set up here, and the host's plan includes it. */
export async function whatsappOffered(hostId: string): Promise<boolean> {
  if (!whatsappConfig() || !authEnabled() || !process.env.DATABASE_URL) return false;
  return (await hostPlan(getPool(process.env.DATABASE_URL), hostId)) !== "free";
}
