/**
 * Tipos para el flujo agéntico de planificación
 */

export interface AgenticPlanningInput {
  prompt: string;
  fileNames?: string[];
  fileContents?: string[];
}

export interface AgenticPlanStep {
  paso: string;
  explicacion: string;
}

export interface AgenticPlanningOutput {
  plan: string;
  pasos: AgenticPlanStep[];
  requiereInfoExterna: boolean;
  requiereAnalisisArchivos: boolean;
  detallesVisualizacion?: string;
  archivosSolicitados?: string[];
  busquedasRealizadas?: string[];
} 