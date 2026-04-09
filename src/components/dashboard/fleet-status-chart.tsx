"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface FleetStatusChartProps {
  available: number;
  onTrip: number;
  maintenance: number;
  outOfService: number;
}

const COLORS = ["#22c55e", "#3b82f6", "#f59e0b", "#ef4444"];

export function FleetStatusChart({ available, onTrip, maintenance, outOfService }: FleetStatusChartProps) {
  const data = [
    { name: "Available", value: available },
    { name: "On Trip", value: onTrip },
    { name: "Maintenance", value: maintenance },
    { name: "Out of Service", value: outOfService },
  ].filter((d) => d.value > 0);

  return (
    <Card className="bg-white">
      <CardHeader>
        <CardTitle className="text-base font-semibold">Fleet Status</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="45%"
              innerRadius={60}
              outerRadius={95}
              paddingAngle={4}
              dataKey="value"
            >
              {data.map((_, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(value) => [`${value} vehicles`, ""]} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
