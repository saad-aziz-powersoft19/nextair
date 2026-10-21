import { FlightPhase, LiveTelemetry } from '@/types/flight';
import {
  ScenarioDefinition,
  ScenarioEvaluation,
  ScenarioId,
  ScenarioMode,
  ScenarioSession,
  ScenarioStep,
} from '@/types/scenario';

export const SCENARIO_PHASES: FlightPhase[] = [
  'CLIMB',
  'CRUISE',
  'APPROACH_READY',
  'DESCENT',
];

export const SCENARIO_DEFINITIONS: ScenarioDefinition[] = [
  {
    id: 'ENGINE_FAILURE',
    title: 'Engine Failure',
    subtitle: 'One engine failed in flight',
    description:
      'A powerplant has failed at altitude. Maintain control, identify and secure the failed engine, then plan the driftdown and diversion.',
    steps: [
      {
        id: 'maintainControl',
        label: 'Maintain aircraft control',
        detail: 'Disconnect automation and hold heading and altitude.',
        action: 'ACKNOWLEDGE',
      },
      {
        id: 'identifyEngine',
        label: 'Identify failed engine',
        detail: 'Confirm yaw and instrument indications before acting.',
        action: 'ACKNOWLEDGE',
      },
      {
        id: 'secureEngine',
        label: 'Secure failed engine',
        detail: 'Thrust lever idle, fuel control cutoff, fire switch pull.',
        action: 'SECURE_ENGINE',
      },
      {
        id: 'driftdown',
        label: 'Assess driftdown and diversion',
        detail: 'Descend to engine-out altitude and review diversion options.',
        action: 'ACKNOWLEDGE',
      },
    ],
  },
  {
    id: 'GEAR_JAM',
    title: 'Gear Jam',
    subtitle: 'Landing gear will not extend',
    description:
      'The landing gear has jammed in the up position. Attempt a normal extension, then use the alternate extension procedure.',
    steps: [
      {
        id: 'gearLeverDown',
        label: 'Gear lever — DOWN',
        detail: 'No green light. Leave the lever down and do not recycle.',
        action: 'GEAR_LEVER_DOWN',
      },
      {
        id: 'checkBreakers',
        label: 'Check gear circuit breakers',
        detail: 'Reset any popped breaker and verify hydraulic pressure.',
        action: 'ACKNOWLEDGE',
      },
      {
        id: 'alternateExtend',
        label: 'Alternate gear extension',
        detail: 'Pull the alternate release and verify three green.',
        action: 'ALTERNATE_GEAR_EXTEND',
      },
      {
        id: 'landingConfig',
        label: 'Configure for landing',
        detail: 'Set flaps, brief the cabin, and expect an unsafe gear check.',
        action: 'ACKNOWLEDGE',
      },
    ],
  },
  {
    id: 'DEPRESSURIZATION',
    title: 'Depressurization',
    subtitle: 'Cabin altitude rising',
    description:
      'The cabin has depressurized at altitude. Don oxygen, begin an emergency descent to 10,000 ft, and secure the cabin.',
    steps: [
      {
        id: 'oxygenMasks',
        label: 'Oxygen masks — ON',
        detail: 'Don masks and establish crew communications.',
        action: 'ACKNOWLEDGE',
      },
      {
        id: 'startEmergencyDescent',
        label: 'Emergency descent — START',
        detail: 'Idle thrust, speedbrake full, descend to 10,000 ft.',
        action: 'START_EMERGENCY_DESCENT',
      },
      {
        id: 'cabinSecure',
        label: 'Cabin — secure',
        detail: 'Broadcast a PA and have the crew secure the cabin.',
        action: 'ACKNOWLEDGE',
      },
      {
        id: 'levelOff',
        label: 'Level off at 10,000 ft',
        detail: 'Reduce speed, set cruise thrust, and assess oxygen.',
        action: 'ACKNOWLEDGE',
      },
    ],
  },
];

const SCENARIO_MAP: Record<ScenarioId, ScenarioDefinition> = {
  ENGINE_FAILURE: SCENARIO_DEFINITIONS[0],
  GEAR_JAM: SCENARIO_DEFINITIONS[1],
  DEPRESSURIZATION: SCENARIO_DEFINITIONS[2],
};

export function getScenarioDefinition(id: ScenarioId): ScenarioDefinition {
  return SCENARIO_MAP[id];
}

export function getScenarioStep(
  scenarioId: ScenarioId,
  stepId: string
): ScenarioStep | undefined {
  return getScenarioDefinition(scenarioId).steps.find((step) => step.id === stepId);
}

