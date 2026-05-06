import { tool } from "@openai/agents";
import { z } from "zod";
import { activeItinerary, applyItineraryDefaults, getItineraryForFlight } from "./demo_data.js";
import { AirlineContext } from "./types.js";

const rnd = () => Math.floor(Math.random() * 9000 + 1000);

export const faqLookupTool = tool({
  name: "faq_lookup_tool",
  description: "Lookup frequently asked questions.",
  parameters: z.object({ question: z.string() }),
  async execute({ question }) {
    const q = question.toLowerCase();
    if (q.includes("bag")) return "You are allowed to bring one bag on the plane. It must be under 50 pounds and 22 inches x 14 inches x 9 inches. If a bag is delayed or missing, file a baggage claim and we will track it for delivery.";
    if (q.includes("compensation") || q.includes("delay") || q.includes("voucher")) return "For lengthy delays we provide duty-of-care: hotel and meal vouchers plus ground transport where needed. If the delay is over 3 hours or causes a missed connection, we also open a compensation case and can offer miles or travel credit. A Refunds & Compensation agent can submit the case and share the voucher details with you.";
    if (q.includes("seats") || q.includes("plane")) return "There are 120 seats on the plane. There are 22 business class seats and 98 economy seats. Exit rows are rows 4 and 16. Rows 5-8 are Economy Plus, with extra legroom.";
    if (q.includes("wifi")) return "We have free wifi on the plane, join Airline-Wifi";
    return "I'm sorry, I don't know the answer to that question.";
  }
});

export const getTripDetails = tool({
  name: "get_trip_details",
  description: "Infer disrupted trip from message and hydrate context.",
  parameters: z.object({ message: z.string() }),
  async execute({ message }, rc) {
    const ctx = rc?.context as AirlineContext;
    const lower = message.toLowerCase();
    const scenario = ["paris", "new york", "austin"].some((k) => lower.includes(k)) ? "disrupted" : "on_time";
    applyItineraryDefaults(ctx, scenario);
    const segments = ctx.itinerary ?? [];
    const summary = segments.map((s) => `${s.flight_number} ${s.origin} -> ${s.destination} status: ${s.status}`).join("; ");
    return `Hydrated ${scenario} itinerary: flight ${ctx.flight_number}, confirmation ${ctx.confirmation_number}, origin ${ctx.origin}, destination ${ctx.destination}. ${summary || "No segment details available"}`;
  }
});

export const updateSeat = tool({
  name: "update_seat",
  description: "Update seat for confirmation number.",
  parameters: z.object({ confirmation_number: z.string(), new_seat: z.string() }),
  async execute({ confirmation_number, new_seat }, rc) {
    const ctx = rc?.context as AirlineContext;
    applyItineraryDefaults(ctx);
    ctx.confirmation_number = confirmation_number;
    ctx.seat_number = new_seat;
    return `Updated seat to ${new_seat} for confirmation number ${confirmation_number}`;
  }
});

export const flightStatusTool = tool({
  name: "flight_status_tool",
  description: "Lookup status for a flight.",
  parameters: z.object({ flight_number: z.string() }),
  async execute({ flight_number }, rc) {
    const ctx = rc?.context as AirlineContext;
    ctx.flight_number = flight_number;
    const match = getItineraryForFlight(flight_number);
    if (!match) return `Flight ${flight_number} is on time and scheduled to depart at gate A10.`;
    const [scenario, itinerary] = match;
    applyItineraryDefaults(ctx, scenario);
    const segment = itinerary.segments.find((s: any) => s.flight_number.toLowerCase() === flight_number.toLowerCase());
    if (segment) {
      const details = [
        `Flight ${flight_number} (${segment.origin} to ${segment.destination})`,
        `Status: ${segment.status}`
      ];
      if (segment.gate) details.push(`Gate: ${segment.gate}`);
      if (segment.departure && segment.arrival) details.push(`Scheduled ${segment.departure} -> ${segment.arrival}`);
      if (scenario === "disrupted" && segment.flight_number === "PA441") details.push("This delay will cause a missed connection to NY802. Reaccommodation is recommended.");
      return details.join(" | ");
    }
    return `Flight ${flight_number} is on time and scheduled to depart at gate A10.`;
  }
});

export const getMatchingFlights = tool({
  name: "get_matching_flights",
  description: "Find replacement flights when delayed or cancelled.",
  parameters: z.object({ origin: z.string().nullable().optional(), destination: z.string().nullable().optional() }),
  async execute({ origin, destination }, rc) {
    const ctx = rc?.context as AirlineContext;
    const [scenario, itinerary] = activeItinerary(ctx);
    applyItineraryDefaults(ctx, scenario);
    const options = itinerary.rebook_options ?? [];
    if (options.length === 0) return "All flights are operating on time. No alternate flights are needed.";
    const filtered = options.filter((opt: any) => (!origin || opt.origin.toLowerCase().includes(origin.toLowerCase())) && (!destination || opt.destination.toLowerCase().includes(destination.toLowerCase())));
    const finalOpts = filtered.length ? filtered : options;
    const lines = finalOpts.map((opt: any) => `${opt.flight_number} ${opt.origin} -> ${opt.destination} dep ${opt.departure} arr ${opt.arrival} | seat ${opt.seat ?? "auto-assign"} | ${opt.note ?? ""}`);
    if (scenario === "disrupted") lines.push("These options arrive in Austin the next day. Overnight hotel and meals are covered.");
    if (!ctx.itinerary) ctx.itinerary = structuredClone(itinerary.segments);
    return `Matching flights:\n${lines.join("\n")}`;
  }
});

