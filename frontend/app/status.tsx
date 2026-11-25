import { CircleCheck, CircleMinus, CircleX, TriangleAlert } from "lucide-react";

export function Status({ value }: { value: string }) {
  const tone = ["APPROVED", "ALLOW", "RECEIVED"].includes(value) ? "good"
    : ["REVIEW_REQUIRED", "UNKNOWN"].includes(value) ? "warn"
    : ["BLOCK", "RESTRICTED", "FETCH_FAILED"].includes(value) ? "bad" : "neutral";
  const Icon = { good: CircleCheck, warn: TriangleAlert, bad: CircleX, neutral: CircleMinus }[tone];
  const text = value.toLowerCase().replaceAll("_", " ").replace(/^./, (first) => first.toUpperCase());
  return <span className={"pill " + tone}><Icon size={14} aria-hidden="true" />{text}</span>;
}
