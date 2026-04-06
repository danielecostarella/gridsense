import { DashboardClient } from "@/components/dashboard/DashboardClient";
import { QueryProvider } from "@/components/ui/QueryProvider";

export default function Home() {
  return (
    <QueryProvider>
      <DashboardClient />
    </QueryProvider>
  );
}
