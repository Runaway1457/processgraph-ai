import { ArrowUpRight, CircleDot, MousePointer2 } from "lucide-react";
import type { ProcessAnalysis } from "../../../shared/processGraph";

type Props = {
  analysis: ProcessAnalysis;
  selectedActivity: string | null;
  onSelectActivity: (activity: string) => void;
};

const widthFor = (count: number, max: number) =>
  2.5 + Math.min(7, (count / Math.max(1, max)) * 6.5);

function labelLines(label: string): string[] {
  const words = label.split(/\s+/);
  if (words.length <= 2) return [label];
  const middle = Math.ceil(words.length / 2);
  return [words.slice(0, middle).join(" "), words.slice(middle).join(" ")];
}

export default function ProcessGraphMap({
  analysis,
  selectedActivity,
  onSelectActivity,
}: Props) {
  const orderedActivities =
    analysis.variants[0]?.path ??
    analysis.activities.map(item => item.activity);
  const stageOrder = Array.from(new Set(orderedActivities));
  const visibleActivities = analysis.activities.filter(item =>
    stageOrder.includes(item.activity)
  );
  const stageWidth = 176;
  const width = Math.max(
    760,
    100 + Math.max(1, stageOrder.length - 1) * stageWidth + 180
  );
  const height = 400;
  const nodeWidth = 146;
  const nodeHeight = 78;
  const centerY = 198;
  const maxFrequency = Math.max(1, ...analysis.edges.map(edge => edge.count));
  const maxWait = Math.max(
    0.01,
    ...analysis.edges.map(edge => edge.medianWaitDays)
  );
  const xFor = (activity: string) =>
    34 + Math.max(0, stageOrder.indexOf(activity)) * stageWidth;
  const topEdges = analysis.edges.slice(0, 26);
  const displayedCount = new Set(
    topEdges.map(edge => edge.from).concat(topEdges.map(edge => edge.to))
  ).size;

  return (
    <div
      className="process-map-shell"
      aria-label="Mapa interativo do fluxo do processo"
    >
      <div className="map-legend">
        <span>
          <i className="legend-mark legend-volume" /> frequência do fluxo
        </span>
        <span>
          <i className="legend-mark legend-wait" /> espera acima da mediana
        </span>
        <span>
          <i className="legend-mark legend-node" /> selecione uma atividade
        </span>
      </div>
      <div className="process-map-scroll">
        <svg
          className="process-map-svg"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-labelledby="process-map-title process-map-desc"
          style={{ minWidth: `${width}px` }}
        >
          <title id="process-map-title">
            Grafo diretamente-segue do processo de compras
          </title>
          <desc id="process-map-desc">
            Fluxos mais frequentes são mais espessos; transições com espera
            mediana acima do percentil 70 estão destacadas em âmbar.
          </desc>
          <defs>
            <marker
              id="arrow-blue"
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M0,0 L8,4 L0,8 z" fill="#7894b3" />
            </marker>
            <marker
              id="arrow-amber"
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M0,0 L8,4 L0,8 z" fill="#dc9144" />
            </marker>
          </defs>
          <text x="16" y="28" className="map-stage-label">
            ETAPAS DO PROCESSO · DFG FILTRADO
          </text>
          {topEdges.map((edge, index) => {
            const fromStage = stageOrder.indexOf(edge.from);
            const toStage = stageOrder.indexOf(edge.to);
            if (fromStage < 0 || toStage < 0) return null;
            const startX = xFor(edge.from) + nodeWidth - 8;
            const endX = xFor(edge.to) + 8;
            const repeat = fromStage >= toStage;
            const bend = Math.min(98, 34 + (index % 4) * 15);
            const path = repeat
              ? `M ${xFor(edge.from) + nodeWidth / 2} ${centerY - nodeHeight / 2} C ${xFor(edge.from) + nodeWidth / 2} ${centerY - bend - 84}, ${xFor(edge.to) + nodeWidth / 2} ${centerY - bend - 84}, ${xFor(edge.to) + nodeWidth / 2} ${centerY - nodeHeight / 2}`
              : `M ${startX} ${centerY} C ${(startX + endX) / 2} ${centerY - 8}, ${(startX + endX) / 2} ${centerY + 8}, ${endX} ${centerY}`;
            const isBottleneck =
              edge.medianWaitDays >=
              percentileThreshold(
                analysis.edges.map(item => item.medianWaitDays),
                0.7
              );
            const stroke = isBottleneck ? "#dc9144" : "#7894b3";
            const textX = repeat
              ? (xFor(edge.from) + xFor(edge.to)) / 2 + nodeWidth / 2
              : (startX + endX) / 2;
            const textY = repeat
              ? centerY - bend - 88
              : centerY - 14 - (index % 2) * 14;
            return (
              <g
                key={`${edge.from}-${edge.to}-${index}`}
                className="map-edge-group"
              >
                <path d={path} className="map-edge-hit" />
                <path
                  d={path}
                  className="map-edge"
                  stroke={stroke}
                  strokeWidth={widthFor(edge.count, maxFrequency)}
                  markerEnd={
                    isBottleneck ? "url(#arrow-amber)" : "url(#arrow-blue)"
                  }
                />
                <g
                  className="map-edge-label"
                  transform={`translate(${textX}, ${textY})`}
                >
                  <rect x="-38" y="-12" width="76" height="23" rx="7" />
                  <text textAnchor="middle" dominantBaseline="middle">
                    {edge.count} casos ·{" "}
                    {edge.medianWaitDays.toLocaleString("pt-BR", {
                      maximumFractionDigits: 1,
                    })}{" "}
                    d
                  </text>
                </g>
              </g>
            );
          })}
          {stageOrder.map((activity, index) => {
            const item = analysis.activities.find(
              candidate => candidate.activity === activity
            );
            if (!item) return null;
            const x = xFor(activity);
            const isSelected = selectedActivity === activity;
            const isStart = index === 0;
            const isEnd = index === stageOrder.length - 1;
            const lines = labelLines(activity);
            return (
              <g
                key={`${activity}-${index}`}
                className={`map-node ${isSelected ? "is-selected" : ""} ${isStart || isEnd ? "is-terminal" : ""}`}
                onClick={() => onSelectActivity(activity)}
                role="button"
                tabIndex={0}
                aria-label={`Selecionar atividade ${activity}`}
                onKeyDown={event => {
                  if (event.key === "Enter" || event.key === " ")
                    onSelectActivity(activity);
                }}
              >
                <rect
                  x={x}
                  y={centerY - nodeHeight / 2}
                  width={nodeWidth}
                  height={nodeHeight}
                  rx="13"
                />
                <circle
                  cx={x + 17}
                  cy={centerY - 16}
                  r="5"
                  className="node-indicator"
                />
                <text x={x + 30} y={centerY - 11} className="node-label">
                  {lines.map((line, lineIndex) => (
                    <tspan
                      key={lineIndex}
                      x={x + 30}
                      dy={lineIndex === 0 ? 0 : 15}
                    >
                      {line.length > 18 ? `${line.slice(0, 17)}…` : line}
                    </tspan>
                  ))}
                </text>
                <text x={x + 17} y={centerY + 23} className="node-subtitle">
                  {item.caseCount.toLocaleString("pt-BR")} casos ·{" "}
                  {item.resources.length || 0} recursos
                </text>
                {isStart && (
                  <text x={x + 6} y={centerY + 61} className="node-terminal">
                    INÍCIO
                  </text>
                )}
                {isEnd && (
                  <text x={x + 6} y={centerY + 61} className="node-terminal">
                    FIM
                  </text>
                )}
              </g>
            );
          })}
          <text x="18" y="373" className="map-footer-note">
            {displayedCount} atividades conectadas · {topEdges.length}{" "}
            transições observadas · espessura proporcional à frequência
          </text>
        </svg>
      </div>
      <div className="map-caption">
        <MousePointer2 size={14} /> Selecione um nó para inspecionar volume,
        recursos e espera da atividade.
      </div>
      {selectedActivity && (
        <div className="selected-node-pill">
          <CircleDot size={14} /> Atividade selecionada:{" "}
          <strong>{selectedActivity}</strong>
          <ArrowUpRight size={14} />
        </div>
      )}
      {visibleActivities.length === 0 && (
        <div className="map-empty">
          Nenhuma atividade disponível para visualizar.
        </div>
      )}
    </div>
  );
}

function percentileThreshold(values: number[], percentile: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length
    ? sorted[
        Math.min(sorted.length - 1, Math.floor(sorted.length * percentile))
      ]
    : 0;
}
