"use client";

import { useState } from "react";
import { EnginesGroupingToggle, EnginesTable, EnginesGrouping } from "../EnginesTable";
import { SignalTile } from "../SignalTile";
import {
  formatCount,
  formatPercent100,
  formatPercentUnit,
  formatSeconds,
  formatShort,
  formatUsd,
} from "@/lib/format";
import { AZ_PRICE_PER_GB, GLANCE, GLANCE_THRESHOLDS as T, KPI } from "@/lib/queries";

const formatTokensPerSec = (v: number | null) => (v === null ? "—" : `${formatShort(v)} tok/s`);
const formatPerMin = (v: number | null) => (v === null ? "—" : `${formatShort(v)} /min`);
/** Gauges that count requests/engines: the range step can land between scrapes, so round. */
const formatWhole = (v: number | null) => formatCount(v === null ? null : Math.round(v));

/**
 * The KCD 2026 Token Factory signal set, one screen. Four blocks follow the
 * talk's structure; the platform row keeps the network headlines. Every tile is
 * headline + delta + sparkline over the selected window, so "at a glance" also
 * answers "and which way is it moving".
 */
export function AtAGlance({ minutes }: { minutes: number }) {
  const [grouping, setGrouping] = useState<EnginesGrouping>("model");
  return (
    <div className="space-y-8">
      <Block
        index="B1"
        title="Routing & prefix cache"
        tagline="Cache-aware routing decides TTFT. Hit ratio is an SLI — watch it as a cliff, not an average."
      >
        <SignalTile
          label="TTFT p95"
          expr={GLANCE.ttftP95}
          minutes={minutes}
          format={formatSeconds}
          hint="Time to first token, all vLLM engines"
          thresholds={T.ttftP95}
        />
        <SignalTile
          label="Prefix cache hit"
          expr={GLANCE.prefixHitRatio}
          minutes={minutes}
          format={(v) => formatPercentUnit(v, 1)}
          hint="Share of prefix-cache queries that hit"
          thresholds={T.prefixHitRatio}
          direction="higher-is-better"
        />
        <SignalTile
          label="Cached prompt tokens"
          expr={GLANCE.cachedPromptShare}
          minutes={minutes}
          format={(v) => formatPercentUnit(v, 1)}
          hint="Prompt tokens served from cache instead of prefill"
          thresholds={T.cachedPromptShare}
          direction="higher-is-better"
        />
        <SignalTile
          label="Queue time p95"
          expr={GLANCE.queueTimeP95}
          minutes={minutes}
          format={formatSeconds}
          hint="Time a request waits before the engine schedules it"
          thresholds={T.queueTimeP95}
        />
      </Block>

      <Block
        index="B2"
        title="Token throughput & per-token latency"
        tagline="The factory's output: tokens per second, and what each token costs in time (TPOT), end to end."
      >
        <SignalTile
          label="Generation throughput"
          expr={GLANCE.genTokensPerSec}
          minutes={minutes}
          format={formatTokensPerSec}
          hint="Output tokens per second, all models"
        />
        <SignalTile
          label="Prompt throughput"
          expr={GLANCE.promptTokensPerSec}
          minutes={minutes}
          format={formatTokensPerSec}
          hint="Input tokens per second entering prefill"
        />
        <SignalTile
          label="TPOT p95"
          expr={GLANCE.tpotP95}
          minutes={minutes}
          format={formatSeconds}
          hint="Time per output token during decode"
          thresholds={T.tpotP95}
        />
        <SignalTile
          label="E2E latency p95"
          expr={GLANCE.e2eP95}
          minutes={minutes}
          format={formatSeconds}
          hint="Whole request, queue to last token"
          thresholds={T.e2eP95}
        />
      </Block>

      <Block
        index="B3"
        title="GPU & KV cache"
        tagline="Resources and isolation: KV pressure evicts before reuse; preemptions are the symptom. Target GPU utilisation above 70%."
      >
        <SignalTile
          label="KV cache max"
          expr={GLANCE.kvCacheMax}
          minutes={minutes}
          format={(v) => formatPercentUnit(v, 0)}
          hint="Busiest engine's KV-cache usage"
          thresholds={T.kvCacheMax}
        />
        <SignalTile
          label="GPU util (avg)"
          expr={GLANCE.gpuUtilAvg}
          minutes={minutes}
          format={(v) => formatPercent100(v, 0)}
          hint="DCGM, all NVIDIA GPUs — dashed line is the 70% target"
          thresholds={T.gpuUtilAvg}
          direction="higher-is-better"
          reference={70}
        />
        <SignalTile
          label="GPU memory used"
          expr={GLANCE.gpuMemUsedRatio}
          minutes={minutes}
          format={(v) => formatPercentUnit(v, 0)}
          hint="Framebuffer used / total across GPUs"
          thresholds={T.gpuMemUsedRatio}
        />
        <SignalTile
          label="Preemptions"
          expr={GLANCE.preemptionsPerMin}
          minutes={minutes}
          format={formatPerMin}
          hint="Requests evicted from the batch to free KV blocks"
          thresholds={T.preemptionsPerMin}
        />
      </Block>

      <Block
        index="B4"
        title="Scale signals"
        tagline="Autoscale on LLM-native signals — queue depth and KV pressure — not CPU%."
      >
        <SignalTile
          label="Queue depth"
          expr={GLANCE.queueDepth}
          minutes={minutes}
          format={formatWhole}
          hint="Waiting across engines — KEDA trigger candidate"
          thresholds={T.queueDepth}
        />
        <SignalTile
          label="In flight"
          expr={GLANCE.inFlight}
          minutes={minutes}
          format={formatWhole}
          hint="Requests currently running across engines"
        />
        <SignalTile
          label="Models serving"
          expr={GLANCE.modelsServing}
          minutes={minutes}
          format={formatWhole}
          hint="Distinct model pools reporting to Prometheus"
        />
        <SignalTile
          label="Abort / error rate"
          expr={GLANCE.abortErrorRate}
          minutes={minutes}
          format={(v) => formatPercentUnit(v, 2)}
          hint="Finished requests that aborted or errored"
          thresholds={T.abortErrorRate}
        />
      </Block>

      <Block
        index="Engines"
        title="Per model & per pod"
        tagline="The tiles above are fleet totals. Here the same signals per model pool and per engine pod — accelerator utilisation and memory, KV cache, prefix hit, queue and throughput — so an average never hides a pinned or idle engine."
        action={<EnginesGroupingToggle value={grouping} onChange={setGrouping} />}
        layout="flow"
      >
        <EnginesTable grouping={grouping} />
      </Block>

      <Block
        index="Platform"
        title="Network & L7 headlines"
        tagline="The substrate under the factory: L7 health from Beyla eBPF, cross-AZ bytes and cost from Network Flow Monitor."
        columns={5}
      >
        <SignalTile
          label="L7 success rate"
          expr={KPI.successRate}
          minutes={minutes}
          format={(v) => formatPercentUnit(v, 2)}
          hint="Non-5xx share of requests (Beyla)"
          thresholds={{ warning: 0.99, critical: 0.95 }}
          direction="higher-is-better"
        />
        <SignalTile
          label="Retrans / GB"
          expr={KPI.retransPerGb}
          minutes={minutes}
          format={formatShort}
          hint="TCP retransmits per GB moved (NFM)"
          thresholds={{ warning: 500, critical: 2000 }}
        />
        <SignalTile
          label="Inter-AZ ratio"
          expr={KPI.interAzRatio}
          minutes={minutes}
          format={(v) => formatPercentUnit(v, 1)}
          hint="Bytes crossing AZs (billable)"
          thresholds={{ warning: 0.3, critical: 0.6 }}
        />
        <SignalTile
          label="Inter-AZ cost / mo"
          expr={KPI.interAzCostMonth}
          minutes={minutes}
          format={formatUsd}
          hint={`Estimate: run-rate × 30d × $${AZ_PRICE_PER_GB}/GB`}
          thresholds={{ warning: 50, critical: 200 }}
        />
        <SignalTile
          label="NFM collectors up"
          expr={KPI.nfmCollectorsUp}
          minutes={minutes}
          format={formatWhole}
          hint="Healthy NFM agent scrape targets"
          thresholds={{ warning: 1, critical: 0 }}
          direction="higher-is-better"
        />
      </Block>
    </div>
  );
}

function Block({
  index,
  title,
  tagline,
  columns = 4,
  layout = "grid",
  action,
  children,
}: {
  index: string;
  title: string;
  tagline: string;
  columns?: 4 | 5;
  /** "grid" lays tiles out in columns; "flow" wraps a single child (a table) in a card. */
  layout?: "grid" | "flow";
  /** Control rendered at the right of the block header. */
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const grid =
    columns === 5
      ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
      : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-4";
  return (
    <section aria-labelledby={`glance-${index}`}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="rounded-md bg-surface-raised px-1.5 py-0.5 text-[11px] font-medium tracking-wide text-ink-secondary ring-1 ring-white/10">
            {index}
          </span>
          <h3 id={`glance-${index}`} className="text-sm font-semibold text-ink">
            {title}
          </h3>
          <p className="text-xs text-ink-muted">{tagline}</p>
        </div>
        {action}
      </div>
      {layout === "grid" ? (
        <div className={`grid gap-4 ${grid}`}>{children}</div>
      ) : (
        <div className="rounded-2xl bg-surface px-5 py-3 ring-1 ring-white/10">{children}</div>
      )}
    </section>
  );
}
