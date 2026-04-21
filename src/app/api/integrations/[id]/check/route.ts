/**
 * Code Guide:
 * This API route verifies whether a saved marketplace integration can be used.
 * Some platforms support a live API check today, while others only support
 * validating that the stored credentials are complete.
 */

import { NextResponse } from "next/server";
import { checkIntegrationConnection } from "@/lib/integrations/core/connection-check";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { result } = await checkIntegrationConnection(id);

    return NextResponse.json({
      success: result.success,
      data: result,
    });
  } catch (error: any) {
    if (error.message === "Integration not found") {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 404 }
      );
    }

    console.error("Error checking integration connection:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
