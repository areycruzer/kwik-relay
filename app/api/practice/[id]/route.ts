// Poll an in-flight practice call — stateless: client supplies the provider
// call id.  GET /api/practice/<id>?callId=<providerCallId>
import { NextResponse } from 'next/server';
import { fetchCall } from '@/lib/callee.ts';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const callId = new URL(req.url).searchParams.get('callId');
  if (!callId || !/^[A-Za-z0-9_-]{1,64}$/.test(callId)) {
    return NextResponse.json({ error: 'A valid callId query parameter is required.' }, { status: 400 });
  }
  try {
    const poll = await fetchCall(callId);
    return NextResponse.json({ practiceId: id, callId, ...poll });
  } catch (e) {
    return NextResponse.json({ practiceId: id, callId, phase: 'IN_FLIGHT', pollingError: e instanceof Error ? e.message : String(e) }, { status: 200 });
  }
}
