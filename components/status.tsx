import { Archive, Ban, CircleCheck, CircleX, Clock, type LucideIcon } from "lucide-react";
import { ICON } from "@/components/icon";

type Tone = "ok" | "wait" | "bad" | "off";

const STATES: Record<string, { tone: Tone; icon: LucideIcon; word: string }> = {
  approved: { tone: "ok", icon: CircleCheck, word: "Approved" },
  pending: { tone: "wait", icon: Clock, word: "Pending" },
  scanning: { tone: "wait", icon: Clock, word: "Scanning" },
  review: { tone: "wait", icon: Clock, word: "In review" },
  rejected: { tone: "bad", icon: CircleX, word: "Rejected" },
  suspended: { tone: "bad", icon: Ban, word: "Suspended" },
  archived: { tone: "off", icon: Archive, word: "Archived" },
  banned: { tone: "bad", icon: Ban, word: "Banned" },
  active: { tone: "ok", icon: CircleCheck, word: "Active" },
};

/**
 * A review or publication state: an icon and a word in a semantic colour.
 * Never the brand colour, never colour alone, never a pill.
 */
export function Status({ value }: { value: string }) {
  const s = STATES[value] ?? { tone: "off" as Tone, icon: Clock, word: value.charAt(0).toUpperCase() + value.slice(1) };
  const Icon = s.icon;
  return (
    <span className={`dx-st dx-st-${s.tone}`}>
      <Icon size={16} {...ICON} />
      {s.word}
    </span>
  );
}
