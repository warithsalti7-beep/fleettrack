"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell,
} from "recharts";
import { formatAmount } from "@/lib/currency";
import type { Currency } from "@/lib/currency";

const COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6"];

const revenueByDay = [
  { day: "Mon", revenue: 12400, trips: 32 },
  { day: "Tue", revenue: 15800, trips: 41 },
  { day: "Wed", revenue: 13200, trips: 35 },
  { day: "Thu", revenue: 18900, trips: 49 },
  { day: "Fri", revenue: 21500, trips: 56 },
  { day: "Sat", revenue: 24800, trips: 64 },
  { day: "Sun", revenue: 17200, trips: 45 },
];

const revenueByMonth = [
  { month: "Jan", revenue: 284000 },
  { month: "Feb", revenue: 312000 },
  { month: "Mar", revenue: 298000 },
  { month: "Apr", revenue: 345000 },
  { month: "May", revenue: 372000 },
  { month: "Jun", revenue: 398000 },
  { month: "Jul", revenue: 421000 },
  { month: "Aug", revenue: 403000 },
  { month: "Sep", revenue: 389000 },
  { month: "Oct", revenue: 415000 },
  { month: "Nov", revenue: 368000 },
  { month: "Dec", revenue: 442000 },
];

const paymentMethodData = [
  { name: "Cash", value: 45 },
  { name: "Card", value: 35 },
  { name: "Mobile", value: 20 },
];

const tripsByHour = [
  { hour: "00", trips: 12 },
  { hour: "02", trips: 8 },
  { hour: "04", trips: 5 },
  { hour: "06", trips: 18 },
  { hour: "08", trips: 52 },
  { hour: "10", trips: 38 },
  { hour: "12", trips: 45 },
  { hour: "14", trips: 41 },
  { hour: "16", trips: 38 },
  { hour: "18", trips: 65 },
  { hour: "20", trips: 58 },
  { hour: "22", trips: 32 },
];

const topDrivers = [
  { name: "Ahmed Malik", trips: 89, revenue: 32400, rating: 4.9 },
  { name: "Sara Johnson", trips: 82, revenue: 29800, rating: 4.8 },
  { name: "James Lee", trips: 76, revenue: 27500, rating: 4.7 },
  { name: "Maria Garcia", trips: 71, revenue: 26100, rating: 4.8 },
  { name: "Tom Wilson", trips: 68, revenue: 24800, rating: 4.6 },
];

export function AnalyticsClient({ currency }: { currency: Currency }) {
  const avgFare = formatAmount(285, currency);

  return (
    <main className="flex-1 p-6 space-y-6 overflow-y-auto">
      {/* Summary KPIs */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Avg. Trip Fare", value: avgFare, change: "+5.2%" },
          { label: "Avg. Trip Distance", value: "7.3 km", change: "+1.8%" },
          { label: "Avg. Trip Duration", value: "22 min", change: "-2.1%" },
          { label: "Fleet Efficiency", value: "73%", change: "+4.5%" },
        ].map((kpi) => (
          <div key={kpi.label} className="rounded-lg border bg-white p-5">
            <div className="text-sm font-medium text-gray-500">{kpi.label}</div>
            <div className="mt-1 text-2xl font-bold text-gray-900">{kpi.value}</div>
            <div className="mt-1 text-sm font-medium text-green-600">{kpi.change} this month</div>
          </div>
        ))}
      </div>

      {/* Revenue by Day */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="bg-white">
          <CardHeader>
            <CardTitle className="text-base">Revenue by Day of Week</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={revenueByDay}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip formatter={(v) => [formatAmount(Number(v), currency), "Revenue"]} />
                <Bar dataKey="revenue" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="bg-white">
          <CardHeader>
            <CardTitle className="text-base">Payment Methods</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={paymentMethodData}
                  cx="50%"
                  cy="45%"
                  outerRadius={85}
                  dataKey="value"
                  label={({ name, value }) => `${name} ${value}%`}
                >
                  {paymentMethodData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Monthly Revenue */}
      <Card className="bg-white">
        <CardHeader>
          <CardTitle className="text-base">Monthly Revenue (Current Year)</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={revenueByMonth}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip formatter={(v) => [formatAmount(Number(v ?? 0), currency), "Revenue"]} />
              <Line type="monotone" dataKey="revenue" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Trips by Hour + Top Drivers */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="bg-white">
          <CardHeader>
            <CardTitle className="text-base">Trip Demand by Hour</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={tripsByHour}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="hour" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => [v, "Trips"]} />
                <Bar dataKey="trips" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="bg-white">
          <CardHeader>
            <CardTitle className="text-base">Top Performing Drivers</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="px-4 py-2.5 text-left font-medium text-gray-500">Driver</th>
                  <th className="px-4 py-2.5 text-center font-medium text-gray-500">Trips</th>
                  <th className="px-4 py-2.5 text-center font-medium text-gray-500">Revenue</th>
                  <th className="px-4 py-2.5 text-center font-medium text-gray-500">Rating</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {topDrivers.map((d, i) => (
                  <tr key={d.name}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-400 text-xs">#{i + 1}</span>
                        <span className="font-medium text-gray-900">{d.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center text-gray-600">{d.trips}</td>
                    <td className="px-4 py-3 text-center font-semibold text-green-700">
                      {formatAmount(d.revenue, currency)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-yellow-500">★</span> {d.rating}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
