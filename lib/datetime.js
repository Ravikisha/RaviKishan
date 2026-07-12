// Shared date/time helpers for the menu-bar flyout and the Calendar app.
export const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const MO = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Flat 6x7-ish grid of day numbers for a month; leading/trailing blanks are null.
export function monthMatrix(year, month) {
  const first = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < first; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(d);
  while (cells.length % 7) cells.push(null);
  return cells;
}

// World clocks — distributed systems live across regions. Local (IST) first.
export const ZONES = [
  { label: "IST", tz: "Asia/Kolkata", city: "Bihar · home" },
  { label: "UTC", tz: "UTC", city: "Coordinated" },
  { label: "PT", tz: "America/Los_Angeles", city: "San Francisco" },
  { label: "ET", tz: "America/New_York", city: "New York" },
];

export const timeIn = (d, tz) =>
  d.toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
export const dayIn = (d, tz) =>
  d.toLocaleDateString("en-US", { timeZone: tz, weekday: "short" });
export const pad = (n) => String(n).padStart(2, "0");
