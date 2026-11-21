"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/misc";
import { DAYS, DAY_LABELS, type BusinessHours, type Day, type TimeRange } from "@/lib/business-hours";

const MAX_RANGES = 4;
const DEFAULT_RANGE: TimeRange = { open: "09:00", close: "18:00" };

/**
 * Edits BotSettings.businessHours. "Always open" stores {}. A schedule stores all seven days
 * (closed days as []), so a week with every day closed is not mistaken for "always open".
 */
export function HoursEditor({ value, onChange, disabled }: { value: BusinessHours; onChange: (v: BusinessHours) => void; disabled?: boolean }) {
  const alwaysOpen = Object.keys(value).length === 0;

  const setSchedule = (enabled: boolean) => {
    if (!enabled) return onChange({});
    onChange(Object.fromEntries(DAYS.map((d) => [d, [{ ...DEFAULT_RANGE }]])) as BusinessHours);
  };
  const full = (): Record<Day, TimeRange[]> => Object.fromEntries(DAYS.map((d) => [d, value[d] ?? []])) as Record<Day, TimeRange[]>;
  const setDay = (day: Day, ranges: TimeRange[]) => onChange({ ...full(), [day]: ranges });

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-4 rounded-xl border bg-muted/30 p-4">
        <div>
          <p id="hours-mode-label" className="text-sm font-medium">
            Set opening hours
          </p>
          <p className="text-xs text-muted-foreground">
            Off means always open. Outside hours the bot still takes orders and tells customers they will be processed when you open.
          </p>
        </div>
        <Switch aria-labelledby="hours-mode-label" checked={!alwaysOpen} onCheckedChange={setSchedule} disabled={disabled} />
      </div>

      {!alwaysOpen ? (
        <ul className="grid gap-3">
          {DAYS.map((day) => {
            const ranges = value[day] ?? [];
            const open = ranges.length > 0;
            return (
              <li key={day} className="grid gap-2 border-b pb-3 last:border-b-0 sm:grid-cols-[9rem_1fr] sm:items-start">
                <div className="flex items-center gap-3 sm:pt-2">
                  <Switch
                    id={`day-${day}`}
                    checked={open}
                    onCheckedChange={(on) => setDay(day, on ? [{ ...DEFAULT_RANGE }] : [])}
                    disabled={disabled}
                    aria-label={`Open on ${DAY_LABELS[day]}`}
                  />
                  <label htmlFor={`day-${day}`} className="text-sm font-medium">
                    {DAY_LABELS[day]}
                  </label>
                </div>
                {open ? (
                  <div className="grid gap-2">
                    {ranges.map((r, i) => (
                      <div key={i} className="flex flex-wrap items-center gap-2">
                        <Input
                          type="time"
                          value={r.open}
                          onChange={(e) => setDay(day, ranges.map((x, j) => (j === i ? { ...x, open: e.target.value } : x)))}
                          disabled={disabled}
                          required
                          className="w-32"
                          aria-label={`${DAY_LABELS[day]} opens at`}
                        />
                        <span className="text-sm text-muted-foreground" aria-hidden>
                          to
                        </span>
                        <Input
                          type="time"
                          value={r.close === "24:00" ? "23:59" : r.close}
                          onChange={(e) => setDay(day, ranges.map((x, j) => (j === i ? { ...x, close: e.target.value } : x)))}
                          disabled={disabled}
                          required
                          className="w-32"
                          aria-label={`${DAY_LABELS[day]} closes at`}
                        />
                        {r.close !== "24:00" && r.close <= r.open ? <span className="text-xs text-muted-foreground">(next day)</span> : null}
                        {ranges.length > 1 ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => setDay(day, ranges.filter((_, j) => j !== i))}
                            disabled={disabled}
                            aria-label={`Remove ${DAY_LABELS[day]} time range ${i + 1}`}
                          >
                            <Trash2 aria-hidden />
                          </Button>
                        ) : null}
                      </div>
                    ))}
                    {ranges.length < MAX_RANGES ? (
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="h-auto justify-self-start px-0"
                        onClick={() => setDay(day, [...ranges, { open: "17:00", close: "22:00" }])}
                        disabled={disabled}
                      >
                        <Plus aria-hidden /> Add time range
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground sm:pt-2">Closed</p>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
