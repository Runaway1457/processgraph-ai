import {
  analyzeProcess,
  simulateScenario,
  type ProcessEvent,
  type ScenarioConfig,
} from "../../../shared/processGraph";

self.onmessage = (
  event: MessageEvent<{ events: ProcessEvent[]; config: ScenarioConfig }>
) => {
  try {
    const analysis = analyzeProcess(event.data.events);
    const result = simulateScenario(
      analysis,
      event.data.config,
      event.data.events
    );
    self.postMessage({ success: true, result });
  } catch (error) {
    self.postMessage({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Erro desconhecido na simulação.",
    });
  }
};
