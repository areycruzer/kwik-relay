import { NextResponse } from 'next/server';
import { addCase, listCases, reset } from '@/lib/store.ts';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ cases: listCases() });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const phrase = typeof body?.callerPhrase === 'string' ? body.callerPhrase.trim() : '';
  const location = typeof body?.locationText === 'string' ? body.locationText.trim() : '';
  if (!phrase || !location) {
    return NextResponse.json({ error: 'callerPhrase and locationText are required.' }, { status: 400 });
  }
  const c = addCase(phrase, location);
  return NextResponse.json({ case: c }, { status: 201 });
}

export async function DELETE() {
  reset();
  return NextResponse.json({ ok: true, cases: listCases() });
}