export function canStartScenario(phase: FlightPhase): boolean {
  return SCENARIO_PHASES.includes(phase);
}

export function createScenarioSession(
  scenarioId: ScenarioId,
  mode: ScenarioMode,
  startedAtSimSeconds: number,
  engineIndex: number | null = null
): ScenarioSession {
  return {
    scenarioId,
    mode,
    startedAtSimSeconds,
    firstActionAtSimSeconds: null,
    completedAtSimSeconds: null,
    completedStepIds: [],
    engineIndex,
    gearExtended: false,
    emergencyDescentStarted: false,
  };
}

export function completeScenarioStep(
  session: ScenarioSession,
  stepId: string,
  atSimSeconds: number
): ScenarioSession {
  const definition = getScenarioDefinition(session.scenarioId);
  const step = definition.steps.find((item) => item.id === stepId);
  if (!step || session.completedStepIds.includes(stepId)) return session;

  const completedStepIds = [...session.completedStepIds, stepId];
  const allComplete = definition.steps.every((item) =>
    completedStepIds.includes(item.id)
  );

  return {
    ...session,
    completedStepIds,
    firstActionAtSimSeconds:
      session.firstActionAtSimSeconds ?? atSimSeconds,
    completedAtSimSeconds: allComplete
      ? session.completedAtSimSeconds ?? atSimSeconds
      : null,
    gearExtended:
      session.gearExtended || step.action === 'ALTERNATE_GEAR_EXTEND',
    emergencyDescentStarted:
      session.emergencyDescentStarted ||
      step.action === 'START_EMERGENCY_DESCENT',
  };
}

export function getScenarioElapsedSeconds(
  session: ScenarioSession,
  simulationSeconds: number
): number {
  const endSeconds = session.completedAtSimSeconds ?? simulationSeconds;
  return Math.max(0, Math.round(endSeconds - session.startedAtSimSeconds));
}

export function evaluateScenario(
  session: ScenarioSession,
  telemetry: LiveTelemetry,
  atArrival = false
): ScenarioEvaluation {
  const definition = getScenarioDefinition(session.scenarioId);
  const completedSteps = definition.steps.filter((step) =>
    session.completedStepIds.includes(step.id)
  ).length;
  const totalSteps = definition.steps.length;
  const allComplete = completedSteps === totalSteps;
  const elapsedSeconds = getScenarioElapsedSeconds(
    session,
    telemetry.elapsedSimSeconds
  );
  const responseSeconds =
    session.firstActionAtSimSeconds === null
      ? null
      : Math.max(0, session.firstActionAtSimSeconds - session.startedAtSimSeconds);
  const timelyResponse = responseSeconds !== null && responseSeconds <= 60;
  const safeLanding = Boolean(telemetry.gearDown) && atArrival;

  let configured = false;
  let configurationLabel = 'Aircraft configured';

  if (session.scenarioId === 'ENGINE_FAILURE') {
    configured = session.completedStepIds.includes('secureEngine');
    configurationLabel = 'Failed engine secured';
  } else if (session.scenarioId === 'GEAR_JAM') {
    configured =
      session.gearExtended &&
      Boolean(telemetry.gearDown) &&
      session.completedStepIds.includes('alternateExtend');
    configurationLabel = 'Gear extended by alternate method';
  } else {
    configured =
      session.emergencyDescentStarted &&
      session.completedStepIds.includes('startEmergencyDescent') &&
      telemetry.altitudeFt <= 12000;
    configurationLabel = 'Emergency descent completed below 12,000 ft';
  }

  const objectives = [
    {
      id: 'checklist',
      label: 'Emergency checklist completed',
      met: allComplete,
    },
    {
      id: 'response',
      label: 'First action within 60 seconds',
      met: timelyResponse,
    },
    {
      id: 'configuration',
      label: configurationLabel,
      met: configured,
    },
  ];

  if (atArrival) {
    objectives.push({
      id: 'landing',
      label: 'Safe landing with gear down',
      met: safeLanding,
    });
  }

  let score = 100;
  if (!allComplete) score -= 25;
  if (!timelyResponse) score -= 15;
  if (!configured) score -= 20;
  if (atArrival && !safeLanding) score -= 30;
  score = Math.max(0, score);

  return {
    score,
    passed: score >= 80 && allComplete && (!atArrival || safeLanding),
    objectives,
    completedSteps,
    totalSteps,
    elapsedSeconds,
  };
}
