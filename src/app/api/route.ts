import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  try {
    // Lightweight query that keeps Supabase PostgreSQL active and prevents inactivity pausing
    const userCount = await db.user.count();
    return NextResponse.json({
      status: "ok",
      database: "active",
      userCount,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { status: "error", message: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}