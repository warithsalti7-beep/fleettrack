import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { subDays, subHours, addDays } from "date-fns";
import path from "path";

const dbPath = path.join(process.cwd(), "dev.db");
const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("🌱 Seeding FleetTrack database...");

  // Clean existing data
  await prisma.fuelLog.deleteMany();
  await prisma.maintenance.deleteMany();
  await prisma.trip.deleteMany();
  await prisma.driverVehicle.deleteMany();
  await prisma.driver.deleteMany();
  await prisma.vehicle.deleteMany();

  // Create Vehicles
  const vehicles = await Promise.all([
    prisma.vehicle.create({
      data: {
        plateNumber: "NYC-1042",
        make: "Toyota",
        model: "Camry",
        year: 2022,
        color: "Yellow",
        status: "ON_TRIP",
        fuelType: "HYBRID",
        fuelLevel: 72,
        mileage: 48230,
        lastService: subDays(new Date(), 45),
        nextService: addDays(new Date(), 15),
        latitude: 40.7589,
        longitude: -73.9851,
      },
    }),
    prisma.vehicle.create({
      data: {
        plateNumber: "NYC-2387",
        make: "Honda",
        model: "Accord",
        year: 2021,
        color: "White",
        status: "AVAILABLE",
        fuelType: "PETROL",
        fuelLevel: 88,
        mileage: 62410,
        lastService: subDays(new Date(), 30),
        nextService: addDays(new Date(), 60),
        latitude: 40.7614,
        longitude: -73.9776,
      },
    }),
    prisma.vehicle.create({
      data: {
        plateNumber: "NYC-3591",
        make: "Ford",
        model: "Fusion",
        year: 2020,
        color: "Silver",
        status: "MAINTENANCE",
        fuelType: "HYBRID",
        fuelLevel: 45,
        mileage: 89150,
        lastService: subDays(new Date(), 90),
        nextService: new Date(),
      },
    }),
    prisma.vehicle.create({
      data: {
        plateNumber: "NYC-4823",
        make: "Chevrolet",
        model: "Malibu",
        year: 2023,
        color: "Black",
        status: "AVAILABLE",
        fuelType: "PETROL",
        fuelLevel: 91,
        mileage: 18700,
        lastService: subDays(new Date(), 10),
        nextService: addDays(new Date(), 80),
        latitude: 40.7505,
        longitude: -73.9934,
      },
    }),
    prisma.vehicle.create({
      data: {
        plateNumber: "NYC-5614",
        make: "Tesla",
        model: "Model 3",
        year: 2023,
        color: "White",
        status: "ON_TRIP",
        fuelType: "ELECTRIC",
        fuelLevel: 68,
        mileage: 22400,
        lastService: subDays(new Date(), 20),
        nextService: addDays(new Date(), 100),
        latitude: 40.7282,
        longitude: -73.7949,
      },
    }),
    prisma.vehicle.create({
      data: {
        plateNumber: "NYC-6742",
        make: "Hyundai",
        model: "Sonata",
        year: 2021,
        color: "Gray",
        status: "AVAILABLE",
        fuelType: "PETROL",
        fuelLevel: 55,
        mileage: 54320,
        lastService: subDays(new Date(), 60),
        nextService: addDays(new Date(), 30),
        latitude: 40.7549,
        longitude: -73.984,
      },
    }),
    prisma.vehicle.create({
      data: {
        plateNumber: "NYC-7391",
        make: "Kia",
        model: "K5",
        year: 2022,
        color: "Blue",
        status: "OUT_OF_SERVICE",
        fuelType: "PETROL",
        fuelLevel: 30,
        mileage: 71800,
        lastService: subDays(new Date(), 120),
      },
    }),
    prisma.vehicle.create({
      data: {
        plateNumber: "NYC-8155",
        make: "Nissan",
        model: "Altima",
        year: 2022,
        color: "Red",
        status: "AVAILABLE",
        fuelType: "PETROL",
        fuelLevel: 78,
        mileage: 38940,
        lastService: subDays(new Date(), 25),
        nextService: addDays(new Date(), 55),
        latitude: 40.768,
        longitude: -73.9819,
      },
    }),
  ]);

  console.log(`✅ Created ${vehicles.length} vehicles`);

  // Create Drivers
  const drivers = await Promise.all([
    prisma.driver.create({
      data: {
        name: "Ahmed Al-Rashid",
        email: "ahmed.rashid@fleettrack.io",
        phone: "+1-212-555-0101",
        licenseNumber: "DL-NY-204891",
        licenseExpiry: addDays(new Date(), 420),
        status: "ON_TRIP",
        rating: 4.9,
        totalTrips: 1247,
        joinedAt: subDays(new Date(), 730),
        address: "112 W 72nd St, New York, NY",
      },
    }),
    prisma.driver.create({
      data: {
        name: "Maria Santos",
        email: "maria.santos@fleettrack.io",
        phone: "+1-212-555-0102",
        licenseNumber: "DL-NY-318472",
        licenseExpiry: addDays(new Date(), 210),
        status: "AVAILABLE",
        rating: 4.8,
        totalTrips: 894,
        joinedAt: subDays(new Date(), 540),
        address: "45 Park Ave, New York, NY",
      },
    }),
    prisma.driver.create({
      data: {
        name: "James Okafor",
        email: "james.okafor@fleettrack.io",
        phone: "+1-212-555-0103",
        licenseNumber: "DL-NY-427183",
        licenseExpiry: addDays(new Date(), 560),
        status: "AVAILABLE",
        rating: 4.7,
        totalTrips: 723,
        joinedAt: subDays(new Date(), 480),
        address: "289 Lexington Ave, New York, NY",
      },
    }),
    prisma.driver.create({
      data: {
        name: "Liu Wei",
        email: "liu.wei@fleettrack.io",
        phone: "+1-212-555-0104",
        licenseNumber: "DL-NY-534920",
        licenseExpiry: addDays(new Date(), 25),
        status: "ON_TRIP",
        rating: 4.6,
        totalTrips: 1089,
        joinedAt: subDays(new Date(), 650),
        address: "67 Mott St, New York, NY",
      },
    }),
    prisma.driver.create({
      data: {
        name: "Sarah Johnson",
        email: "sarah.johnson@fleettrack.io",
        phone: "+1-212-555-0105",
        licenseNumber: "DL-NY-641837",
        licenseExpiry: addDays(new Date(), 380),
        status: "AVAILABLE",
        rating: 4.9,
        totalTrips: 567,
        joinedAt: subDays(new Date(), 310),
        address: "901 Amsterdam Ave, New York, NY",
      },
    }),
    prisma.driver.create({
      data: {
        name: "Miguel Fernandez",
        email: "miguel.fernandez@fleettrack.io",
        phone: "+1-212-555-0106",
        licenseNumber: "DL-NY-758294",
        licenseExpiry: addDays(new Date(), 600),
        status: "OFF_DUTY",
        rating: 4.5,
        totalTrips: 432,
        joinedAt: subDays(new Date(), 260),
        address: "34 Jackson Ave, Queens, NY",
      },
    }),
    prisma.driver.create({
      data: {
        name: "Aisha Patel",
        email: "aisha.patel@fleettrack.io",
        phone: "+1-212-555-0107",
        licenseNumber: "DL-NY-869145",
        licenseExpiry: addDays(new Date(), 450),
        status: "AVAILABLE",
        rating: 4.8,
        totalTrips: 389,
        joinedAt: subDays(new Date(), 200),
        address: "156 Queens Blvd, Queens, NY",
      },
    }),
  ]);

  console.log(`✅ Created ${drivers.length} drivers`);

  // Assign drivers to vehicles
  await Promise.all([
    prisma.driverVehicle.create({ data: { driverId: drivers[0].id, vehicleId: vehicles[0].id } }),
    prisma.driverVehicle.create({ data: { driverId: drivers[1].id, vehicleId: vehicles[1].id } }),
    prisma.driverVehicle.create({ data: { driverId: drivers[2].id, vehicleId: vehicles[3].id } }),
    prisma.driverVehicle.create({ data: { driverId: drivers[3].id, vehicleId: vehicles[4].id } }),
    prisma.driverVehicle.create({ data: { driverId: drivers[4].id, vehicleId: vehicles[5].id } }),
    prisma.driverVehicle.create({ data: { driverId: drivers[5].id, vehicleId: vehicles[7].id } }),
    prisma.driverVehicle.create({ data: { driverId: drivers[6].id, vehicleId: vehicles[7].id } }),
  ]);

  // Create Trips (historical + active)
  const pickups = ["JFK Airport Terminal 4", "Penn Station", "Times Square", "Grand Central Terminal", "Brooklyn Bridge", "LaGuardia Airport", "Yankee Stadium", "Columbia University", "Wall Street", "Madison Square Garden"];
  const dropoffs = ["Midtown Manhattan", "Upper East Side", "Financial District", "Chelsea", "SoHo", "Harlem", "Astoria Queens", "Williamsburg Brooklyn", "Battery Park", "Herald Square"];

  const completedTrips = await Promise.all(
    Array.from({ length: 60 }, (_, i) => {
      const fare = 12 + Math.random() * 45;
      const startedAt = subHours(new Date(), 3 + i * 3.5);
      const duration = 15 + Math.floor(Math.random() * 45);
      return prisma.trip.create({
        data: {
          driverId: drivers[i % 5].id,
          vehicleId: vehicles[i % 5].id,
          status: "COMPLETED",
          pickupAddress: pickups[i % 10],
          dropoffAddress: dropoffs[i % 10],
          distance: 3 + Math.random() * 22,
          duration,
          fare,
          paymentMethod: (["CASH", "CARD", "MOBILE"] as const)[i % 3],
          rating: 3.5 + Math.random() * 1.5,
          startedAt,
          completedAt: new Date(startedAt.getTime() + duration * 60000),
          createdAt: new Date(startedAt.getTime() - 180000),
        },
      });
    })
  );

  // Active trips
  await Promise.all([
    prisma.trip.create({
      data: {
        driverId: drivers[0].id,
        vehicleId: vehicles[0].id,
        status: "IN_PROGRESS",
        pickupAddress: "LaGuardia Airport",
        dropoffAddress: "Upper West Side, Manhattan",
        distance: 14.2,
        duration: 35,
        paymentMethod: "CARD",
        startedAt: subHours(new Date(), 0.5),
        createdAt: subHours(new Date(), 0.6),
      },
    }),
    prisma.trip.create({
      data: {
        driverId: drivers[3].id,
        vehicleId: vehicles[4].id,
        status: "IN_PROGRESS",
        pickupAddress: "Brooklyn Heights",
        dropoffAddress: "Midtown Manhattan",
        distance: 8.7,
        duration: 25,
        paymentMethod: "MOBILE",
        startedAt: subHours(new Date(), 0.3),
        createdAt: subHours(new Date(), 0.35),
      },
    }),
    prisma.trip.create({
      data: {
        driverId: drivers[1].id,
        vehicleId: vehicles[1].id,
        status: "PENDING",
        pickupAddress: "Grand Central Station",
        dropoffAddress: "JFK Airport Terminal 8",
        paymentMethod: "CASH",
        createdAt: new Date(),
      },
    }),
  ]);

  console.log(`✅ Created ${completedTrips.length + 3} trips`);

  // Create Maintenance Records
  await Promise.all([
    prisma.maintenance.create({
      data: {
        vehicleId: vehicles[2].id,
        type: "BRAKE_SERVICE",
        description: "Front and rear brake pad replacement, rotor resurfacing",
        status: "IN_PROGRESS",
        priority: "HIGH",
        cost: 380,
        scheduledAt: subDays(new Date(), 1),
        technicianName: "Bob Martinez",
        notes: "Vehicle out of service until complete",
      },
    }),
    prisma.maintenance.create({
      data: {
        vehicleId: vehicles[0].id,
        type: "OIL_CHANGE",
        description: "Full synthetic oil change and filter replacement",
        status: "SCHEDULED",
        priority: "NORMAL",
        cost: 85,
        scheduledAt: addDays(new Date(), 15),
        technicianName: "Alice Chen",
      },
    }),
    prisma.maintenance.create({
      data: {
        vehicleId: vehicles[6].id,
        type: "REPAIR",
        description: "Engine coolant leak — head gasket investigation required",
        status: "SCHEDULED",
        priority: "URGENT",
        cost: 1200,
        scheduledAt: addDays(new Date(), 1),
        technicianName: "Bob Martinez",
        notes: "Major repair required, vehicle out of service",
      },
    }),
    prisma.maintenance.create({
      data: {
        vehicleId: vehicles[1].id,
        type: "TIRE_ROTATION",
        description: "4-tire rotation, balance and pressure check",
        status: "COMPLETED",
        priority: "NORMAL",
        cost: 55,
        scheduledAt: subDays(new Date(), 30),
        completedAt: subDays(new Date(), 29),
        technicianName: "David Kim",
      },
    }),
    prisma.maintenance.create({
      data: {
        vehicleId: vehicles[3].id,
        type: "INSPECTION",
        description: "Annual safety inspection and emissions test",
        status: "SCHEDULED",
        priority: "HIGH",
        cost: 120,
        scheduledAt: addDays(new Date(), 7),
        technicianName: "Alice Chen",
      },
    }),
    prisma.maintenance.create({
      data: {
        vehicleId: vehicles[4].id,
        type: "GENERAL",
        description: "50,000 km major service — filters, spark plugs, belts check",
        status: "SCHEDULED",
        priority: "NORMAL",
        cost: 450,
        scheduledAt: addDays(new Date(), 45),
        technicianName: "David Kim",
      },
    }),
    prisma.maintenance.create({
      data: {
        vehicleId: vehicles[5].id,
        type: "OIL_CHANGE",
        description: "Synthetic blend oil change and filter",
        status: "COMPLETED",
        priority: "LOW",
        cost: 70,
        scheduledAt: subDays(new Date(), 60),
        completedAt: subDays(new Date(), 58),
        technicianName: "Bob Martinez",
      },
    }),
  ]);

  console.log(`✅ Created 7 maintenance records`);

  // Create Fuel Logs
  const stations = ["Shell on 5th Ave", "Mobil Midtown", "BP Queens Blvd", "Exxon Brooklyn", "Chevron JFK"];
  await Promise.all(
    Array.from({ length: 30 }, (_, i) => {
      const liters = 20 + Math.random() * 40;
      const price = 1.2 + Math.random() * 0.4;
      return prisma.fuelLog.create({
        data: {
          vehicleId: vehicles[i % 6].id,
          liters,
          pricePerLiter: price,
          totalCost: liters * price,
          mileageAtFill: 20000 + i * 2000 + Math.floor(Math.random() * 500),
          station: stations[i % 5],
          filledAt: subDays(new Date(), Math.floor(Math.random() * 30)),
        },
      });
    })
  );

  console.log(`✅ Created 30 fuel logs`);

  console.log("\n🚖 FleetTrack database seeded successfully!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
