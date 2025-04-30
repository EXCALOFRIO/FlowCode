import { ToolInterface } from '@/services/gemini-service';

/**
 * Entrada para el flujo de planificación agéntica
 */
export interface AgenticPlanningInput {
  prompt: string;
  fileNames?: string[];
  fileContents?: string[];
}

/**
 * Paso del plan agéntico
 */
export interface AgenticPlanStep {
  paso: string;
  explicacion: string;
}

/**
 * Salida del flujo de planificación agéntica
 */
export interface AgenticPlanningOutput {
  plan: string;
  pasos: AgenticPlanStep[];
  requiereInfoExterna: boolean;
  requiereAnalisisArchivos: boolean;
  detallesVisualizacion?: string;
  archivosSolicitados?: string[];
  busquedasRealizadas?: string[];
}

/**
 * Definiciones de herramientas agénticas avanzadas
 * Inspiradas en las capacidades de Manus Agent
 */
export const ADVANCED_SHELL_TOOLS: ToolInterface[] = [
  {
    name: "shell_analyze_environment",
    description: "Analiza el entorno Docker para entender qué archivos están disponibles y en qué rutas se encuentran.",
    parameters: {
      type: "object",
      properties: {
        container_id: {
          type: "string",
          description: "ID del contenedor Docker a analizar"
        }
      },
      required: ["container_id"]
    }
  },
  {
    name: "shell_execute_command",
    description: "Ejecuta un comando Shell en el entorno Docker de manera segura, con manejo de errores y adaptación automática.",
    parameters: {
      type: "object",
      properties: {
        container_id: {
          type: "string",
          description: "ID del contenedor Docker donde ejecutar el comando"
        },
        command: {
          type: "string",
          description: "Comando a ejecutar en el contenedor"
        },
        directory: {
          type: "string",
          description: "Directorio donde ejecutar el comando (opcional)"
        },
        timeout_seconds: {
          type: "integer",
          description: "Tiempo máximo de ejecución en segundos (opcional)"
        }
      },
      required: ["container_id", "command"]
    }
  },
  {
    name: "shell_analyze_file",
    description: "Analiza un archivo de código en el contenedor Docker, proporcionando información estructurada sobre su contenido.",
    parameters: {
      type: "object",
      properties: {
        container_id: {
          type: "string",
          description: "ID del contenedor Docker donde está el archivo"
        },
        file_path: {
          type: "string",
          description: "Ruta completa del archivo a analizar"
        },
        analysis_type: {
          type: "string",
          description: "Tipo de análisis a realizar (code, dependencies, imports, functions, classes)",
          enum: ["code", "dependencies", "imports", "functions", "classes", "all"]
        }
      },
      required: ["container_id", "file_path", "analysis_type"]
    }
  },
  {
    name: "shell_fix_command",
    description: "Intenta corregir un comando Shell que ha fallado, adaptándolo al entorno y condiciones específicas.",
    parameters: {
      type: "object",
      properties: {
        container_id: {
          type: "string",
          description: "ID del contenedor Docker donde se intenta ejecutar el comando"
        },
        failed_command: {
          type: "string",
          description: "Comando que ha fallado y necesita ser corregido"
        },
        error_message: {
          type: "string", 
          description: "Mensaje de error producido por el comando fallido"
        }
      },
      required: ["container_id", "failed_command", "error_message"]
    }
  }
]; 