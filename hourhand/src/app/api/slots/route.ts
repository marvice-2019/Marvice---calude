import { NextResponse, type NextRequest } from "next/server";
import { handleGetSlots } from "@/lib/booking";
import { store } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { status, body } = await handleGetSlots(store, request.nextUrl.searchParams, new Date());
  return NextResponse.json(body, { status });
}
