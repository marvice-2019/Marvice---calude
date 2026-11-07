import { menuChange, nightChange, updateSetting, updateZone } from "@/admin/content";
import { requireApiUser } from "@/auth/guard";
import type { Permission } from "@/auth/roles";
import { getDb } from "@/db";
import { BadBody, badBody, json, readJson } from "@/lib/http";

/**
 * Admin content mutations:
 *   /api/admin/content/menu      POST | PATCH | DELETE  { kind: "category" | "item", ... }
 *   /api/admin/content/nights    POST | PATCH | DELETE
 *   /api/admin/content/settings  PATCH { key, value }
 *   /api/admin/content/zones     PATCH { key, note?, seats?, minSpendRupees? }
 */
type Method = "POST" | "PATCH" | "DELETE";
const PERMISSION: Record<string, Permission> = { menu: "content:write", nights: "content:write", settings: "settings:write", zones: "settings:write" };

async function handle(req: Request, resource: string, method: Method) {
  const permission = PERMISSION[resource];
  if (!permission) return json({ ok: false, message: "Not found." }, 404);
  const user = await requireApiUser(req, permission);
  if (user instanceof Response) return user;
  let body: Record<string, unknown> = {};
  if (method === "DELETE") body = Object.fromEntries(new URL(req.url).searchParams);
  else {
    try {
      body = (await readJson(req)) as Record<string, unknown>;
    } catch (err) {
      if (err instanceof BadBody) return badBody();
      throw err;
    }
  }
  const db = getDb();
  const result =
    resource === "menu"
      ? await menuChange(db, user.id, method, body)
      : resource === "nights"
        ? await nightChange(db, user.id, method, body)
        : method !== "PATCH"
          ? ({ ok: false, status: 405, message: "Use PATCH." } as const)
          : resource === "settings"
            ? await updateSetting(db, user.id, body)
            : await updateZone(db, user.id, body);
  return result.ok ? json(result, method === "POST" ? 201 : 200) : json({ ok: false, message: result.message }, result.status);
}

type Ctx = { params: Promise<{ resource: string }> };
export const POST = async (req: Request, ctx: Ctx) => handle(req, (await ctx.params).resource, "POST");
export const PATCH = async (req: Request, ctx: Ctx) => handle(req, (await ctx.params).resource, "PATCH");
export const DELETE = async (req: Request, ctx: Ctx) => handle(req, (await ctx.params).resource, "DELETE");
