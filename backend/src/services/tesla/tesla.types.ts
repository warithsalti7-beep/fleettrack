/**
 * Tesla Fleet API v1 — Type Definitions
 * Documentation: https://developer.tesla.com/docs/fleet-api
 */

export interface TeslaVehicle {
  id: number;
  vehicle_id: number;
  vin: string;
  display_name: string;
  option_codes: string;
  color: string | null;
  state: 'online' | 'asleep' | 'offline';
  in_service: boolean;
  id_s: string;
  calendar_enabled: boolean;
  api_version: number;
  backseat_token: string | null;
  backseat_token_updated_at: string | null;
}

export interface TeslaVehicleData {
  id: number;
  user_id: number;
  vehicle_id: number;
  vin: string;
  display_name: string;
  state: string;
  drive_state: TeslaDriveState;
  charge_state: TeslaChargeState;
  vehicle_state: TeslaVehicleState;
  climate_state: TeslaClimateState;
}

export interface TeslaDriveState {
  gps_as_of: number;
  heading: number;
  latitude: number;
  longitude: number;
  native_latitude: number;
  native_location_supported: number;
  native_longitude: number;
  native_type: string;
  power: number;
  shift_state: string | null;
  speed: number | null;
  timestamp: number;
}

export interface TeslaChargeState {
  battery_heater_on: boolean;
  battery_level: number;        // State of Charge %
  battery_range: number;        // Miles
  charge_current_request: number;
  charge_current_request_max: number;
  charge_enable_request: boolean;
  charge_energy_added: number;  // kWh this session
  charge_limit_soc: number;
  charge_miles_added_ideal: number;
  charge_miles_added_rated: number;
  charge_port_door_open: boolean;
  charge_port_latch: string;
  charge_rate: number;          // mph
  charge_to_max_range: boolean;
  charger_actual_current: number;
  charger_phases: number | null;
  charger_pilot_current: number;
  charger_power: number;        // kW
  charger_voltage: number;
  charging_state: 'Charging' | 'Complete' | 'Disconnected' | 'NoPower' | 'Stopped';
  conn_charge_cable: string;
  est_battery_range: number;
  fast_charger_brand: string;
  fast_charger_present: boolean;
  fast_charger_type: string;
  ideal_battery_range: number;
  managed_charging_active: boolean;
  managed_charging_start_time: number | null;
  managed_charging_user_canceled: boolean;
  max_range_charge_counter: number;
  minutes_to_full_charge: number;
  not_enough_power_to_heat: boolean | null;
  scheduled_charging_pending: boolean;
  scheduled_charging_start_time: number | null;
  time_to_full_charge: number;  // hours
  timestamp: number;
  trip_charging: boolean;
  usable_battery_level: number;
  user_charge_enable_request: boolean | null;
}

export interface TeslaVehicleState {
  api_version: number;
  autopark_state_v2: string;
  odometer: number;             // Miles
  software_update: { status: string };
  timestamp: number;
}

export interface TeslaClimateState {
  inside_temp: number;
  outside_temp: number;
  driver_temp_setting: number;
  is_climate_on: boolean;
  timestamp: number;
}

export interface TeslaAuthToken {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

export interface TeslaFleetTelemetry {
  vin: string;
  data: {
    Location?: { latitude: number; longitude: number };
    Soc?: number;           // State of Charge %
    ChargingState?: string;
    ChargeEnergyAdded?: number;
    Odometer?: number;
    VehicleSpeed?: number;
  };
  createdAt: string;
}
