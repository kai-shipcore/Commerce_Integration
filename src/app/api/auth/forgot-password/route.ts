import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthAccountService } from "@/lib/auth/service";

const ForgotPasswordSchema = z.object({
  email: z
    .string()
    .trim()
    .email("Enter a valid email address")
    .transform((value) => value.toLowerCase()),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const data = ForgotPasswordSchema.parse(body);

    const result = await AuthAccountService.requestPasswordReset(data.email);
    return NextResponse.json(result);
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
