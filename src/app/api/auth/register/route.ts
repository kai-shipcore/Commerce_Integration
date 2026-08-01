import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ConflictError } from "@/lib/errors";
import { AuthAccountService } from "@/lib/auth/service";

const RegisterSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters"),
  email: z
    .string()
    .trim()
    .email("Enter a valid email address")
    .transform((value) => value.toLowerCase()),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(72, "Password is too long"),
});

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const data = RegisterSchema.parse(body);

    const user = await AuthAccountService.register(data);

    return NextResponse.json(
      {
        success: true,
        data: user,
        message: "Account created successfully",
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: error.issues[0]?.message ?? "Invalid input" },
        { status: 400 }
      );
    }

    if (error instanceof ConflictError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 409 });
    }

    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
