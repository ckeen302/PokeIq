import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { findUserByName, updateCredentials } from "@/lib/server/accounts";
import { PASSWORD_MAX, generateRecoveryCode, hashRecoveryCode, userFromRequest, verifyPassword } from "@/lib/server/auth";
import { guardAuthRequest, serverError } from "@/lib/server/auth-route";

/** POST /api/auth/recovery-code — { password } -> a fresh recovery code (the old one stops working). */

const bodySchema = z.object({ password: z.string().min(1).max(PASSWORD_MAX) });

export async function POST(request: NextRequest) {
  const blocked = guardAuthRequest(request, "recovery-code", 5, 1);
  if (blocked) return blocked;

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Enter your password." }, { status: 400 });

  try {
    const session = await userFromRequest(request);
    if (!session) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
    const user = await findUserByName(session.username);
    if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
      return NextResponse.json({ error: "Wrong password." }, { status: 401 });
    }
    const recoveryCode = generateRecoveryCode();
    await updateCredentials(user.id, { recoveryCodeHash: hashRecoveryCode(recoveryCode) });
    return NextResponse.json({ recoveryCode });
  } catch (err) {
    return serverError(err);
  }
}
