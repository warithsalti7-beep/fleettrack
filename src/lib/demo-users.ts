/**
 * Server-side mirror of public/auth.js DEMO_USERS.
 *
 * Kept in a separate file so API routes can validate login without
 * pulling in the browser-only auth.js. Keep in sync manually — the
 * canonical list is here; auth.js is the UI copy.
 *
 * Plain-text passwords for now; migrate to bcrypt in Deploy 3.
 */

export type DemoUser = {
  id: string;
  email: string;
  password: string;
  name: string;
  role: "admin" | "employee" | "driver";
  avatar?: string;
};

export const DEMO_USERS: DemoUser[] = [
  {
    id: "admin-1",
    email: "admin@fleettrack.no",
    password: "Admin2024!",
    name: "Fleet Admin",
    role: "admin",
    avatar: "FA",
  },
  {
    id: "emp-1",
    email: "employee@fleettrack.no",
    password: "Employee2024!",
    name: "Dispatch Officer",
    role: "employee",
    avatar: "DO",
  },
  {
    id: "drv-1",
    email: "driver@fleettrack.no",
    password: "Driver2024!",
    name: "Olsztynski Mariusz Zbigniew",
    role: "driver",
    avatar: "OM",
  },
];

export function findDemoUser(email: string, password: string): DemoUser | null {
  const e = (email || "").toLowerCase().trim();
  return (
    DEMO_USERS.find((u) => u.email.toLowerCase() === e && u.password === password) || null
  );
}
