export type ScenarioId = 'ENGINE_FAILURE' | 'GEAR_JAM' | 'DEPRESSURIZATION';

export type ScenarioMode = 'TRAINING' | 'CHECKRIDE';

export type ScenarioAction =
  | 'ACKNOWLEDGE'
  | 'GEAR_LEVER_DOWN'
  | 'ALTERNATE_GEAR_EXTEND'
  | 'SECURE_ENGINE'
  | 'START_EMERGENCY_DESCENT';

export interface ScenarioStep {
  id: string;
  label: string;
  detail: string;
  action: ScenarioAction;
}

export interface ScenarioDefinition {
  id: ScenarioId;
  title: string;
  subtitle: string;
  description: string;
  steps: ScenarioStep[];
}

export interface ScenarioSession {
  scenarioId: ScenarioId;
  mode: ScenarioMode;
  startedAtSimSeconds: number;
  firstActionAtSimSeconds: number | null;
  completedAtSimSeconds: number | null;
  completedStepIds: string[];
  engineIndex: number | null;
  gearExtended: boolean;
  emergencyDescentStarted: boolean;
}

export interface ScenarioSimulationContext {
  scenarioId: ScenarioId;
  emergencyDescentStarted: boolean;
  gearExtended: boolean;
}

export interface ScenarioObjective {
  id: string;
  label: string;
  met: boolean;
}

export interface ScenarioEvaluation {
  score: number;
  passed: boolean;
  objectives: ScenarioObjective[];
  completedSteps: number;
  totalSteps: number;
  elapsedSeconds: number;
}
