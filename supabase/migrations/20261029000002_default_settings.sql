-- Starting settings (same as defaultSettings in src/config/site.ts).
-- The owner changes these later in Admin → Settings.
insert into public.settings (id, data) values (1, $json$
{
  "timezone": "Asia/Manila",
  "currencySymbol": "₱",
  "courts": [
    { "id": "c1", "name": "Court 1", "note": "Championship court", "pricePerHour": 500, "active": true },
    { "id": "c2", "name": "Court 2", "note": "Center court", "pricePerHour": 500, "active": true },
    { "id": "c3", "name": "Court 3", "note": "Practice-friendly", "pricePerHour": 500, "active": true }
  ],
  "hours": [
    { "open": 6, "close": 22, "closed": false }, { "open": 6, "close": 22, "closed": false },
    { "open": 6, "close": 22, "closed": false }, { "open": 6, "close": 22, "closed": false },
    { "open": 6, "close": 22, "closed": false }, { "open": 6, "close": 22, "closed": false },
    { "open": 6, "close": 22, "closed": false }
  ],
  "holidays": [],
  "peak": { "enabled": false, "days": [1, 2, 3, 4, 5], "startHour": 17, "endHour": 21, "pricePerHour": 600 },
  "holdMinutes": 10,
  "maxDaysAhead": 60,
  "cancellation": { "allowRequests": true, "minHoursBefore": 24, "refundPercent": 100 },
  "reminders": { "hoursBefore": 24, "email": true },
  "templates": {
    "confirmation": "Hi {name}, your court is booked!\n\n{court}\n{date}, {time}\nReference: {reference}\nTotal: {amount}\n\nSee you on court.",
    "reminder": "Hi {name}, this is a reminder that you have {court} booked on {date}, {time}.\nReference: {reference}"
  }
}
$json$::jsonb)
on conflict (id) do nothing;
