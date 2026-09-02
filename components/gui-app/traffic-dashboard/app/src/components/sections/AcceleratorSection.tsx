"use client";

import { useEffect, useMemo, useState } from "react";
import { AcceleratorFleetTable, useAcceleratorFleet } from "../AcceleratorFleetTable";
import { Card } from "../Card";
import { GpuSection } from "./GpuSection";
import { NeuronSection } from "./NeuronSection";
import { ACCELERATOR_KIND_LABEL, ACCELERATOR_UNIT, AcceleratorKind } from "@/lib/accelerator";
import { formatShort } from "@/lib/format";

const KINDS: AcceleratorKind[] = ["gpu", "neuron"];

/**
 * One section for every accelerator in the cluster. The fleet table on top
 * puts NVIDIA GPUs and AWS Inferentia / Trainium on the same columns; the
 * segmented control picks which family's detail panels (DCGM or
 * neuron-monitor) render below. The default tab is the first family that is
 * actually reporting, so a Neuron-only cluster does not open on an empty GPU
 * panel.
 */
export function AcceleratorSection({ minutes }: { minutes: number }) {
  const fleet = useAcceleratorFleet();
  const [picked, setPicked] = useState<AcceleratorKind | null>(null);

  const devicesByKind = useMemo(() => {
    const totals: Record<AcceleratorKind, number> = { gpu: 0, neuron: 0 };
    for (const row of fleet.rows) totals[row.kind] += row.devicesActive;
    return totals;
  }, [fleet.rows]);

  const fallback: AcceleratorKind = devicesByKind.gpu === 0 && devicesByKind.neuron > 0 ? "neuron" : "gpu";
  const selected = picked ?? fallback;

  // Once the user has chosen, keep it; before that follow whatever is reporting.
  useEffect(() => {
    if (picked === null) return;
    if (devicesByKind[picked] === 0 && devicesByKind[fallback] > 0) setPicked(null);
  }, [picked, fallback, devicesByKind]);

  return (
    <div className="space-y-4">
      <Card
        title="Accelerator fleet by type"
        subtitle="Every accelerator family the exporters can see, on the same columns. Devices = what the exporter reports vs. what the nodes advertise to the scheduler; Allocated = devices pods have claimed. A row that is allocated but idle is billed capacity doing nothing — click it for the per-node view."
        action={
          <div className="flex shrink-0 rounded-lg bg-surface-raised/60 p-0.5" role="tablist" aria-label="Accelerator type">
            {KINDS.map((kind) => {
              const count = devicesByKind[kind];
              const active = kind === selected;
              return (
                <button
                  key={kind}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setPicked(kind)}
                  className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
                    active ? "bg-surface-raised font-medium text-ink" : "text-ink-secondary hover:text-ink"
                  }`}
                >
                  {ACCELERATOR_KIND_LABEL[kind]}
                  <span className={`tabular ml-1.5 ${active ? "text-ink-secondary" : "text-ink-muted"}`}>
                    {formatShort(count, 0)} {count === 1 ? ACCELERATOR_UNIT[kind].singular : ACCELERATOR_UNIT[kind].plural}
                  </span>
                </button>
              );
            })}
          </div>
        }
      >
        <AcceleratorFleetTable rows={fleet.rows} isLoading={fleet.isLoading} error={fleet.error} selected={selected} onSelect={setPicked} />
      </Card>

      <div className="flex items-center gap-3 text-xs text-ink-muted">
        <span className="h-px flex-1 bg-gridline" aria-hidden="true" />
        <span>
          {ACCELERATOR_KIND_LABEL[selected]} detail ·{" "}
          {selected === "gpu" ? "DCGM exporter (NVIDIA GPU Operator)" : "neuron-monitor DaemonSet"}
        </span>
        <span className="h-px flex-1 bg-gridline" aria-hidden="true" />
      </div>

      {selected === "gpu" ? <GpuSection minutes={minutes} /> : <NeuronSection minutes={minutes} />}
    </div>
  );
}
