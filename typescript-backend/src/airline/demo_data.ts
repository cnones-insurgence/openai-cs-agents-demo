import { AirlineContext } from "./types.js";

export const MOCK_ITINERARIES: Record<string, any> = {
  disrupted: {
    passenger_name: "Morgan Lee",
    confirmation_number: "IR-D204",
    seat_number: "14C",
    segments: [
      { flight_number: "PA441", origin: "Paris (CDG)", destination: "New York (JFK)", departure: "2024-12-09 14:10", arrival: "2024-12-09 17:40", status: "Delayed 5 hours due to weather, expected departure 19:55", gate: "B18" },
      { flight_number: "NY802", origin: "New York (JFK)", destination: "Austin (AUS)", departure: "2024-12-09 19:10", arrival: "2024-12-09 22:35", status: "Connection missed because of first leg delay", gate: "C7" }
    ],
    rebook_options: [
      { flight_number: "NY950", origin: "New York (JFK)", destination: "Austin (AUS)", departure: "2024-12-10 09:45", arrival: "2024-12-10 12:30", seat: "2A (front row)", note: "Partner flight secured with auto-reaccommodation for disrupted travelers" },
      { flight_number: "NY982", origin: "New York (JFK)", destination: "Austin (AUS)", departure: "2024-12-10 13:20", arrival: "2024-12-10 16:05", seat: "3C", note: "Backup option if the morning flight is full" }
    ],
    vouchers: { hotel: "Overnight hotel covered up to $180 near JFK Terminal 5 partner hotel", meal: "$60 meal credit for the delay", ground: "$40 ground transport credit to the hotel" }
  },
  on_time: {
    passenger_name: "Taylor Lee",
    confirmation_number: "LL0EZ6",
    seat_number: "23A",
    segments: [
      { flight_number: "FLT-123", origin: "San Francisco (SFO)", destination: "Los Angeles (LAX)", departure: "2024-12-09 16:10", arrival: "2024-12-09 17:35", status: "On time and operating as scheduled", gate: "A10" }
    ],
    rebook_options: [],
    vouchers: {}
  }
};

export function applyItineraryDefaults(ctx: AirlineContext, scenarioKey?: string) {
  const key = scenarioKey ?? ctx.scenario ?? "disrupted";
  const data = MOCK_ITINERARIES[key] ?? MOCK_ITINERARIES.disrupted;
  ctx.scenario = key;
  ctx.passenger_name = ctx.passenger_name ?? data.passenger_name;
  ctx.confirmation_number = ctx.confirmation_number ?? data.confirmation_number;
  ctx.seat_number = ctx.seat_number ?? data.seat_number;
  if (!ctx.flight_number && data.segments.length > 0) ctx.flight_number = data.segments[0].flight_number;
  if (!ctx.itinerary) ctx.itinerary = structuredClone(data.segments);
  if (data.segments.length > 0) {
    ctx.origin = ctx.origin ?? data.segments[0].origin;
    ctx.destination = ctx.destination ?? data.segments[data.segments.length - 1].destination;
  }
}

export function getItineraryForFlight(flightNumber: string | null): [string, any] | null {
  if (!flightNumber) return null;
  for (const [k, it] of Object.entries(MOCK_ITINERARIES)) {
    if (it.segments.some((s: any) => s.flight_number.toLowerCase() === flightNumber.toLowerCase())) return [k, it];
    if (it.rebook_options.some((s: any) => s.flight_number.toLowerCase() === flightNumber.toLowerCase())) return [k, it];
  }
  return null;
}

export function activeItinerary(ctx: AirlineContext): [string, any] {
  if (ctx.scenario && MOCK_ITINERARIES[ctx.scenario]) return [ctx.scenario, MOCK_ITINERARIES[ctx.scenario]];
  const m = getItineraryForFlight(ctx.flight_number);
  if (m) {
    ctx.scenario = m[0];
    return m;
  }
  ctx.scenario = "disrupted";
  return ["disrupted", MOCK_ITINERARIES.disrupted];
}
