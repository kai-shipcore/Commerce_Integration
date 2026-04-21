import { NextResponse } from "next/server";
import { getOpenApiDocument } from "@/lib/openapi";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  return NextResponse.json(getOpenApiDocument(baseUrl));
}
