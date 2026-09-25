import { startLogin } from "@/const";
import ProcessGraphMap from "@/components/ProcessGraphMap";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  CirclePlus,
  Clock3,
  Compass,
  Download,
  FileDown,
  FileUp,
  FlaskConical,
  GitBranch,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  Menu,
  MessageCircleQuestion,
  MoreHorizontal,
  Play,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  UploadCloud,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  analyzeProcess,
  defaultScenarioConfig,
  eventCountByCase,
  eventTimestampLabel,
  formatDuration,
  makeDemoLog,
  parseEventLogDetailed,
  toCsv,
  type EvidenceFact,
  type DataQualityReport,
  type ProcessEvent,
  type ScenarioConfig,
  type SimulationResult,
} from "../../../shared/processGraph";
import { toast } from "sonner";

type View = "overview" | "variants" | "investigation" | "simulation";
type Claim = {
  text: string;
  citations: string[];
  type: "observacao" | "hipotese";
};

const initialDemoEvents = makeDemoLog();
const initialDemoAnalysis = analyzeProcess(initialDemoEvents);

const navItems: Array<{
  id: View;
  label: string;
  icon: LucideIcon;
  tag?: string;
}> = [
  { id: "overview", label: "Visão geral", icon: LayoutDashboard },
  {
    id: "variants",
    label: "Variantes",
    icon: GitBranch,
    tag: String(initialDemoAnalysis.variants.length),
  },
  {
    id: "investigation",
    label: "Investigar processo",
    icon: Sparkles,
    tag: "AI",
  },
  { id: "simulation", label: "Simulador de cenários", icon: FlaskConical },
];

function pct(value: number, decimals = 0) {
  return `${value.toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}%`;
}

