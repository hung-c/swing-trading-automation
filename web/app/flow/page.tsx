import { Nav } from "@/components/Nav";
import { FlowCanvas } from "@/components/FlowCanvas";

export const dynamic = "force-dynamic";

export default function FlowPage() {
  return (
    <div className="flow-screen">
      <Nav active="/flow" />
      <FlowCanvas />
    </div>
  );
}
