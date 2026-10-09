import { Nav, Setup } from "@/components/Nav";
import { StrategyForm } from "@/components/StrategyForm";
import { swingTemplate, type Strategy } from "@/lib/strategy";
import { loadStrategy, loadStrategies } from "@/lib/strategies";

export const dynamic = "force-dynamic";

export default async function NewStrategyPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  const { configured } = await loadStrategies();
  let initial: Strategy = swingTemplate();
  if (from) {
    const source = await loadStrategy(from);
    if (source) {
      initial = {
        ...source.strategy,
        profile: {
          ...source.strategy.profile,
          name: `Copy of ${source.strategy.profile.name}`.slice(0, 80),
          status: "draft",
        },
      };
    }
  }

  return (
    <div className="flow-screen">
      <Nav active="/strategies" />
      {!configured ? (
        <main className="shell">
          <Setup />
        </main>
      ) : (
        <StrategyForm initial={initial} />
      )}
    </div>
  );
}
