import { NextResponse } from 'next/server';
import { unitRoster } from '@/lib/units.ts';

export const dynamic = 'force-dynamic';

export async function GET() {
  // Mask numbers in the API response — full E.164 stays server-side.
  return NextResponse.json({
    units: unitRoster().map((u) => ({ ...u, e164: u.e164.slice(0, 5) + '•••••' + u.e164.slice(-3) })),
  });
}
