/**
 * Shared topbar rendered at the top of every /admin/* page.
 * Pure server-rendered — takes the user session as plain props.
 */
const ROLE_TONE: Record<string, string> = {
  admin:    "bg-[#3b7ff540] text-[#619af8]",
  employee: "bg-[#8b5cf640] text-[#a78bfa]",
  driver:   "bg-[#10b98140] text-[#34d399]",
};

export function AdminTopbar({
  email,
  role,
  name,
}: {
  email: string;
  role: string;
  name: string | null;
}) {
  return (
    <div
      role="banner"
      className="h-14 border-b border-[rgba(255,255,255,0.05)] bg-[#0c0f18] flex items-center justify-between px-6"
    >
      <div className="text-xs font-mono text-[#4d5a72]">
        FleetTrack · React migration preview
      </div>
      <div className="flex items-center gap-3">
        <span className={`text-[10px] uppercase tracking-wider font-mono px-2 py-0.5 rounded ${ROLE_TONE[role] ?? "bg-[#171c2b] text-[#8b96b0]"}`}>
          {role}
        </span>
        <span className="text-xs text-[#8b96b0]">
          {name || email}
        </span>
      </div>
    </div>
  );
}
