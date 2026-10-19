import { Hero } from "@/components/home/hero";
import { ToolTabs } from "@/components/home/tool-tabs";
import { PhaseStrip } from "@/components/home/phase-strip";

export default function HomePage() {
  return (
    <>
      <Hero />
      <ToolTabs />
      <PhaseStrip />
    </>
  );
}
