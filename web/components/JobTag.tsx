import { jobLabel, jobWhen } from "@/lib/format";

export function JobTag({ kind, at }: { kind: string; at?: string | null }) {
  const when = jobWhen(at);
  return <span className="job-tag">{when ? `${jobLabel(kind)} · ${when}` : jobLabel(kind)}</span>;
}
