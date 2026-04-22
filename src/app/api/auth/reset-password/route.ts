import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/auth/password";
import { hashPasswordResetToken } from "@/lib/auth/password-reset";

const ResetPasswordSchema = z
  .object({
    token: z.string().trim().min(1, "Reset token is required"),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .max(72, "Password is too long"),
    confirmPassword: z.string().min(8, "Confirm your new password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const data = ResetPasswordSchema.parse(body);
    const hashedToken = hashPasswordResetToken(data.token);

    const verificationToken = await prisma.verificationToken.findUnique({
      where: { token: hashedToken },
    });

    if (!verificationToken || verificationToken.expires < new Date()) {
      if (verificationToken) {
        await prisma.verificationToken.delete({
          where: { token: hashedToken },
        });
      }

      return NextResponse.json(
        { success: false, error: "This reset link is invalid or has expired" },
        { status: 400 }
      );
    }

    const email = verificationToken.identifier.replace(/^password-reset:/, "");

    await prisma.$transaction([
      prisma.user.update({
        where: { email },
        data: { passwordHash: hashPassword(data.password) },
      }),
      prisma.verificationToken.deleteMany({
        where: { identifier: verificationToken.identifier },
      }),
      prisma.session.deleteMany({
        where: {
          user: { email },
        },
      }),
    ]);

    return NextResponse.json({
      success: true,
      message: "Password updated successfully",
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
        error: error instanceof Error ? error.message : "Failed to reset password",
      },
      { status: 500 }
    );
  }
}
