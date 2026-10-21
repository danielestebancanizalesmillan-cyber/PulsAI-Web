import { NextResponse } from "next/server";
import { checkGatewayStatus } from "@/lib/gateway";

export async function GET() {
    const status = await checkGatewayStatus();
    return NextResponse.json(status);
}
