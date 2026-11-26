import type { Metadata } from "next";
import { CrowdTheater } from "./CrowdTheater";

export const metadata: Metadata = {
  title: "مسرح الحركة · ونيس",
  description: "نفس الزوار، نفس الليلة، نفس التأخير — مقارنة محاكاة حتمية بين موقع بدون ونيس وموقع مع ونيس.",
};

export default function CrowdTheaterPage() {
  return <CrowdTheater />;
}
