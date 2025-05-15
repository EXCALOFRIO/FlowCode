export interface Task {
  task_id: string;
  description: string;
  plan: Step[];
  status: string;
  model: string;
  current_step?: number;
  auto_execute?: boolean;
  report?: string;
}

export interface Step {
  step_index: number;
  titulo?: string;
  descripcion?: string;
  step?: string;
  markdown?: string;
  code?: string;
  icon?: string;
}

export interface StepResult {
  task_id: string;
  step_index: number;
  step_description: any;
  status: string;
  result: any;
  next_step: Step | null;
  task_status: string;
  retries?: number;
  recovery_strategy?: string;
  message?: string;
  function_called?: string;
  function_args?: any;
}

export interface TaskCreateRequest {
  description: string;
  model?: string;
  auto_execute?: boolean;
}

export interface StatusResponse {
  container_id?: string;
  status?: string;
  running?: boolean;
  health_status?: string;
  image?: string;
  created_at?: string;
  ports?: Record<string, any>;
  memory_usage?: string;
  cpu_usage?: string;
  error?: string;
  message?: string;
}

// Estados de la tarea y UI
export type ExecutionStatus = 'idle' | 'creating' | 'planning' | 'executing' | 'waiting_for_input' | 'completed' | 'error'; 