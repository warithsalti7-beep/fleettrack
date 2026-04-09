"use client";

import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, Legend,
} from "recharts";

const COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6"];

// Static analytics data (in production this would come from API)
const revenueByDay = [
  { day: "Mon", revenue: 1240, trips: 32 },
  { day: "Tue", revenue: 1580, trips: 41 },
  { day: "Wed", revenue: 1320, trips: 35 },
  { day: "Thu", revenue: 1890, trips: 49 },
  { day: "Fri", revenue: 2150, trips: 56 },
  { day: "Sat", revenue: 2480, trips: 64 },
  { day: "Sun", revenue: 1720, trips: 45 },
];

const revenueByMonth = [
  { month: "Jan", revenue: 28400 },
  { month: "Feb", revenue: 31200 },
  { month: "Mar", revenue: 29800 },
  { month: "Apr", revenue: 34500 },
  { month: "May", revenue: 37200 },
  { month: "Jun", revenue: 39800 },
  { month: "Jul", revenue: 42100 },
  { month: "Aug", revenue: 40300 },
  { month: "Sep", revenue: 38900 },
  { month: "Oct", revenue: 41500 },
  { month: "Nov", revenue: 36800 },
  { month: "Dec", revenue: 44200 },
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
  { name: "Ahmed Malik", trips: 89, revenue: 3240, rating: 4.9 },
  { name: "Sara Johnson", trips: 82, revenue: 2980, rating: 4.8 },
  { name: "James Lee", trips: 76, revenue: 2750, rating: 4.7 },
  { name: "Maria Garcia", trips: 71, revenue: 2610, rating: 4.8 },
  { name: "Tom Wilson", trips: 68, revenue: 2480, rating: 4.6 },
];

export default function AnalyticsPage() {
  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <Topbar title="Analytics & Reports" subtitle="Business intelligence for your fleet" />
      <main className="flex-1 p-6 space-y-6">
        {/* Summary KPIs */}
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: "Avg. Trip Fare", value: "$18.40", change: "+5.2%" },
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
                  <Tooltip formatter={(v) => [`$${v}`, "Revenue"]} />
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
                  <Pie data={paymentMethodData} cx="50%" cy="45%" outerRadius={85} dataKey="value" label={({ name, value }) => `${name} ${value}%`}>
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
                <Tooltip formatter={(v) => [`$${Number(v ?? 0).toLocaleString()}`, "Revenue"]} />
                <Line type="monotone" dataKey="revenue" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Trips by Hour */}
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

          {/* Top Drivers */}
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
                      <td className="px-4 py-3 text-center font-semibold text-green-700">${d.revenue.toLocaleString()}</td>
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
    </div>
  );
}
