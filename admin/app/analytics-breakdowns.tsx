"use client";

import { useState } from "react";

// Flow breakdowns for the organizer dashboard. Counts arrive already aggregated and
// suppressed by the API (admin/lib/analytics-breakdowns.ts): `count: null` with display "<5".

export type BreakdownCount = { count: number | null; display: string; suppressed: boolean };
export type AnalyticsBreakdowns = {
  timezone: string;
  smallCountThreshold: number;
  byZone: { id: string; name: string; plannedStops: BreakdownCount; presentNow: BreakdownCount; interactions: BreakdownCount; avgCrowdLevel: number | null }[];
  byHour: { hour: number; label: string; sessions: BreakdownCount; itineraries: BreakdownCount; interactions: BreakdownCount }[];
  byPartyType: { type: string; label: string; sessions: BreakdownCount; avgPartySize: number | null }[];
};

type HourMetric = "sessions" | "itineraries" | "interactions";
const HOUR_METRICS: [HourMetric, string][] = [["sessions", "جلسات بدأت"], ["itineraries", "مسارات أُنشئت"], ["interactions", "تفاعلات"]];

/** Bar length for a count; suppressed buckets draw a short hatched stub, not a guessed value. */
function share(value: BreakdownCount, max: number) {
  if (value.suppressed) return 0;
  return max > 0 && value.count ? Math.max(2, Math.round((value.count / max) * 100)) : 0;
}

function maxOf(values: BreakdownCount[]) {
  return values.reduce((max, value) => Math.max(max, value.count ?? 0), 0);
}

function BarList({ caption, rows, emptyText }: { caption: string; rows: { key: string; label: string; value: BreakdownCount; note?: string }[]; emptyText: string }) {
  const max = maxOf(rows.map((row) => row.value));
  const any = rows.some((row) => row.value.suppressed || (row.value.count ?? 0) > 0);
  return (
    <figure className="bar-list">
      <figcaption>{caption}</figcaption>
      {!any ? <p className="bar-empty">{emptyText}</p> : <table>
        <thead className="sr-only"><tr><th scope="col">الفئة</th><th scope="col">العدد</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row">{row.label}{row.note && <small> · {row.note}</small>}</th>
              <td>
                <span className={`bar${row.value.suppressed ? " suppressed" : ""}`} style={{ inlineSize: `calc((100% - 4em) * ${(row.value.suppressed ? 6 : share(row.value, max)) / 100})` }} aria-hidden="true" />
                <bdi className="bar-value" aria-label={row.value.suppressed ? "أقل من خمسة" : undefined}>{row.value.display}</bdi>
              </td>
            </tr>
          ))}
        </tbody>
      </table>}
    </figure>
  );
}

export function AnalyticsBreakdownsView({ breakdowns }: { breakdowns: AnalyticsBreakdowns | undefined }) {
  const [hourMetric, setHourMetric] = useState<HourMetric>("sessions");
  if (!breakdowns) return <p className="bar-empty">التوزيعات غير متاحة من هذا الخادم بعد.</p>;

  // Show hours from the first to the last one with any activity, keeping quiet hours in between.
  const hourRows = breakdowns.byHour;
  const active = hourRows.map((row) => row[hourMetric].suppressed || (row[hourMetric].count ?? 0) > 0);
  const first = active.indexOf(true);
  const last = active.lastIndexOf(true);
  const visibleHours = first === -1 ? [] : hourRows.slice(first, last + 1);

  return (
    <section className="breakdowns" aria-labelledby="breakdowns-title">
      <h3 id="breakdowns-title">حركة الزوار</h3>
      <p className="bar-note">أرقام مجمّعة فقط. الفئات التي فيها أقل من {breakdowns.smallCountThreshold} تظهر «&lt;{breakdowns.smallCountThreshold}» حتى لا يُستدل على زائر بعينه. الساعات بتوقيت الموقع (<bdi dir="ltr">{breakdowns.timezone}</bdi>).</p>

      <div className="breakdown-grid">
        <BarList
          caption="المناطق حسب المحطات المخططة"
          emptyText="لا توجد مسارات في هذه الفترة."
          rows={breakdowns.byZone.map((zone) => ({
            key: zone.id,
            label: zone.name,
            value: zone.plannedStops,
            note: [
              zone.presentNow.count !== 0 ? `الآن ${zone.presentNow.display}` : "",
              zone.avgCrowdLevel !== null ? `ازدحام ${Math.round(zone.avgCrowdLevel * 100)}٪` : "",
            ].filter(Boolean).join(" · ") || undefined,
          }))}
        />

        <div>
          <div className="row updates-tabs" role="group" aria-label="مقياس الساعات">
            {HOUR_METRICS.map(([metric, label]) => (
              <button key={metric} type="button" className={`btn small${hourMetric === metric ? " primary" : " ghost"}`} aria-pressed={hourMetric === metric} onClick={() => setHourMetric(metric)}>{label}</button>
            ))}
          </div>
          <BarList
            caption={`حسب الساعة — ${HOUR_METRICS.find(([metric]) => metric === hourMetric)?.[1] ?? ""}`}
            emptyText="لا يوجد نشاط في هذه الفترة."
            rows={visibleHours.map((row) => ({ key: String(row.hour), label: row.label, value: row[hourMetric] }))}
          />
        </div>

        <BarList
          caption="حسب نوع المجموعة"
          emptyText="لم يحدد الزوار مرافقيهم في هذه الفترة."
          rows={breakdowns.byPartyType.map((row) => ({
            key: row.type,
            label: row.label,
            value: row.sessions,
            note: row.avgPartySize !== null ? `متوسط ${row.avgPartySize.toLocaleString("ar-SA")} أشخاص` : undefined,
          }))}
        />
      </div>
    </section>
  );
}
