import { botWebhook } from "@/lib/bot";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    return await botWebhook()(req);
  } catch (e) {
    console.error("telegram webhook", e);
    return new Response("ok"); // Telegram не має повторювати апдейт нескінченно
  }
}
export async function GET() { return Response.json({ ok: true }); }
