import { FunnelEditorView, type EditorSP } from "@/components/funnel-editor";

export const dynamic = "force-dynamic";
export default async function FunnelEditor({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<EditorSP> }) {
  const { id } = await params; const sp = await searchParams;
  return <FunnelEditorView id={id} sp={sp} kind="funnel" />;
}
