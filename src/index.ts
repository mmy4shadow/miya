import { resolveFeatureFlags, type MiyaPluginConfig } from "./config.ts";
import { collectDiagnostics } from "./diagnostics.ts";
import { registerDesktopTools } from "./desktop-tools.ts";
import { registerPromptProbe, registerPingTool, registerRuntimeHttp, registerStatusTool } from "./miya-runtime.ts";
import {
  registerMiyaAwakeCommand,
  registerMiyaCapabilitiesCommand,
  registerMiyaPingCommand,
  registerMiyaProbeCommand,
  registerMiyaWorkerHealthCommand,
  registerMiyaWorkflowStatusCommand,
} from "./probe-command.ts";
import { registerWorkflowHooks } from "./workloop.ts";
import { buildWorkflowContractSnapshot } from "./workflow-contract.ts";
import { registerWorkflowTools } from "./workflow-tools.ts";
import { registerMediaTools } from "./media-tools.ts";
import { registerWizardTools } from "./wizard-tools.ts";

export default function register(api: any) {
  const pluginConfig = (api?.pluginConfig ?? api?.config?.plugins?.entries?.miya?.config ?? {}) as MiyaPluginConfig;
  const features = resolveFeatureFlags(pluginConfig);

  registerPromptProbe(api);
  registerPingTool(api);
  registerStatusTool(api);
  registerDesktopTools(api);
  registerMediaTools(api);
  registerWorkflowTools(api);
  registerWizardTools(api);
  registerRuntimeHttp(api);
  registerWorkflowHooks(api);

  if (features.probeCommand) {
    registerMiyaProbeCommand(api);
  }

  if (features.workerHealthCommand) {
    registerMiyaWorkerHealthCommand(api);
  }

  registerMiyaWorkflowStatusCommand(api);
  registerMiyaPingCommand(api);
  registerMiyaAwakeCommand(api);

  if (features.capabilitiesCommand) {
    registerMiyaCapabilitiesCommand(api);
  }

  const logger = api?.logger;
  if (logger?.info) {
    collectDiagnostics(pluginConfig)
      .then((diagnostics) => {
        const buckets = diagnostics.modelBuckets.filter((bucket) => bucket.exists).map((bucket) => bucket.name).join(", ") || "none";
        const workflow = buildWorkflowContractSnapshot();
        logger.info(`[miya] phase-2 runtime loaded; worker=${diagnostics.worker.state}; features=${Object.entries(features).map(([k, v]) => `${k}=${v}`).join(",")}; model buckets=${buckets}; probes=prompt+ping+panel; workflow-contract=${workflow.authority}; workflow-statuses=${workflow.statuses.join("|")}`);
      })
      .catch((error) => {
        logger.info(`[miya] runtime loaded with partial diagnostics error: ${error instanceof Error ? error.message : String(error)}`);
      });
  }
}
