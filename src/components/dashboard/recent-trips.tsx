import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MapPin, Clock } from "lucide-react";
import { formatCurrency, formatDateTime, getStatusColor } from "@/lib/utils";

interface Trip {
  id: string;
  pickupAddress: string;
  dropoffAddress: string;
  status: string;
  fare: number | null;
  createdAt: Date;
  driver: { name: string };
  vehicle: { plateNumber: string };
}

interface RecentTripsProps {
  trips: Trip[];
}

export function RecentTrips({ trips }: RecentTripsProps) {
  return (
    <Card className="bg-white">
      <CardHeader>
        <CardTitle className="text-base font-semibold">Recent Trips</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y">
          {trips.length === 0 && (
            <p className="px-6 py-8 text-center text-sm text-gray-500">No trips yet</p>
          )}
          {trips.map((trip) => (
            <div key={trip.id} className="px-6 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <MapPin className="h-3.5 w-3.5 text-green-500 shrink-0" />
                    <span className="text-sm font-medium text-gray-900 truncate">{trip.pickupAddress}</span>
                  </div>
                  <div className="flex items-center gap-2 mb-2">
                    <MapPin className="h-3.5 w-3.5 text-red-500 shrink-0" />
                    <span className="text-sm text-gray-500 truncate">{trip.dropoffAddress}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-400">
                    <span>{trip.driver.name}</span>
                    <span>·</span>
                    <span>{trip.vehicle.plateNumber}</span>
                    <span>·</span>
                    <Clock className="h-3 w-3" />
                    <span>{formatDateTime(trip.createdAt)}</span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${getStatusColor(trip.status)}`}>
                    {trip.status.replace("_", " ")}
                  </span>
                  {trip.fare && (
                    <span className="text-sm font-semibold text-gray-900">
                      {formatCurrency(trip.fare)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
