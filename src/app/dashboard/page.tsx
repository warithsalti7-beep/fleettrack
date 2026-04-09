import { prisma } from "@/lib/prisma";
import { Topbar } from "@/components/layout/topbar";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { FleetStatusChart } from "@/components/dashboard/fleet-status-chart";
import { RevenueChart } from "@/components/dashboard/revenue-chart";
import { RecentTrips } from "@/components/dashboard/recent-trips";
import { Car, Users, MapPin, TrendingUp, Wrench, Fuel } from "lucide-react";
import { subDays, format } from "date-fns";
import { getCurrency } from "@/lib/currency-server";
import { formatAmount } from "@/lib/currency";

async function getDashboardData() {
  const [
    totalVehicles,
    availableVehicles,
    onTripVehicles,
    maintenanceVehicles,
    outOfServiceVehicles,
    totalDrivers,
    availableDrivers,
    onTripDrivers,
    totalTrips,
    todayTrips,
    recentTrips,
    pendingMaintenance,
  ] = await Promise.all([
    prisma.vehicle.count(),
    prisma.vehicle.count({ where: { status: "AVAILABLE" } }),
    prisma.vehicle.count({ where: { status: "ON_TRIP" } }),
    prisma.vehicle.count({ where: { status: "MAINTENANCE" } }),
    prisma.vehicle.count({ where: { status: "OUT_OF_SERVICE" } }),
    prisma.driver.count(),
    prisma.driver.count({ where: { status: "AVAILABLE" } }),
    prisma.driver.count({ where: { status: "ON_TRIP" } }),
    prisma.trip.count(),
    prisma.trip.count({
      where: {
        createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      },
    }),
    prisma.trip.findMany({
      take: 8,
      orderBy: { createdAt: "desc" },
      include: {
        driver: { select: { name: true } },
        vehicle: { select: { plateNumber: true } },
      },
    }),
    prisma.maintenance.count({ where: { status: "SCHEDULED" } }),
  ]);

  // Revenue for last 7 days
  const revenueData = await Promise.all(
    Array.from({ length: 7 }, (_, i) => {
      const date = subDays(new Date(), 6 - i);
      const start = new Date(date.setHours(0, 0, 0, 0));
      const end = new Date(date.setHours(23, 59, 59, 999));
      return prisma.trip
        .aggregate({
          where: {
            status: "COMPLETED",
            completedAt: { gte: start, lte: end },
          },
          _sum: { fare: true },
          _count: true,
        })
        .then((r) => ({
          date: format(start, "MMM d"),
          revenue: r._sum.fare ?? 0,
          trips: r._count,
        }));
    })
  );

  const totalRevenue = await prisma.trip.aggregate({
    where: { status: "COMPLETED" },
    _sum: { fare: true },
  });

  return {
    totalVehicles,
    availableVehicles,
    onTripVehicles,
    maintenanceVehicles,
    outOfServiceVehicles,
    totalDrivers,
    availableDrivers,
    onTripDrivers,
    totalTrips,
    todayTrips,
    recentTrips,
    revenueData,
    pendingMaintenance,
    totalRevenue: totalRevenue._sum.fare ?? 0,
  };
}

export default async function DashboardPage() {
  const [data, currency] = await Promise.all([getDashboardData(), getCurrency()]);

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <Topbar title="Fleet Overview" subtitle="Monitor your entire taxi fleet in real-time" />
      <main className="flex-1 p-6 space-y-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard
            title="Total Vehicles"
            value={data.totalVehicles}
            subtitle={`${data.availableVehicles} available · ${data.onTripVehicles} on trip`}
            icon={Car}
            iconColor="text-blue-600"
            iconBg="bg-blue-50"
            trend={5.2}
            trendLabel="vs last month"
          />
          <KpiCard
            title="Active Drivers"
            value={data.totalDrivers}
            subtitle={`${data.availableDrivers} available · ${data.onTripDrivers} on trip`}
            icon={Users}
            iconColor="text-green-600"
            iconBg="bg-green-50"
            trend={2.1}
            trendLabel="vs last month"
          />
          <KpiCard
            title="Trips Today"
            value={data.todayTrips}
            subtitle={`${data.totalTrips} total all time`}
            icon={MapPin}
            iconColor="text-purple-600"
            iconBg="bg-purple-50"
            trend={-3.5}
            trendLabel="vs yesterday"
          />
          <KpiCard
            title="Total Revenue"
            value={formatAmount(data.totalRevenue, currency)}
            subtitle="All completed trips"
            icon={TrendingUp}
            iconColor="text-yellow-600"
            iconBg="bg-yellow-50"
            trend={8.7}
            trendLabel="vs last month"
          />
        </div>

        {/* Secondary KPIs */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard
            title="Maintenance Pending"
            value={data.pendingMaintenance}
            subtitle="Scheduled services"
            icon={Wrench}
            iconColor="text-orange-600"
            iconBg="bg-orange-50"
          />
          <KpiCard
            title="In Maintenance"
            value={data.maintenanceVehicles}
            subtitle="Vehicles being serviced"
            icon={Wrench}
            iconColor="text-red-600"
            iconBg="bg-red-50"
          />
          <KpiCard
            title="Out of Service"
            value={data.outOfServiceVehicles}
            subtitle="Requires attention"
            icon={Car}
            iconColor="text-red-600"
            iconBg="bg-red-50"
          />
          <KpiCard
            title="Fleet Utilization"
            value={
              data.totalVehicles > 0
                ? `${Math.round((data.onTripVehicles / data.totalVehicles) * 100)}%`
                : "0%"
            }
            subtitle="Vehicles currently active"
            icon={Fuel}
            iconColor="text-teal-600"
            iconBg="bg-teal-50"
          />
        </div>

        {/* Charts */}
        <div className="grid grid-cols-3 gap-4">
          <RevenueChart data={data.revenueData} currency={currency} />
          <FleetStatusChart
            available={data.availableVehicles}
            onTrip={data.onTripVehicles}
            maintenance={data.maintenanceVehicles}
            outOfService={data.outOfServiceVehicles}
          />
        </div>

        {/* Recent Trips */}
        <RecentTrips trips={data.recentTrips} />
      </main>
    </div>
  );
}