export const baggageTool = tool({
  name: "baggage_tool",
  description: "Lookup baggage allowance and fees.",
  parameters: z.object({ query: z.string() }),
  async execute({ query }) {
    const q = query.toLowerCase();
    if (q.includes("fee")) return "Overweight bag fee is $75.";
    if (q.includes("allowance")) return "One carry-on and one checked bag (up to 50 lbs) are included.";
    if (q.includes("missing") || q.includes("lost")) return "If a bag is missing, file a baggage claim at the airport or with the Baggage Agent so we can track and deliver it.";
    return "Please provide details about your baggage inquiry.";
  }
});

export const bookNewFlight = tool({
  name: "book_new_flight",
  description: "Book a new or replacement flight and auto-assign a seat.",
  parameters: z.object({ flight_number: z.string().nullable().optional() }),
  async execute({ flight_number }, rc) {
    const ctx = rc?.context as AirlineContext;
    const [scenario, itinerary] = activeItinerary(ctx);
    applyItineraryDefaults(ctx, scenario);
    const options = itinerary.rebook_options ?? [];
    let selection = null as any;
    if (flight_number) selection = options.find((o: any) => o.flight_number.toLowerCase() === flight_number.toLowerCase()) ?? null;
    if (!selection && options.length) selection = options[0];
    if (!selection) {
      const confirmation = ctx.confirmation_number ?? `CNF-${rnd()}`;
      ctx.confirmation_number = confirmation;
      return `Booked flight ${flight_number ?? "TBD"} with confirmation ${confirmation}. Seat assignment: ${ctx.seat_number ?? "auto-assign"}.`;
    }
    ctx.flight_number = selection.flight_number;
    ctx.seat_number = selection.seat ?? ctx.seat_number ?? "auto-assign";
    ctx.confirmation_number = ctx.confirmation_number ?? `CNF-${rnd()}`;
    ctx.itinerary = ((ctx.itinerary ?? structuredClone(itinerary.segments)) as Array<Record<string, string>>).filter((seg: any) => !(scenario === "disrupted" && String(seg.origin).startsWith("New York") && String(seg.destination).startsWith("Austin")));
    (ctx.itinerary as Array<Record<string, string>>).push({
      flight_number: selection.flight_number,
      origin: selection.origin,
      destination: selection.destination,
      departure: selection.departure,
      arrival: selection.arrival,
      status: "Confirmed replacement flight",
      gate: "TBD"
    });
    return `Rebooked to ${selection.flight_number} from ${selection.origin} to ${selection.destination}. Departure ${selection.departure}, arrival ${selection.arrival} (next day arrival in Austin). Seat assigned: ${ctx.seat_number}. Confirmation ${ctx.confirmation_number}.`;
  }
});

export const assignSpecialServiceSeat = tool({
  name: "assign_special_service_seat",
  description: "Assign front row or special service seating for medical needs.",
  parameters: z.object({ seat_request: z.string().default("front row for medical needs") }),
  async execute({ seat_request }, rc) {
    const ctx = rc?.context as AirlineContext;
    applyItineraryDefaults(ctx);
    const preferred = seat_request.toLowerCase().includes("front") ? "1A" : "2A";
    ctx.seat_number = preferred;
    ctx.special_service_note = seat_request;
    ctx.confirmation_number = ctx.confirmation_number ?? `CNF-${rnd()}`;
    return `Secured ${seat_request} seat ${preferred} on flight ${ctx.flight_number ?? "upcoming segment"}. Confirmation ${ctx.confirmation_number} noted with special service flag.`;
  }
});

export const issueCompensation = tool({
  name: "issue_compensation",
  description: "Create compensation case and issue vouchers.",
  parameters: z.object({ reason: z.string().default("Delay causing missed connection") }),
  async execute({ reason }, rc) {
    const ctx = rc?.context as AirlineContext;
    const [scenario, itinerary] = activeItinerary(ctx);
    applyItineraryDefaults(ctx, scenario);
    ctx.compensation_case_id = ctx.compensation_case_id ?? `CMP-${rnd()}`;
    const voucherValues = Object.values(itinerary.vouchers ?? {}) as string[];
    ctx.vouchers = voucherValues.length ? voucherValues : (ctx.vouchers ?? []);
    const vouchersText = (ctx.vouchers ?? []).length ? (ctx.vouchers ?? []).join("; ") : "Documented compensation with no vouchers required.";
    return `Opened compensation case ${ctx.compensation_case_id} for: ${reason}. Issued: ${vouchersText}. Keep receipts for any hotel or meal costs and attach them to this case.`;
  }
});

export const displaySeatMap = tool({
  name: "display_seat_map",
  description: "Display an interactive seat map to the customer.",
  parameters: z.object({}),
  async execute() {
    return "DISPLAY_SEAT_MAP";
  }
});

export const cancelFlight = tool({
  name: "cancel_flight",
  description: "Cancel a flight.",
  parameters: z.object({}),
  async execute(_, rc) {
    const ctx = rc?.context as AirlineContext;
    applyItineraryDefaults(ctx);
    ctx.confirmation_number = ctx.confirmation_number ?? `CNF-${rnd()}`;
    return `Flight ${ctx.flight_number} successfully cancelled for confirmation ${ctx.confirmation_number}`;
  }
});
