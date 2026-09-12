import { redirect } from "next/navigation";
export default async function PlansRedirect({ searchParams }: { searchParams: Promise<{ tab?: string }> }) { const sp = await searchParams; redirect(sp.tab === "offers" ? "/offers?src=zen" : "/offers"); }
