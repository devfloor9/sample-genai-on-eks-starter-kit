"use client";

import { formatBytes, formatCelsius, formatPercent100, formatWatts } from "@/lib/format";
import { GPU, GPU_TEMP_CRITICAL_C, GPU_TEMP_WARNING_C } from "@/lib/queries";
import { STATUS, STATUS_GLYPH, colorForIndex } from "@/lib/theme";
import { useInstantVector } from "@/lib/useSeries";
import { GpuEmptyState } from "./GpuEmptyState";
import { levelFor } from "./StatTile";

interface PodGpuRow {
  key: string;
  namespace: string;
  pod: string;
  gpu: string;
  modelName: string;
  util: number | null;
  memoryBytes: number | null;
  watts: number | null;
  tempC: number | null;
}

/**
 * One row per (namespace, pod, GPU). The four DCGM gauges come back as separate
 * instant vectors, joined here on the physical GPU identity so the temperature
 * shown against a pod is the temperature of the GPU that pod is actually using.
 */
export function GpuPodTable() {
  const util = useInstantVector(GPU.podUtil);
  const memory = useInstantVector(GPU.podMemoryUsedBytes);
  const power = useInstantVector(GPU.podPowerWatts);
  const temp = useInstantVector(GPU.podTemp);

  const memoryByGpu = new Map(memory.rows.map((row) => [gpuKey(row.labels), row.value]));
  const powerByGpu = new Map(power.rows.map((row) => [gpuKey(row.labels), row.value]));
  const tempByGpu = new Map(temp.rows.map((row) => [gpuKey(row.labels), row.value]));

  const rows: PodGpuRow[] = util.rows
    .map((row) => {
      const key = gpuKey(row.labels);
      return {
        key,
        namespace: row.labels.namespace || "—",
        pod: row.labels.pod || "—",
        gpu: row.labels.gpu ?? "—",
        modelName: row.labels.modelName || "—",
        util: row.value,
        memoryBytes: memoryByGpu.get(key) ?? null,
        watts: powerByGpu.get(key) ?? null,
        tempC: tempByGpu.get(key) ?? null,
      };
    })
    .sort((a, b) => (b.util ?? 0) - (a.util ?? 0));

  if (util.error) {
    return (
      <p className="py-8 text-center text-xs text-ink-muted">
        <span className="text-status-serious">▲</span> Query failed — {util.error.message}
      </p>
    );
  }
  if (rows.length === 0) {
    return <GpuEmptyState isLoading={util.isLoading} />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-gridline text-left text-ink-muted">
            <th className="py-2 pr-4 font-medium">Namespace</th>
            <th className="py-2 pr-4 font-medium">Pod</th>
            <th className="py-2 pr-4 font-medium">GPU</th>
            <th className="py-2 pr-4 font-medium">Utilization</th>
            <th className="py-2 pr-4 text-right font-medium">Memory used</th>
            <th className="py-2 pr-4 text-right font-medium">Power</th>
            <th className="py-2 pr-4 text-right font-medium">Temp</th>
            <th className="py-2 font-medium">Model</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const tempLevel = levelFor(row.tempC, {
              warning: GPU_TEMP_WARNING_C,
              critical: GPU_TEMP_CRITICAL_C,
            });
            return (
              <tr key={row.key} className="border-b border-gridline/60 last:border-0">
                <td className="py-2 pr-4 text-ink-secondary">{row.namespace}</td>
                <td className="max-w-[18rem] truncate py-2 pr-4 font-mono text-[11px] text-ink" title={row.pod}>
                  {row.pod}
                </td>
                <td className="tabular py-2 pr-4 text-ink-secondary">{row.gpu}</td>
                <td className="py-2 pr-4">
                  <UtilBar value={row.util} color={colorForIndex(index)} />
                </td>
                <td className="tabular py-2 pr-4 text-right text-ink">{formatBytes(row.memoryBytes)}</td>
                <td className="tabular py-2 pr-4 text-right text-ink">{formatWatts(row.watts)}</td>
                <td className="tabular py-2 pr-4 text-right">
                  {row.tempC === null ? (
                    <span className="text-ink-muted">—</span>
                  ) : (
                    <span
                      className="inline-flex items-center gap-1"
                      style={{ color: tempLevel ? STATUS[tempLevel] : undefined }}
                      title={tempLevel === "good" ? "Normal" : tempLevel === "warning" ? "Warm" : "Hot"}
                    >
                      {tempLevel && tempLevel !== "good" && (
                        <span aria-hidden="true">{STATUS_GLYPH[tempLevel]}</span>
                      )}
                      <span className={tempLevel === "good" ? "text-ink" : undefined}>
                        {formatCelsius(row.tempC)}
                      </span>
                    </span>
                  )}
                </td>
                <td className="py-2 text-ink-muted">{row.modelName}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Inline bar plus the number — the bar is a scan aid, the value is the fact. */
function UtilBar({ value, color }: { value: number | null; color: string }) {
  const pct = value === null ? 0 : Math.max(0, Math.min(value, 100));
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-gridline">
        <span
          className="block h-full rounded-full"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </span>
      <span className="tabular w-10 text-right text-ink">{formatPercent100(value)}</span>
    </span>
  );
}

/** Physical GPU identity. UUID is authoritative; gpu index is the fallback for
 *  exporters configured without it. */
function gpuKey(labels: Record<string, string>): string {
  return [labels.pod ?? "", labels.UUID || labels.gpu || "", labels.gpu ?? ""].join("|");
}
