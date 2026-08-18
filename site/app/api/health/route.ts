export async function GET() {
  return Response.json({ ok: true, result: { status: "ready", version: 1 } }, {
    headers: { "Cache-Control": "no-store" },
  });
}
