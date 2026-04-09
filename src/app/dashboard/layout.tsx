import { Sidebar } from "@/components/layout/sidebar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="ml-64 flex flex-1 flex-col overflow-hidden">
        {children}
      </div>
    </div>
  );
}
