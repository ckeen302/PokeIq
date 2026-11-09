import "server-only";
import { NextResponse } from "next/server";
import { identitiesOf } from "../accounts";
import { emailEnabled } from "./config";

export const NO_STORE = { "Cache-Control": "no-store" };

/** Every email endpoint answers 404 while email is switched off. */
export function emailOff(): NextResponse | null {
  return emailEnabled() ? null : NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
}

/** The trainer's Discord / Google address, to prefill (never anyone else's). */
export async function providerEmail(profileId: string): Promise<string | null> {
  const list = await identitiesOf(profileId).catch(() => []);
  return list.find((i) => i.email)?.email ?? null;
}