function num(value: number, decimals = 0) {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function shortMonth(value: string) {
  const [year, month] = value.split("-").map(Number);
  return new Date(year, month - 1, 1)
    .toLocaleDateString("pt-BR", { month: "short" })
    .replace(".", "");
}

function downloadFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function xmlEscape(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/'/g, "&apos;");
}

export default function Home() {
  const [events, setEvents] = useState<ProcessEvent[]>(initialDemoEvents);
  const [sourceHash, setSourceHash] = useState(initialDemoAnalysis.sourceHash);
  const [dataQuality, setDataQuality] = useState<DataQualityReport>(
    initialDemoAnalysis.quality
  );
  const [view, setView] = useState<View>("overview");
  const [selectedActivity, setSelectedActivity] = useState<string | null>(null);
  const [filterQuery, setFilterQuery] = useState("");
  const [resourceFilter, setResourceFilter] = useState("Todos os recursos");
  const [dateFilter, setDateFilter] = useState("Todo o período");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [investigationQuestion, setInvestigationQuestion] = useState(
    "Por que algumas compras levam mais tempo para serem concluídas?"
  );
  const [claims, setClaims] = useState<Claim[]>([]);
  const [usedFacts, setUsedFacts] = useState<string[]>([]);
  const [rejectedClaims, setRejectedClaims] = useState(0);
  const [scenarioConfig, setScenarioConfig] = useState<ScenarioConfig>(
    defaultScenarioConfig
  );
  const [scenarioResult, setScenarioResult] = useState<SimulationResult | null>(
    null
  );
  const [scenarioRunning, setScenarioRunning] = useState(false);
  const [replications, setReplications] = useState(1000);
  const [simulationValidation, setSimulationValidation] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const {
    user: currentUser,
    isAuthenticated,
    loading: authLoading,
  } = useAuth();

  const availableResources = useMemo(
    () =>
      Array.from(
        new Set(events.map(event => event.resource).filter(Boolean))
      ).sort(),
    [events]
  );
  const visibleEvents = useMemo(() => {
    const end = events.reduce(
      (latest, event) => Math.max(latest, event.timestamp),
      Number.NEGATIVE_INFINITY
    );
    const days =
      dateFilter === "Últimos 30 dias"
        ? 30
        : dateFilter === "Últimos 60 dias"
          ? 60
          : dateFilter === "Todo o período"
            ? Infinity
            : 90;
    const eligibleCaseIds = new Set(
      events
        .filter(
          event =>
            (resourceFilter === "Todos os recursos" ||
              event.resource === resourceFilter) &&
            (!Number.isFinite(days) ||
              event.timestamp >= end - days * 86_400_000)
        )
        .map(event => event.caseId)
    );
    return eligibleCaseIds.size
      ? events.filter(event => eligibleCaseIds.has(event.caseId))
      : events;
  }, [events, resourceFilter, dateFilter]);
  const analysis = useMemo(() => {
    const selected = visibleEvents.length >= 2 ? visibleEvents : events;
    const unfiltered =
      selected.length === events.length &&
      resourceFilter === "Todos os recursos" &&
      dateFilter === "Todo o período";
    return analyzeProcess(
      selected,
      unfiltered ? { sourceHash, quality: dataQuality } : {}
    );
  }, [
    visibleEvents,
    events,
    resourceFilter,
    dateFilter,
    sourceHash,
    dataQuality,
  ]);
  const latestMonth = analysis.trend[analysis.trend.length - 1]?.month;

  const investigator = trpc.processGraph.investigate.useMutation({
    onSuccess: result => {
      setClaims(result.claims as Claim[]);
      setUsedFacts(result.claims.flatMap(claim => claim.citations));
      setRejectedClaims(result.rejected);
      if (result.claims.length)
        toast.success("Investigação concluída com evidências verificadas.");
      else
        toast.warning(
          result.message || "Nenhuma afirmação passou pelo gate de evidências."
        );
    },
    onError: error =>
      toast.error(`Não foi possível concluir a investigação: ${error.message}`),
  });

  const handleFile = useCallback(async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 20 * 1024 * 1024)
        throw new Error(
          "O arquivo excede o limite de 20 MB para análise no navegador."
        );
      const content = await file.text();
      const parsed = parseEventLogDetailed(content, file.name);
      const newAnalysis = analyzeProcess(parsed.events, {
        sourceHash: parsed.source.contentHash,
        quality: parsed.quality,
      });
      setEvents(parsed.events);
      setSourceHash(parsed.source.contentHash);
      setDataQuality(parsed.quality);
      setResourceFilter("Todos os recursos");
      setDateFilter("Todo o período");
      setView("overview");
      setClaims([]);
      setUsedFacts([]);
      setRejectedClaims(0);
      setFilterQuery("");
      setScenarioResult(null);
      setSelectedActivity(null);
      toast.success(
        `${num(eventCountByCase(parsed.events))} casos e ${num(parsed.events.length)} eventos analisados.`,
        {
          description: `${num(parsed.quality.rejectedRows)} linha(s) rejeitada(s). O conteúdo bruto não foi enviado ao servidor.`,
        }
      );
      if (!newAnalysis.metrics.caseCount)
        throw new Error("O arquivo não contém casos válidos.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Erro ao importar log."
      );
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }, []);

  const resetDemo = () => {
    setEvents(initialDemoEvents);
    setSourceHash(initialDemoAnalysis.sourceHash);
    setDataQuality(initialDemoAnalysis.quality);
    setResourceFilter("Todos os recursos");
    setDateFilter("Todo o período");
    setView("overview");
    setSelectedActivity(null);
    setClaims([]);
    setUsedFacts([]);
    setRejectedClaims(0);
    setFilterQuery("");
    setScenarioResult(null);
    toast.success("Log de demonstração restaurado.");
  };

  const triggerInvestigation = () => {
    if (!isAuthenticated) {
      startLogin();
      return;
    }
    const question = investigationQuestion.trim();
    if (question.length < 4) {
      toast.error("Descreva sua pergunta com pelo menos quatro caracteres.");
      return;
    }
    investigator.mutate({
      question,
      facts: analysis.evidence,
      snapshot: {
        analysisId: analysis.analysisId,
        sourceHash: analysis.sourceHash,
        facts: analysis.evidence,
        edges: analysis.edges.map(edge => ({
          id: edge.id,
          from: edge.from,
          to: edge.to,
          count: edge.count,
          waitDays: {
            count: edge.waitDays.count,
            mean: edge.waitDays.mean,
            median: edge.waitDays.median,
            p90: edge.waitDays.p90,
            p95: edge.waitDays.p95,
            iqr: edge.waitDays.iqr,
          },
        })),
        variants: analysis.variants.slice(0, 32).map(variant => ({
          id: variant.id,
          path: variant.path,
          count: variant.count,
          share: variant.share,
          leadDays: {
            count: variant.leadDays.count,
            mean: variant.leadDays.mean,
            median: variant.leadDays.median,
            p90: variant.leadDays.p90,
            p95: variant.leadDays.p95,
            iqr: variant.leadDays.iqr,
          },
          impactVsMedianDays: variant.impactVsMedianDays,
        })),
      },
    });
  };

  const runScenario = () => {
    setScenarioRunning(true);
    setScenarioResult(null);
    const worker = new Worker(
      new URL("../workers/simulation.worker.ts", import.meta.url),
      { type: "module" }
    );
    worker.onmessage = (
      event: MessageEvent<{
        success: boolean;
        result?: SimulationResult;
        message?: string;
      }>
    ) => {
      worker.terminate();
      setScenarioRunning(false);
      if (!event.data.success || !event.data.result) {
        toast.error(
          event.data.message || "Não foi possível executar a simulação."
        );
        return;
      }
      setScenarioResult(event.data.result);
      setSimulationValidation(false);
      toast.success(
        `Simulação concluída · ${num(event.data.result.replications)} replicações reprodutíveis.`
      );
    };
    worker.onerror = () => {
      worker.terminate();
      setScenarioRunning(false);
      toast.error(
        "Falha ao iniciar o simulador. Confira a configuração e tente novamente."
      );
    };
    worker.postMessage({ events, config: { ...scenarioConfig, replications } });
  };

  const selectedActivityStats = selectedActivity
    ? analysis.activities.find(item => item.activity === selectedActivity)
    : null;
  const selectedActivityTransitions = selectedActivity
    ? analysis.edges
        .filter(
          edge => edge.from === selectedActivity || edge.to === selectedActivity
        )
        .sort((a, b) => b.count - a.count)
    : [];
  const highestWait = analysis.edges.length
    ? [...analysis.edges].sort((a, b) => b.medianWaitDays - a.medianWaitDays)[0]
    : null;
  const flowMax = Math.max(1, ...analysis.trend.map(item => item.cases));
  const biggestVariant = analysis.variants[0];
  const filteredVariants = analysis.variants.filter(variant =>
    `${variant.path.join(" ")} ${variant.id}`
      .toLocaleLowerCase("pt-BR")
      .includes(filterQuery.toLocaleLowerCase("pt-BR"))
  );
  const navLabel =
    navItems.find(item => item.id === view)?.label ?? "Visão geral";

  const downloadCsv = () =>
    downloadFile(
      "processgraph-eventos.csv",
      toCsv(events),
      "text/csv;charset=utf-8"
    );
  const downloadXes = () => {
    const cases = new Map<string, ProcessEvent[]>();
    events.forEach(event =>
      cases.set(event.caseId, [...(cases.get(event.caseId) ?? []), event])
    );
    const traces = Array.from(cases.entries())
      .map(
        ([caseId, trace]) =>
          `  <trace>\n    <string key="concept:name" value="${xmlEscape(caseId)}"/>\n${trace.map(event => `    <event>\n      <string key="concept:name" value="${xmlEscape(event.activity)}"/>\n      <date key="time:timestamp" value="${new Date(event.timestamp).toISOString()}"/>\n      <string key="org:resource" value="${xmlEscape(event.resource)}"/>\n    </event>`).join("\n")}\n  </trace>`
      )
      .join("\n");
    downloadFile(
      "processgraph-eventos.xes",
      `<?xml version="1.0" encoding="UTF-8"?>\n<log xes.version="1.0"><string key="concept:name" value="ProcessGraph export"/>\n${traces}\n</log>`,
      "application/xml;charset=utf-8"
    );
  };

  return (
    <div
      className="pg-shell"
      onDragOver={event => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          setDragging(false);
      }}
      onDrop={event => {
        event.preventDefault();
        setDragging(false);
        void handleFile(event.dataTransfer.files[0]);
      }}
    >
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.xes,text/csv,application/xml,text/xml"
        className="hidden"
        onChange={event => void handleFile(event.target.files?.[0])}
      />
      <aside className={`pg-sidebar ${mobileNavOpen ? "is-open" : ""}`}>
        <button
          className="brand-mark"
          onClick={() => setView("overview")}
          aria-label="ProcessGraph AI — ir para a visão geral"
        >
          <span className="brand-symbol">
            <Activity size={19} strokeWidth={2.5} />
          </span>
          <span>
            process<span className="brand-graph">graph</span>
            <small>INTELLIGENCE PLATFORM</small>
          </span>
        </button>
        <div className="workspace-select">
          <div className="workspace-avatar">PG</div>
          <div className="workspace-copy">
            <b>Compras e suprimentos</b>
            <span>
              {events === initialDemoEvents
                ? "Dados de demonstração"
                : "Análise local"}
            </span>
          </div>
          <ChevronDown size={15} />
        </div>
        <div className="side-section-label">
          WORKSPACE <span>⌘ 1</span>
        </div>
        <nav className="side-nav" aria-label="Navegação principal">
          {navItems.map(({ id, label, icon: Icon, tag }) => (
            <button
              key={id}
              onClick={() => {
                setView(id);
                setMobileNavOpen(false);
              }}
              className={`side-nav-item ${view === id ? "active" : ""}`}
            >
              <Icon size={17} strokeWidth={view === id ? 2 : 1.7} />
              <span>{label}</span>
              {tag && (
                <span className={`nav-tag ${tag === "AI" ? "ai-tag" : ""}`}>
                  {tag}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="side-section-label recent-label">
          PROCESSOS{" "}
          <button
            title="Adicionar processo"
            onClick={() => fileRef.current?.click()}
          >
            <CirclePlus size={15} />
          </button>
        </div>
        <button className="process-list-item selected">
          <span className="process-indicator" />
          <span>Compras e suprimentos</span>
          <MoreHorizontal size={15} />
        </button>
        <button
          className="process-list-item"
          onClick={() =>
            toast.info(
              "Conectores ERP serão disponibilizados em uma próxima etapa."
            )
          }
        >
          <span className="process-indicator muted" />
          <span>Contas a pagar</span>
          <span className="locked-mini">EM BREVE</span>
        </button>
        <div className="sidebar-bottom">
          <div className="plan-card">
            <div className="plan-heading">
              <ShieldCheck size={14} /> Processamento <b>local</b>
            </div>
            <div className="plan-footer">
              <span>{num(analysis.metrics.caseCount)} casos em memória</span>
              <button
                onClick={() =>
                  toast.info(
                    "O arquivo carregado permanece na memória deste navegador durante esta sessão."
                  )
                }
              >
                Privacidade <ArrowRight size={12} />
              </button>
            </div>
          </div>
          <div className="user-profile">
            <div className="profile-avatar">
              {currentUser?.name
                ?.trim()
                .split(/\s+/)
                .map(part => part[0])
                .join("")
                .slice(0, 2)
                .toUpperCase() || "PG"}
            </div>
            <div className="profile-info">
              <b>{currentUser?.name || "Sessão de demonstração"}</b>
              <span>
                {currentUser?.email || "Entre para usar investigação com IA"}
              </span>
            </div>
            <button
              className="profile-more"
              title={isAuthenticated ? "Conta conectada" : "Entrar"}
              onClick={() => !isAuthenticated && startLogin()}
            >
              •••
            </button>
          </div>
        </div>
      </aside>
      {mobileNavOpen && (
        <button
          className="mobile-backdrop"
          aria-label="Fechar navegação"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      <main className="pg-main">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="mobile-menu"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Abrir menu"
            >
              <Menu size={19} />
            </button>
            <div className="breadcrumbs">
              <span>Processos</span>
              <ChevronRight size={14} />
              <b>Compras e suprimentos</b>
              <span className="env-badge">
                {events === initialDemoEvents ? "Dados demo" : "Log local"}
              </span>
            </div>
          </div>
          <div className="topbar-actions">
            <span className="live-indicator">
              <i /> Local · sessão
            </span>
            <button
              className="top-icon"
              aria-label="Pesquisar"
              title="Pesquisar na página"
              onClick={() => document.getElementById("variant-search")?.focus()}
            >
              <Search size={17} />
            </button>
            <button
              className="top-icon notification-button"
              aria-label="Notificações"
              title="Notificações"
              onClick={() =>
                toast.info("Você está em dia. Nenhum alerta novo.")
              }
            >
              <Bell size={17} />
              <i />
            </button>
            <span className="top-divider" />
            <button
              className="help-link"
              onClick={() =>
                toast.info(
                  "Adicione um arquivo CSV/XES de eventos. Campos exigidos: case_id, activity, timestamp.",
                  { duration: 5500 }
                )
              }
            >
              <CircleHelp size={16} /> Ajuda
            </button>
            <div className="profile-avatar top-avatar">
              {currentUser?.name
                ?.trim()
                .split(/\s+/)
                .map(part => part[0])
                .join("")
                .slice(0, 2)
                .toUpperCase() || "PG"}
            </div>
          </div>
        </header>

        <div className="page-body">
          <div className="page-heading-row">
            <div>
              <div className="eyebrow">
                <span className="eyebrow-dot" />
                PROCESS MINING <span>/</span>{" "}
                {navLabel.toLocaleUpperCase("pt-BR")}
              </div>
              <h1>
                {view === "overview"
                  ? "Compras e suprimentos"
                  : view === "variants"
                    ? "Variantes do processo"
                    : view === "investigation"
                      ? "Investigar processo"
                      : "Simulador de cenários"}
              </h1>
              <p className="page-subtitle">
                {view === "overview"
                  ? "Uma visão baseada em evidências de como as compras realmente acontecem."
                  : view === "variants"
                    ? "Compare os caminhos reais do fluxo e descubra onde os desvios custam tempo."
                    : view === "investigation"
                      ? "Pergunte ao processo. Toda afirmação aponta para um dado que você pode verificar."
                      : "Simule decisões operacionais a partir das distribuições observadas no log."}
              </p>
            </div>
            <div className="heading-actions">
              <label
                className="resource-filter"
                title="Filtra casos completos que incluem este recurso"
              >
                <Activity size={14} />
                <select
                  value={resourceFilter}
                  onChange={event => setResourceFilter(event.target.value)}
                  aria-label="Filtrar por recurso"
                >
                  <option>Todos os recursos</option>
                  {availableResources.map(resource => (
                    <option key={resource} value={resource}>
                      {resource}
                    </option>
                  ))}
                </select>
                <ChevronDown size={12} />
              </label>
              <Button
                variant="outline"
                className="range-button"
                title="Os períodos relativos usam como referência a data mais recente presente no log."
                onClick={() => {
                  const options = [
                    "Últimos 30 dias",
                    "Últimos 60 dias",
                    "Últimos 90 dias",
                    "Todo o período",
                  ];
                  setDateFilter(
                    options[(options.indexOf(dateFilter) + 1) % options.length]
                  );
                }}
              >
                <Clock3 size={15} />
                {dateFilter}
                <ChevronDown size={14} />
              </Button>
              <Button
                variant="outline"
                className="share-button"
                onClick={downloadCsv}
              >
                <Download size={15} />
                Exportar
              </Button>
              <Button
                className="upload-button"
                onClick={() => fileRef.current?.click()}
              >
                <UploadCloud size={16} /> Importar log
              </Button>
            </div>
          </div>

          <div className="privacy-banner">
            <div className="privacy-icon">
              <LockKeyhole size={15} />
            </div>
            <span>
              <strong>Seus dados ficam no seu navegador.</strong> O arquivo
              bruto não é enviado para nenhum servidor. Apenas estatísticas
              agregadas são compartilhadas quando você solicita uma investigação
              com IA.
            </span>
            <button
              aria-label="Sobre a privacidade"
              onClick={() =>
                toast.info(
                  "Os eventos do arquivo são processados em memória no seu navegador. Para a investigação, são enviados somente estatísticas agregadas da amostra.",
                  { duration: 6500 }
                )
              }
            >
              <CircleHelp size={15} />
            </button>
          </div>

          {view === "overview" && (
            <>
              <section className="kpi-grid" aria-label="Indicadores principais">
                <KpiCard
                  icon={Target}
                  label="Lead time mediano"
                  value={formatDuration(analysis.metrics.medianLeadDays)}
                  change={null}
                  subtitle={`P90 de ${formatDuration(analysis.metrics.p90LeadDays)}`}
                  accent="blue"
                  foot="do primeiro evento ao último"
                />
                <KpiCard
                  icon={Activity}
                  label="Casos analisados"
                  value={num(analysis.metrics.caseCount)}
                  change={null}
                  subtitle={`${num(analysis.metrics.eventCount)} eventos observados`}
                  accent="violet"
                  foot={`em ${num(analysis.activities.length)} atividades`}
                />
                <KpiCard
                  icon={GitBranch}
                  label="Variantes únicas"
                  value={num(analysis.variants.length)}
                  change={null}
                  subtitle={`${num(analysis.metrics.transitionCount)} transições observadas`}
                  accent="green"
                  foot={`${pct(analysis.metrics.firstPassRate, 1)} dos casos sem repetição`}
                />
                <KpiCard
                  icon={AlertTriangle}
                  label="Casos com desvio"
                  value={pct(analysis.metrics.deviationRate * 100, 1)}
                  change={null}
                  subtitle={`${pct(analysis.conformance.fitness * 100, 1)} fitness em holdout`}
                  accent="amber"
                  foot={`${num(analysis.conformance.validationCases)} casos fora do treino`}
                />
              </section>

              <section className="overview-grid">
                <article className="panel process-panel">
                  <div className="panel-heading">
                    <div>
                      <div className="panel-kicker">
                        PROCESSO DESCOBERTO{" "}
                        <span className="mini-live">● REPRODUZÍVEL</span>
                      </div>
                      <h2>Como as compras realmente acontecem</h2>
                      <p>
                        Inductive DFG cut discovery · fluxo + distribuição de
                        espera · limiar {num(analysis.model.minEdgeFrequency)}{" "}
                        caso(s)
                      </p>
                    </div>
                    <button
                      className="quiet-action"
                      onClick={() => setView("variants")}
                    >
                      Explorar variantes <ArrowUpRight size={14} />
                    </button>
                  </div>
                  <ProcessGraphMap
                    analysis={analysis}
                    selectedActivity={selectedActivity}
                    onSelectActivity={setSelectedActivity}
                  />
                  {selectedActivityStats && (
                    <div className="activity-inspector">
                      <div className="inspector-title">
                        <div className="activity-symbol">
                          <Activity size={16} />
                        </div>
                        <div>
                          <span>ATIVIDADE SELECIONADA</span>
                          <b>{selectedActivityStats.activity}</b>
                        </div>
                        <button
                          onClick={() => setSelectedActivity(null)}
                          aria-label="Fechar painel de atividade"
                        >
                          <X size={16} />
                        </button>
                      </div>
                      <div className="inspector-stats">
                        <span>
                          <small>Casos envolvidos</small>
                          <b>{num(selectedActivityStats.caseCount)}</b>
                        </span>
                        <span>
                          <small>Tempo de espera mediano</small>
                          <b>
                            {formatDuration(
                              selectedActivityStats.medianWaitDays
                            )}
                          </b>
                        </span>
                        <span>
                          <small>Recursos observados</small>
                          <b>{num(selectedActivityStats.resources.length)}</b>
                        </span>
                      </div>
                      <div className="inspector-links">
                        {selectedActivityTransitions.slice(0, 3).map(edge => (
                          <span key={`${edge.from}-${edge.to}`}>
                            {edge.from === selectedActivity ? "→" : "←"}{" "}
                            {edge.from === selectedActivity
                              ? edge.to
                              : edge.from}{" "}
                            <b>{num(edge.count)} casos</b>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="panel-footnote">
                    <ShieldCheck size={14} />{" "}
                    <span>
                      DFG filtrado por frequência, não é um modelo Petri net nem
                      Inductive Miner. Fitness e precision são heurísticas
                      baseadas nas transições observadas.
                    </span>
                  </div>
                </article>
                <article className="panel trend-panel">
                  <div className="panel-heading">
                    <div>
                      <div className="panel-kicker">CAPACIDADE DO PROCESSO</div>
                      <h2>Volume & lead time</h2>
                      <p>Últimos meses observados no log</p>
                    </div>
                    <button
                      className="dots-button"
                      title="Exportar os dados do gráfico"
                      onClick={() => downloadCsv()}
                    >
                      <MoreHorizontal size={19} />
                    </button>
                  </div>
                  <div className="chart-legend">
                    <span>
                      <i className="legend-bar" /> casos concluídos
                    </span>
                    <span>
                      <i className="legend-line" /> lead time mediano
                    </span>
                  </div>
                  <div className="chart-area">
                    <div className="chart-yaxis">
                      <span>500</span>
                      <span>375</span>
                      <span>250</span>
                      <span>125</span>
                      <span>0</span>
                    </div>
                    <svg
                      className="volume-chart"
                      viewBox="0 0 460 220"
                      preserveAspectRatio="none"
                      aria-label="Volume mensal de casos e linha de mediana do lead time"
                    >
                      <defs>
                        <linearGradient
                          id="barShade"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="0%"
                            stopColor="#6089bd"
                            stopOpacity=".86"
                          />
                          <stop
                            offset="100%"
                            stopColor="#8faacf"
                            stopOpacity=".49"
                          />
                        </linearGradient>
                        <pattern
                          id="barStripes"
                          width="5"
                          height="5"
                          patternTransform="rotate(40)"
                          patternUnits="userSpaceOnUse"
                        >
                          <line
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="5"
                            stroke="#7296c1"
                            strokeWidth="1"
                            opacity=".35"
                          />
                        </pattern>
                      </defs>
                      <g className="chart-gridlines">
                        {[14, 60, 106, 152, 198].map(y => (
                          <line key={y} x1="5" x2="455" y1={y} y2={y} />
                        ))}
                      </g>
                      {analysis.trend.map((item, index) => {
                        const step = 440 / Math.max(1, analysis.trend.length);
                        const barWidth = Math.max(3, Math.min(26, step * 0.54));
                        const x = 9 + index * step + (step - barWidth) / 2;
                        const barHeight = Math.max(
                          7,
                          (item.cases / flowMax) * 176
                        );
                        return (
                          <g key={item.month}>
                            <rect
                              className={`volume-bar ${item.month === latestMonth ? "highlight" : ""}`}
                              x={x}
                              y={198 - barHeight}
                              width={barWidth}
                              height={barHeight}
                              rx="4"
                              fill={
                                item.month === latestMonth
                                  ? "url(#barStripes)"
                                  : "url(#barShade)"
                              }
                            >
                              <title>
                                {shortMonth(item.month)}: {item.cases} casos
                              </title>
                            </rect>
                          </g>
                        );
                      })}
                      {analysis.trend.length > 1 && (
                        <path
                          d={analysis.trend
                            .map((item, index) => {
                              const step =
                                440 / Math.max(1, analysis.trend.length);
                              const x = 9 + index * step + step / 2;
                              const y =
                                190 - Math.min(145, item.medianLeadDays * 5);
                              return `${index ? "L" : "M"} ${x} ${y}`;
                            })
                            .join(" ")}
                          className="lead-line"
                        />
                      )}
                      {analysis.trend.map((item, index) => {
                        const step = 440 / Math.max(1, analysis.trend.length);
                        const x = 9 + index * step + step / 2;
                        const y = 190 - Math.min(145, item.medianLeadDays * 5);
                        return (
                          <circle
                            key={item.month}
                            cx={x}
                            cy={y}
                            r="3.5"
                            className="lead-point"
                          >
                            <title>
                              {shortMonth(item.month)}:{" "}
                              {formatDuration(item.medianLeadDays)}
                            </title>
                          </circle>
                        );
                      })}
                    </svg>
                  </div>
                  <div className="chart-months">
                    {analysis.trend
                      .filter(
                        (_, index) =>
                          index %
                            Math.max(
                              1,
                              Math.ceil(analysis.trend.length / 8)
                            ) ===
                            0 || index === analysis.trend.length - 1
                      )
                      .map(item => (
                        <span key={item.month}>{shortMonth(item.month)}</span>
                      ))}
                  </div>
                  <div className="chart-readout">
                    <span>
                      <b>
                        {num(
                          analysis.trend.reduce(
                            (sum, item) => sum + item.cases,
                            0
                          )
                        )}
                      </b>
                      <small>casos no período</small>
                    </span>
                    <span>
                      <b>
                        {analysis.trend.length
                          ? formatDuration(
                              analysis.trend[analysis.trend.length - 1]
                                .medianLeadDays
                            )
                          : "—"}
                      </b>
                      <small>mediana do mês mais recente</small>
                    </span>
                  </div>
                  <div className="chart-annotation">
                    <ArrowDownRight size={14} />
                    <span>
                      A dispersão mensal muda com o recorte dos dados e não deve
                      ser interpretada como tendência sazonal.
                    </span>
                  </div>
                </article>
              </section>

              <section className="lower-grid">
                <article className="panel bottleneck-panel">
                  <div className="panel-heading">
                    <div>
                      <div className="panel-kicker">
                        OPORTUNIDADE DE MELHORIA
                      </div>
                      <h2>Onde o processo espera</h2>
                      <p>Transições priorizadas pela espera mediana</p>
                    </div>
                    <button
                      className="quiet-action"
                      onClick={() => setView("investigation")}
                    >
                      Investigar <ArrowUpRight size={14} />
                    </button>
                  </div>
                  {analysis.edges
                    .slice()
                    .sort((a, b) => b.medianWaitDays - a.medianWaitDays)
                    .slice(0, 4)
                    .map((edge, index) => (
                      <div
                        className="bottleneck-row"
                        key={`${edge.from}-${edge.to}`}
                      >
                        <span
                          className={`rank-number ${index < 2 ? "rank-hot" : ""}`}
                        >
                          0{index + 1}
                        </span>
                        <div className="bottleneck-copy">
                          <b>
                            {edge.from} <ArrowRight size={12} /> {edge.to}
                          </b>
                          <span>
                            {num(edge.count)} transições observadas · P90{" "}
                            {formatDuration(edge.p90WaitDays)}
                          </span>
                        </div>
                        <div className="wait-bar-wrap">
                          <div className="wait-bar">
                            <span
                              style={{
                                width: `${Math.min(100, (edge.medianWaitDays / Math.max(0.01, highestWait?.medianWaitDays || 1)) * 100)}%`,
                              }}
                            />
                          </div>
                        </div>
                        <b className="wait-value">
                          {formatDuration(edge.medianWaitDays)}
                        </b>
                      </div>
                    ))}
                  {!analysis.edges.length && (
                    <EmptyState text="São necessárias pelo menos duas atividades para identificar transições." />
                  )}
                </article>
                <article className="panel variants-panel">
                  <div className="panel-heading">
                    <div>
                      <div className="panel-kicker">CAMINHO MAIS COMUM</div>
                      <h2>Variante dominante</h2>
                      <p>O caminho de maior frequência observado</p>
                    </div>
                    <button
                      className="quiet-action"
                      onClick={() => setView("variants")}
                    >
                      Ver todas <ArrowUpRight size={14} />
                    </button>
                  </div>
                  {biggestVariant && (
                    <>
                      <div className="variant-summary">
                        <div className="variant-big-number">
                          {pct(biggestVariant.share * 100, 0)}
                        </div>
                        <div className="variant-count">
                          <b>{num(biggestVariant.count)} casos</b>
                          <span>
                            Lead time mediano de{" "}
                            {formatDuration(biggestVariant.medianLeadDays)}
                          </span>
                        </div>
                        <span className="variant-chip">
                          <Zap size={12} /> MAIS FREQUENTE
                        </span>
                      </div>
                      <div className="variant-steps">
                        {biggestVariant.path.slice(0, 7).map((step, index) => (
                          <div
                            className="variant-step"
                            key={`${step}-${index}`}
                          >
                            <span
                              className={`step-node ${index === 0 || index === biggestVariant.path.length - 1 ? "terminal" : ""}`}
                            >
                              {String(index + 1).padStart(2, "0")}
                            </span>
                            <b>{step}</b>
                            {index <
                              Math.min(6, biggestVariant.path.length - 1) && (
                              <ArrowRight size={14} />
                            )}
                          </div>
                        ))}
                        {biggestVariant.path.length > 7 && (
                          <span className="more-steps">
                            + {biggestVariant.path.length - 7} etapas
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </article>
              </section>
            </>
          )}

          {view === "variants" && (
            <section className="panel variants-table-panel">
              <div className="panel-heading">
                <div>
                  <div className="panel-kicker">
                    COMPORTAMENTO REAL DO PROCESSO
                  </div>
                  <h2>Fluxos identificados no log</h2>
                  <p>
                    Variantes de rota ordenadas por frequência; lead time
                    calculado por caso.
                  </p>
                </div>
                <div className="table-filters">
                  <label className="search-box">
                    <Search size={15} />
                    <input
                      id="variant-search"
                      value={filterQuery}
                      onChange={event => setFilterQuery(event.target.value)}
                      placeholder="Buscar uma rota…"
                    />
                  </label>
                  <button
                    className="range-button small-filter"
                    onClick={() =>
                      setDateFilter(
                        dateFilter === "Todo o período"
                          ? "Últimos 90 dias"
                          : "Todo o período"
                      )
                    }
                  >
                    <Clock3 size={14} />
                    {dateFilter}
                    <ChevronDown size={13} />
                  </button>
                </div>
              </div>
              <div className="variant-table-scroll">
                <table className="variant-table">
                  <thead>
                    <tr>
                      <th>VARIANTE</th>
                      <th>ETAPAS</th>
                      <th>PARTICIPAÇÃO</th>
                      <th>CASOS</th>
                      <th>LEAD TIME MEDIANO</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredVariants.map((variant, index) => (
                      <tr key={variant.id}>
                        <td>
                          <span className="table-variant-name">
                            <span className="table-rank">
                              {String(index + 1).padStart(2, "0")}
                            </span>
                            {index === 0 && (
                              <span className="top-path-tag">DOMINANTE</span>
                            )}
                          </span>
                        </td>
                        <td>
                          <div className="table-route">
                            {variant.path.slice(0, 4).map((step, stepIndex) => (
                              <span key={`${step}-${stepIndex}"`}>
                                {stepIndex > 0 && <ArrowRight size={11} />}{" "}
                                {step.length > 22
                                  ? `${step.slice(0, 21)}…`
                                  : step}
                              </span>
                            ))}
                            {variant.path.length > 4 && (
                              <small> + {variant.path.length - 4} etapas</small>
                            )}
                          </div>
                          <div className="variant-path-full">
                            {variant.path.join(" → ")}
                          </div>
                        </td>
                        <td>
                          <div className="participation">
                            <div className="participation-track">
                              <span
                                style={{ width: `${variant.share * 100}%` }}
                              />
                            </div>
                            <b>{pct(variant.share * 100, 1)}</b>
                          </div>
                        </td>
                        <td className="numeric-cell">{num(variant.count)}</td>
                        <td>
                          <b className="median-cell">
                            {formatDuration(variant.medianLeadDays)}
                          </b>
                        </td>
                        <td>
                          <button
                            className="table-icon-button"
                            title="Investigar esta rota"
                            onClick={() => {
                              setInvestigationQuestion(
                                `O que explica o lead time da variante ${variant.id} e quais hipóteses devo validar?`
                              );
                              setView("investigation");
                            }}
                          >
                            <ArrowUpRight size={15} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!filteredVariants.length && (
                  <EmptyState text="Nenhuma variante corresponde à busca." />
                )}
              </div>
              <div className="table-footer">
                <span>
                  <b>{num(filteredVariants.length)}</b> de{" "}
                  <b>{num(analysis.variants.length)}</b> variantes
                </span>
                <span>Rota é a sequência completa de atividades por caso.</span>
              </div>
            </section>
          )}

          {view === "investigation" && (
            <div className="investigation-layout">
              <section className="panel investigator-panel">
                <div className="panel-heading">
                  <div>
                    <div className="panel-kicker">
                      AGENTE DE INVESTIGAÇÃO{" "}
                      <span className="evidence-gate">
                        <ShieldCheck size={12} /> GATE DE EVIDÊNCIAS ATIVO
                      </span>
                    </div>
                    <h2>Pergunte ao seu processo</h2>
                    <p>
                      O agente recebe apenas estatísticas resumidas. Cada achado
                      precisa citar dados verificáveis.
                    </p>
                  </div>
                  <div className="agent-orb">
                    <Sparkles size={20} />
                  </div>
                </div>
                <div className="question-card">
                  <label htmlFor="investigation-question">
                    QUAL PERGUNTA VOCÊ QUER INVESTIGAR?
                  </label>
                  <textarea
                    id="investigation-question"
                    value={investigationQuestion}
                    maxLength={500}
                    onChange={event =>
                      setInvestigationQuestion(event.target.value)
                    }
                    placeholder="Ex.: por que algumas aprovações demoram mais?"
                  />
                  <div className="question-footer">
                    <span>
                      {num(investigationQuestion.length)} / 500 caracteres
                    </span>
                    <button
                      className="suggested-question"
                      onClick={() =>
                        setInvestigationQuestion(
                          "Quais etapas concentram a maior espera e que hipóteses posso validar com a equipe?"
                        )
                      }
                    >
                      <Sparkles size={13} />
                      Sugestão
                    </button>
                  </div>
                </div>
                <div className="scope-note">
                  <LockKeyhole size={15} />
                  <div>
                    <b>Escopo limitado, por design.</b>
                    <p>
                      O modelo não acessa o banco nem escreve SQL. Recebe apenas
                      as estatísticas abaixo e precisa citar os IDs factuais
                      correspondentes.
                    </p>
                  </div>
                </div>
                <div className="evidence-selector">
                  <div className="evidence-selector-heading">
                    <b>BASE DE EVIDÊNCIAS</b>
                    <span>
                      {num(analysis.evidence.length)} estatísticas calculadas
                    </span>
                  </div>
                  <div className="evidence-list">
                    {analysis.evidence.map(fact => (
                      <EvidenceRow
                        key={fact.id}
                        fact={fact}
                        selected={
                          usedFacts.length ? usedFacts.includes(fact.id) : true
                        }
                      />
                    ))}
                  </div>
                </div>
                <div className="investigator-footer">
                  <span>
                    <LockKeyhole size={13} /> Somente agregados são enviados à
                    IA. Números são renderizados a partir das fontes.
                  </span>
                  <Button
                    onClick={triggerInvestigation}
                    disabled={
                      investigator.isPending ||
                      authLoading ||
                      !analysis.evidence.length
                    }
                    className="investigate-button"
                  >
                    {investigator.isPending ? (
                      <>
                        <LoaderCircle className="spin" size={16} />
                        Investigando…
                      </>
                    ) : !isAuthenticated ? (
                      <>
                        <LockKeyhole size={14} />
                        Entrar para investigar
                      </>
                    ) : (
                      <>
                        <Sparkles size={16} />
                        Investigar agora
                      </>
                    )}
                  </Button>
                </div>
              </section>
              <aside className="panel findings-panel">
                <div className="panel-heading">
                  <div>
                    <div className="panel-kicker">SAÍDA COM CITAÇÃO</div>
                    <h2>Achados da investigação</h2>
                  </div>
                  <span className="verified-badge">
                    <ShieldCheck size={13} />
                    VERIFICÁVEL
                  </span>
                </div>
                {claims.length ? (
                  <>
                    <div className="findings-intro">
                      <Check size={15} />
                      Afirmações aprovadas pelo validador. Os números abaixo vêm
                      da camada estatística.
                    </div>
                    <div className="claims-list">
                      {claims.map((claim, index) => (
                        <article
                          className="claim-card"
                          key={`${claim.citations.join("-")}-${index}`}
                        >
                          <div className="claim-type">
                            <span
                              className={
                                claim.type === "hipotese"
                                  ? "hypothesis-type"
                                  : "observation-type"
                              }
                            >
                              <span />
                              {claim.type === "hipotese"
                                ? "HIPÓTESE · VALIDAR"
                                : "OBSERVAÇÃO"}
                            </span>
                            <span>#{String(index + 1).padStart(2, "0")}</span>
                          </div>
                          <p>{claim.text}</p>
                          <div className="claim-citations">
                            {claim.citations.map(citation => {
                              const fact = analysis.evidence.find(
                                item => item.id === citation
                              );
                              return fact ? (
                                <div className="citation-card" key={citation}>
                                  <span className="citation-icon">
                                    <BarChart3 size={14} />
                                  </span>
                                  <span>
                                    <small>
                                      [{fact.id}] · {fact.label}
                                    </small>
                                    <b>{fact.value}</b>
                                    <em>{fact.detail}</em>
                                  </span>
                                  <Check size={14} className="citation-check" />
                                </div>
                              ) : null;
                            })}
                          </div>
                        </article>
                      ))}
                    </div>
                    {rejectedClaims > 0 && (
                      <div className="rejected-note">
                        <ShieldCheck size={14} />
                        Gate bloqueou {num(rejectedClaims)} afirmação(ões) sem
                        uma citação válida ou com números gerados pelo modelo.
                      </div>
                    )}
                    <div className="hypothesis-disclaimer">
                      <AlertTriangle size={14} />
                      Hipóteses sugerem pontos a investigar; correlação
                      observada não comprova causalidade.
                    </div>
                  </>
                ) : (
                  <div className="findings-empty">
                    <div className="empty-orbit">
                      <Sparkles size={25} />
                    </div>
                    <h3>Seus dados, com contexto.</h3>
                    <p>
                      A investigação cruza as estatísticas existentes com a sua
                      pergunta. Números não são gerados pela IA — eles são
                      mostrados diretamente das fontes.
                    </p>
                    <div className="empty-checks">
                      <span>
                        <Check size={14} />
                        Toda frase precisa de evidência
                      </span>
                      <span>
                        <Check size={14} />
                        Citações verificadas antes de exibir
                      </span>
                      <span>
                        <Check size={14} />
                        Causalidade nunca presumida
                      </span>
                    </div>
                  </div>
                )}
                <div className="findings-audit">
                  <ShieldCheck size={14} />
                  Números de métricas e citações derivam da camada
                  determinística de analytics.
                  {usedFacts.length > 0 && (
                    <span>
                      {" "}
                      {num(usedFacts.length)} referências utilizadas.
                    </span>
                  )}
                </div>
              </aside>
            </div>
          )}

          {view === "simulation" && (
            <div className="simulation-layout">
              <section className="panel scenario-builder">
                <div className="panel-heading">
                  <div>
                    <div className="panel-kicker">
                      SIMULAÇÃO DE EVENTOS DISCRETOS
                    </div>
                    <h2>Configure seu cenário</h2>
                    <p>
                      Motor determinístico com seed fixa, filas e capacidades
                      por atividade.
                    </p>
                  </div>
                  <div className="simulation-seed">
                    <span>SEED</span>
                    <b>{scenarioConfig.seed}</b>
                  </div>
                </div>
                <div className="validation-banner">
                  <AlertTriangle size={16} />
                  <div>
                    <b>Modelo experimental · valide antes de decidir.</b>
                    <span>
                      Uma simulação só é confiável se reproduzir o período
                      histórico. Use os resultados como hipótese, nunca como
                      previsão financeira.
                    </span>
                  </div>
                </div>
                <div className="scenario-controls">
                  <label className="slider-control">
                    <span>
                      <b>Aumento de volume</b>
                      <em>Taxa de chegada dos casos</em>
                    </span>
                    <span className="slider-value">
                      +{num(scenarioConfig.volumeIncreasePct)}%
                    </span>
                    <input
                      type="range"
                      min="-20"
                      max="100"
                      step="5"
                      value={scenarioConfig.volumeIncreasePct}
                      onChange={event =>
                        setScenarioConfig({
                          ...scenarioConfig,
                          volumeIncreasePct: Number(event.target.value),
                        })
                      }
                    />
                    <span className="range-ends">
                      <i>−20%</i>
                      <i>+100%</i>
                    </span>
                  </label>
                  <div className="control-row">
                    <span>
                      <b>Perda de recurso</b>
                      <em>Remove uma unidade do gargalo observado</em>
                    </span>
                    <button
                      role="switch"
                      aria-checked={scenarioConfig.resourceLoss}
                      className={`switch ${scenarioConfig.resourceLoss ? "checked" : ""}`}
                      onClick={() =>
                        setScenarioConfig({
                          ...scenarioConfig,
                          resourceLoss: !scenarioConfig.resourceLoss,
                        })
                      }
                    >
                      <i />
                    </button>
                  </div>
                  <label className="slider-control">
                    <span>
                      <b>Tempo de aprovação</b>
                      <em>Multiplicador sobre a espera mediana observada</em>
                    </span>
                    <span className="slider-value">
                      {num(scenarioConfig.approvalSpeed, 2)}×
                    </span>
                    <input
                      type="range"
                      min="0.5"
                      max="1.5"
                      step="0.05"
                      value={scenarioConfig.approvalSpeed}
                      onChange={event =>
                        setScenarioConfig({
                          ...scenarioConfig,
                          approvalSpeed: Number(event.target.value),
                        })
                      }
                    />
                    <span className="range-ends">
                      <i>−50% de espera</i>
                      <i>+50% de espera</i>
                    </span>
                  </label>
                  <label className="select-control">
                    <span>
                      <b>Automatizar atividade</b>
                      <em>Reduz o tempo de serviço modelado</em>
                    </span>
                    <select
                      value={scenarioConfig.automationActivity}
                      onChange={event =>
                        setScenarioConfig({
                          ...scenarioConfig,
                          automationActivity: event.target.value,
                        })
                      }
                    >
                      <option value="">Nenhuma automação</option>
                      {analysis.activities.map(item => (
                        <option key={item.activity} value={item.activity}>
                          {item.activity}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="select-control">
                    <span>
                      <b>Replicações</b>
                      <em>Streams reprodutíveis com seed por execução</em>
                    </span>
                    <select
                      value={replications}
                      onChange={event => {
                        const value = Number(event.target.value);
                        setReplications(value);
                        setScenarioConfig({
                          ...scenarioConfig,
                          replications: value,
                        });
                      }}
                    >
                      <option value={100}>100 · exploração rápida</option>
                      <option value={250}>250 · intervalo preliminar</option>
                      <option value={1000}>1.000 · padrão recomendável</option>
                    </select>
                  </label>
                </div>
                <div className="scenario-run-footer">
                  <div>
                    <ShieldCheck size={15} />
                    <span>
                      Chegadas Poisson aproximadas; espera entre eventos usada
                      apenas como proxy experimental do serviço.
                    </span>
                  </div>
                  <Button
                    disabled={scenarioRunning}
                    onClick={runScenario}
                    className="run-scenario"
                  >
                    {scenarioRunning ? (
                      <>
                        <LoaderCircle size={16} className="spin" />
                        Simulando…
                      </>
                    ) : (
                      <>
                        <Play size={15} fill="currentColor" />
                        Executar {num(replications)} replicações
                      </>
                    )}
                  </Button>
                </div>
              </section>
              <aside className="panel simulation-explainer">
                <div className="panel-heading">
                  <div>
                    <div className="panel-kicker">METODOLOGIA</div>
                    <h2>Como interpretar</h2>
                  </div>
                  <CircleHelp size={18} />
                </div>
                <div className="method-steps">
                  <div>
                    <span>01</span>
                    <p>
                      <b>O que é simulado?</b>Filas nas variantes observadas,
                      com capacidade por atividade e uma distribuição ajustada
                      para cada transição.
                    </p>
                  </div>
                  <div>
                    <span>02</span>
                    <p>
                      <b>O que muda?</b>Chegadas de caso, capacidade do gargalo,
                      redução do serviço automatizado e/ou velocidade da
                      aprovação.
                    </p>
                  </div>
                  <div>
                    <span>03</span>
                    <p>
                      <b>Por que há uma faixa?</b>Cada ponto resume a mediana de
                      uma replicação. A faixa central de 95% expõe incerteza de
                      Monte Carlo, não uma garantia operacional.
                    </p>
                  </div>
                  <div className="method-warning">
                    <AlertTriangle size={15} />
                    <p>
                      <b>Limitação importante.</b>A família é escolhida por BIC
                      e diagnosticada por KS, mas a espera entre eventos ainda
                      mistura fila e serviço. Falha na validação histórica
                      bloqueia o uso decisório do cenário.
                    </p>
                  </div>
                </div>
                <div className="model-params">
                  <div>
                    <span>Eventos observados</span>
                    <b>{num(analysis.metrics.eventCount)}</b>
                  </div>
                  <div>
                    <span>Casos no baseline</span>
                    <b>{num(analysis.metrics.caseCount)}</b>
                  </div>
                  <div>
                    <span>Atividades no modelo</span>
                    <b>
                      {num(
                        analysis.variants[0]?.path.length ??
                          analysis.activities.length
                      )}
                    </b>
                  </div>
                  <div>
                    <span>Seed reproducível</span>
                    <b>{scenarioConfig.seed}</b>
                  </div>
                </div>
              </aside>
              {scenarioResult && (
                <section className="panel simulation-results">
                  <div className="panel-heading">
                    <div>
                      <div className="panel-kicker">
                        RESULTADO · {num(scenarioResult.replications)}{" "}
                        REPLICAÇÕES
                      </div>
                      <h2>Baseline vs. cenário</h2>
                      <p>
                        Saída de fila de eventos com parâmetros da configuração
                        atual.
                      </p>
                    </div>
                    <button
                      className="quiet-action"
                      onClick={() => {
                        setScenarioResult(null);
                        setSimulationValidation(false);
                      }}
                    >
                      <RotateCcw size={14} /> Reiniciar
                    </button>
                  </div>
                  <div className="scenario-summary-bar">
                    <span>
                      {scenarioResult.arrivalVolumePct !== 100
                        ? `${num(scenarioResult.arrivalVolumePct)}% do volume atual`
                        : "Volume atual"}
                    </span>
                    <span>
                      seed <b>{scenarioResult.seed}</b>
                    </span>
                    <span>
                      {num(scenarioResult.casesPerReplication)} casos por
                      réplica
                    </span>
                    <span
                      className={
                        scenarioResult.medianDeltaPct > 0
                          ? "impact-negative"
                          : "impact-positive"
                      }
                    >
                      {scenarioResult.medianDeltaPct > 0 ? (
                        <ArrowUpRight size={14} />
                      ) : (
                        <ArrowDown size={14} />
                      )}
                      {pct(Math.abs(scenarioResult.medianDeltaPct), 1)}{" "}
                      {scenarioResult.medianDeltaPct > 0
                        ? "de variação"
                        : "redução"}
                    </span>
                  </div>
                  <div className="results-comparison">
                    <ScenarioColumn
                      label="BASELINE · MEDIANA"
                      data={scenarioResult.baseline}
                      color="baseline"
                      format={formatDuration}
                    />
                    <div className="compare-arrow">
                      <ArrowRight size={18} />
                    </div>
                    <ScenarioColumn
                      label="CENÁRIO · MEDIANA"
                      data={scenarioResult.scenario}
                      color="scenario"
                      format={formatDuration}
                    />
                  </div>
                  <div className="baseline-reference">
                    <span>
                      <Target size={15} />
                      Histórico observado · lead time mediano
                    </span>
                    <b>{formatDuration(scenarioResult.observedMedianDays)}</b>
                  </div>
                  <div
                    className={`calibration-message ${scenarioResult.validation.status}`}
                  >
                    {scenarioResult.validation.status === "passed" ? (
                      <Check size={15} />
                    ) : (
                      <AlertTriangle size={15} />
                    )}
                    <div>
                      <b>
                        {scenarioResult.validation.status === "passed"
                          ? "Baseline dentro da tolerância histórica."
                          : "Baseline fora da tolerância histórica."}
                      </b>
                      <p>
                        Erro absoluto de{" "}
                        <strong>
                          {pct(
                            scenarioResult.validation.absolutePercentageError,
                            1
                          )}
                        </strong>{" "}
                        contra tolerância de{" "}
                        <strong>
                          {pct(scenarioResult.validation.tolerancePct, 0)}
                        </strong>
                        .{" "}
                        {scenarioResult.validation.status === "passed"
                          ? "Este gate cobre a mediana; distribuições, calendários e filas ainda exigem validação de domínio."
                          : "O resultado permanece visível para diagnóstico, mas não deve orientar decisão."}
                      </p>
                    </div>
                  </div>
                  <div className="validate-row">
                    <span>
                      <CircleHelp size={14} />
                      Validou as chegadas e os tempos de serviço contra o
                      histórico?
                    </span>
                    <button
                      className={`validation-toggle ${simulationValidation ? "confirmed" : ""}`}
                      onClick={() =>
                        setSimulationValidation(!simulationValidation)
                      }
                    >
                      {simulationValidation ? (
                        <>
                          <Check size={13} />
                          Registrado para esta sessão
                        </>
                      ) : (
                        "Marcar validação humana"
                      )}
                    </button>
                  </div>
                  <div className="results-footnote">
                    <ShieldCheck size={14} />
                    Intervalo empírico central de 95% entre medianas replicadas.
                    Mede incerteza de Monte Carlo, não incerteza completa do
                    processo real.
                  </div>
                </section>
              )}
            </div>
          )}

          {(resourceFilter !== "Todos os recursos" ||
            dateFilter !== "Todo o período") && (
            <div className="filter-context">
              <Activity size={13} />
              Análise de{" "}
              <b>{num(analysis.metrics.caseCount)} casos completos</b>
              {resourceFilter !== "Todos os recursos" && (
                <>
                  {" "}
                  · recurso: <b>{resourceFilter}</b>
                </>
              )}
              {dateFilter !== "Todo o período" && (
                <>
                  {" "}
                  · janela de{" "}
                  <b>
                    {dateFilter
                      .replace("Últimos ", "")
                      .replace(" dias", " dias")}
                  </b>{" "}
                  relativa à última data do log
                </>
              )}
              <button
                onClick={() => {
                  setResourceFilter("Todos os recursos");
                  setDateFilter("Todo o período");
                }}
              >
                Limpar filtros
              </button>
            </div>
          )}
          <footer className="page-footer">
            <span>© 2026 ProcessGraph AI</span>
            <span>
              <ShieldCheck size={13} />
              Dados locais · Engine determinístico v2.0
            </span>
            <button
              onClick={() =>
                toast.info(
                  `Análise ${analysis.analysisId} · fonte ${analysis.sourceHash}`
                )
              }
            >
              Feito para decisões baseadas em evidências
            </button>
          </footer>
        </div>
      </main>
      {dragging && (
        <div className="drop-overlay">
          <div className="drop-card">
            <div className="drop-icon">
              <FileUp size={26} />
            </div>
            <b>Solte seu log de eventos aqui</b>
            <span>Arquivos .CSV ou .XES · máximo de 20 MB</span>
            <button onClick={() => setDragging(false)}>
              <X size={15} />
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  change,
  subtitle,
  accent,
  foot,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  change: number | null;
  subtitle: string;
  accent: string;
  foot: string;
}) {
  return (
    <article className={`kpi-card kpi-${accent}`}>
      <div className="kpi-top">
        <span className="kpi-icon">
          <Icon size={16} />
        </span>
        <span className="kpi-label">{label}</span>
        <button
          title="Métrica calculada diretamente do log carregado"
          onClick={() => toast.info(`${label}: ${foot}`)}
          aria-label={`Informação sobre ${label}`}
        >
          <CircleHelp size={14} />
        </button>
      </div>
      <div className="kpi-value-row">
        <b>{value}</b>
        {change !== null && (
          <span
            className={
              change <= 0 ? "kpi-change positive" : "kpi-change negative"
            }
          >
            {change <= 0 ? <ArrowDown size={12} /> : <ArrowUpRight size={12} />}
            {pct(Math.abs(change), 1)}
          </span>
        )}
      </div>
      <div className="kpi-subtitle">{subtitle}</div>
      <div className="kpi-foot">{foot}</div>
    </article>
  );
}

function EvidenceRow({
  fact,
  selected,
}: {
  fact: EvidenceFact;
  selected: boolean;
}) {
  return (
    <div className={`evidence-row ${selected ? "evidence-used" : ""}`}>
      <span className="evidence-ref">[{fact.id}]</span>
      <span className="evidence-label">{fact.label}</span>
      <b>{fact.value}</b>
      <span className="evidence-tooltip" title={fact.detail}>
        <CircleHelp size={13} />
      </span>
      {selected && <Check size={13} className="evidence-check" />}
    </div>
  );
}

function ScenarioColumn({
  label,
  data,
  color,
  format,
}: {
  label: string;
  data: { median: number; p05: number; p95: number };
  color: string;
  format: (days: number) => string;
}) {
  const span = Math.max(0.02, data.p95 - data.p05);
  const offset = Math.max(
    0,
    Math.min(100, ((data.median - data.p05) / span) * 100)
  );
  return (
    <div className={`scenario-column ${color}`}>
      <div className="scenario-col-label">
        <span className={`scenario-dot ${color}`} />
        {label}
      </div>
      <div className="scenario-result-value">{format(data.median)}</div>
      <div className="scenario-spread">
        <span>INTERVALO 95%</span>
        <b>
          {format(data.p05)} <ArrowRight size={12} /> {format(data.p95)}
        </b>
      </div>
      <div className="ci-visual">
        <span className="ci-track">
          <i style={{ left: "0%", width: "100%" }} />
          <b style={{ left: `${offset}%` }} />
        </span>
      </div>
      <small>Percentis 2,5–97,5 das medianas replicadas</small>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="generic-empty">
      <div>
        <Compass size={18} />
      </div>
      <p>{text}</p>
    </div>
  );
}

void eventTimestampLabel;
void FileDown;
void MessageCircleQuestion;
void ChevronLeft;
void ChevronRight;
void MoreHorizontal;
