import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import {
  createPasswordResetToken,
  getPasswordResetExpiry,
  getPasswordResetIdentifier,
  hashPasswordResetToken,
} from "@/lib/auth/password-reset";
import { sendPasswordResetEmail } from "@/lib/email";

const ForgotPasswordSchema = z.object({
  email: z
    .string()
    .trim()
    .email("Enter a valid email address")
    .transform((value) => value.toLowerCase()),
});

const GENERIC_SUCCESS_MESSAGE =
  "If an account exists for that email, a password reset link has been generated.";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const data = ForgotPasswordSchema.parse(body);

    const user = await prisma.user.findUnique({
      where: { email: data.email },
      select: { email: true, passwordHash: true },
    });

    if (!user?.passwordHash) {
      return NextResponse.json({
        success: true,
        message: GENERIC_SUCCESS_MESSAGE,
      });
    }

    const rawToken = createPasswordResetToken();
    const hashedToken = hashPasswordResetToken(rawToken);
    const identifier = getPasswordResetIdentifier(user.email);
    const expires = getPasswordResetExpiry();
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.NEXTAUTH_URL ||
      "http://localhost:3000";
    const resetUrl = `${baseUrl}/auth/reset-password?token=${encodeURIComponent(rawToken)}`;

    await prisma.verificationToken.deleteMany({
      where: { identifier },
    });

    await prisma.verificationToken.create({
      data: {
        identifier,
        token: hashedToken,
        expires,
      },
    });

    const delivery = await sendPasswordResetEmail({
      email: user.email,
      resetUrl,
      expiresAt: expires,
    });

    return NextResponse.json({
      success: true,
      message: GENERIC_SUCCESS_MESSAGE,
      resetUrl: delivery.fallbackUrl,
      emailDelivered: delivery.delivered,
      expiresAt: expires.toISOString(),
    });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: error.issues[0]?.message ?? "Invalid input" },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to create reset link",
      },
      { status: 500 }
    );
  }
}
