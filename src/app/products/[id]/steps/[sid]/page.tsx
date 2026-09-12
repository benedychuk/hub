import { StepEditorView, type StepSP } from "@/components/step-editor";

export const dynamic = "force-dynamic";
export default async function ProductStepEditor({ params, searchParams }: { params: Promise<{ id: string; sid: string }>; searchParams: Promise<StepSP> }) {
  const { id, sid } = await params; const sp = await searchParams;
  return <StepEditorView id={id} sid={sid} sp={sp} kind="product" />;
}
