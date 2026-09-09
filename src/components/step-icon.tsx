import { MessageSquare, GraduationCap, ClipboardList, BarChart3, CheckSquare, HelpCircle } from "lucide-react";
const ICONS: Record<string, React.ReactNode> = { message: <MessageSquare size={14} />, lesson: <GraduationCap size={14} />, assignment: <ClipboardList size={14} />, survey: <BarChart3 size={14} />, quiz: <CheckSquare size={14} />, question: <HelpCircle size={14} /> };
/** Іконка типу кроку воронки. */
export function StepIcon({ type, size }: { type: string; size?: number }) { return <span className={`steptype ${type}`} style={size ? { width: size, height: size } : undefined}>{ICONS[type] ?? ICONS.message}</span>; }
