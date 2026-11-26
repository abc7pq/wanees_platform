"use client";

import { useState, type FormEvent } from "react";

export type WalkingSegment = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  distanceM: number;
  walkMin: number;
  status: string;
  accessible: boolean;
  sourceId: string | null;
};

type Node = { id: string; label: string };
type Source = { id: string; locator?: string | null; observedAt?: string | null };
type SegmentForm = {
  fromNodeId: string;
  toNodeId: string;
  distanceM: string;
  walkMin: string;
  status: string;
  accessible: boolean;
  source: string;
  walkedOn: string;
};
type SegmentInput = Omit<SegmentForm, "distanceM" | "walkMin"> & { distanceM: number; walkMin: number };

export function WalkingSegments({ nodes, edges, sources, canEdit, busy, onSave }: {
  nodes: Node[];
  edges: WalkingSegment[];
  sources: Source[];
  canEdit: boolean;
  busy: boolean;
  onSave: (input: SegmentInput) => Promise<void>;
}) {
  const [form, setForm] = useState<SegmentForm>({
    fromNodeId: "", toNodeId: "", distanceM: "", walkMin: "", status: "open", accessible: false, source: "", walkedOn: "",
  });
  const nodeLabels = new Map(nodes.map((node) => [node.id, node.label]));
  const sourceDetails = new Map(sources.map((source) => [source.id, source]));
  const canSave = !!form.fromNodeId && !!form.toNodeId && form.fromNodeId !== form.toNodeId;

  function edit(edge: WalkingSegment) {
    const evidence = sourceDetails.get(edge.sourceId ?? "");
    setForm({
      fromNodeId: edge.fromNodeId, toNodeId: edge.toNodeId, distanceM: String(edge.distanceM), walkMin: String(edge.walkMin),
      status: edge.status, accessible: Boolean(evidence && edge.accessible),
      source: evidence?.locator ?? "", walkedOn: evidence?.observedAt?.slice(0, 10) ?? "",
    });
    document.getElementById("walk-from")?.focus();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (canSave && !busy) await onSave({ ...form, distanceM: Number(form.distanceM), walkMin: Number(form.walkMin) });
  }

  return <section className="card" aria-labelledby="walking-segments-title">
    <h2 id="walking-segments-title">ممرات المشي</h2>
    <p>أضف وقت المشي المقاس لكل اتجاه. سجل الاتجاه المعاكس إذا كان مفتوحًا أيضًا.</p>
    {canEdit && nodes.length < 2 && <p>أضف موقعين على الأقل لربطهما.</p>}
    {canEdit && nodes.length >= 2 && <form onSubmit={submit}>
      <div className="activity-update-fields">
        <label htmlFor="walk-from">من
          <select id="walk-from" required value={form.fromNodeId} onChange={(event) => setForm({ ...form, fromNodeId: event.target.value })}>
            <option value="">اختر الموقع</option>{nodes.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <label htmlFor="walk-to">إلى
          <select id="walk-to" required value={form.toNodeId} onChange={(event) => setForm({ ...form, toNodeId: event.target.value })}>
            <option value="">اختر الموقع</option>{nodes.map(({ id, label }) => <option key={id} value={id} disabled={id === form.fromNodeId}>{label}</option>)}
          </select>
        </label>
        <label htmlFor="walk-distance">المسافة (متر)<input id="walk-distance" type="number" min={1} max={25000} required value={form.distanceM} onChange={(event) => setForm({ ...form, distanceM: event.target.value })} /></label>
        <label htmlFor="walk-time">مدة المشي (دقائق)<input id="walk-time" type="number" min={1} max={480} required value={form.walkMin} onChange={(event) => setForm({ ...form, walkMin: event.target.value })} /></label>
        <label htmlFor="walk-status">حالة الممر<select id="walk-status" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}><option value="open">مفتوح</option><option value="closed">مغلق</option></select></label>
        <label htmlFor="walk-accessible">مسار مهيأ<select id="walk-accessible" value={String(form.accessible)} onChange={(event) => setForm({ ...form, accessible: event.target.value === "true" })}><option value="false">غير مؤكد</option><option value="true">تم التحقق منه ميدانيًا</option></select></label>
        <label htmlFor="walk-date">تاريخ الجولة الميدانية<input id="walk-date" type="date" required value={form.walkedOn} onChange={(event) => setForm({ ...form, walkedOn: event.target.value })} /></label>
        <label htmlFor="walk-source">مرجع القياس<input id="walk-source" required maxLength={240} value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })} /></label>
      </div>
      <button type="submit" className="btn primary" disabled={!canSave || busy}>حفظ مقطع المشي</button>
    </form>}
    {!edges.length && <p>لم تُضف ممرات مشي بعد.</p>}
    {edges.length > 0 && <table className="responsive-table">
      <caption className="sr-only">ممرات المشي في هذا الكتالوج</caption>
      <thead><tr><th scope="col">المقطع</th><th scope="col">المسافة والمدة</th><th scope="col">التحقق</th>{canEdit && <th scope="col">إجراء</th>}</tr></thead>
      <tbody>{edges.map((edge) => {
        const evidence = sourceDetails.get(edge.sourceId ?? "");
        return <tr key={edge.id}>
          <td data-label="المقطع">{nodeLabels.get(edge.fromNodeId)} ← {nodeLabels.get(edge.toNodeId)}</td>
          <td data-label="المسافة والمدة">{edge.distanceM} م · {edge.walkMin} د · {edge.status === "open" ? "مفتوح" : "مغلق"}</td>
          <td data-label="التحقق">{evidence?.locator ?? "بحاجة إلى قياس ميداني"}</td>
          {canEdit && <td data-label="إجراء"><button type="button" className="btn" disabled={busy} onClick={() => edit(edge)}>تعديل</button></td>}
        </tr>;
      })}</tbody>
    </table>}
  </section>;
}
