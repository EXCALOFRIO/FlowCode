import { useState, useCallback, useEffect } from 'react';
import { useDocker } from './DockerContext';
import { DockerContainerConfig } from '@/services/docker-service';

interface ExecutionOptions {
  containerId?: string;
  containerConfig?: DockerContainerConfig;
  timeout?: number; // Timeout en milisegundos
}

interface ExecutionResult {
  stdout: string;
  containerId: string;
  success: boolean;
  error?: Error;
}

/**
 * Hook para ejecutar comandos en un contenedor Docker
 */
export function useDockerExecution() {
  const { getContainer, executeCommand, logs } = useDocker();
  const [isExecuting, setIsExecuting] = useState(false);
  const [lastResult, setLastResult] = useState<ExecutionResult | null>(null);
  const [currentExecutionLogs, setCurrentExecutionLogs] = useState<typeof logs>([]);
  const [containerId, setContainerId] = useState<string | null>(null);

  // Actualizar logs específicos del contenedor actual
  useEffect(() => {
    if (containerId) {
      const containerLogs = logs.filter(
        log => log.containerId === containerId || 
              (!log.containerId && log.level === 'info')
      );
      setCurrentExecutionLogs(containerLogs);
    } else {
      setCurrentExecutionLogs([]);
    }
  }, [logs, containerId]);

  // Función para limpiar la ejecución actual
  const reset = useCallback(() => {
    setLastResult(null);
    setContainerId(null);
    setCurrentExecutionLogs([]);
  }, []);

  /**
   * Ejecuta un comando en un contenedor Docker
   */
  const execute = async (
    command: string[],
    options: ExecutionOptions = {}
  ): Promise<ExecutionResult> => {
    setIsExecuting(true);
    let targetContainerId: string;

    try {
      // Si se proporciona un ID de contenedor, lo usamos
      if (options.containerId) {
        targetContainerId = options.containerId;
      } else {
        // Si no, obtenemos o creamos un contenedor según la configuración
        const container = await getContainer(options.containerConfig);
        targetContainerId = container.id;
      }

      // Establecer el contenedor actual para filtrar logs
      setContainerId(targetContainerId);

      // Ejecutar el comando con timeout opcional
      let stdout: string;
      if (options.timeout) {
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Timeout al ejecutar el comando')), options.timeout);
        });

        stdout = await Promise.race([
          executeCommand(targetContainerId, command),
          timeoutPromise
        ]) as string;
      } else {
        stdout = await executeCommand(targetContainerId, command);
      }

      const result: ExecutionResult = {
        stdout,
        containerId: targetContainerId,
        success: true
      };

      setLastResult(result);
      return result;
    } catch (error) {
      const errorResult: ExecutionResult = {
        stdout: '',
        containerId: options.containerId || (containerId || ''),
        success: false,
        error: error instanceof Error ? error : new Error('Error desconocido al ejecutar comando')
      };

      setLastResult(errorResult);
      return errorResult;
    } finally {
      setIsExecuting(false);
    }
  };

  /**
   * Ejecuta varios comandos en secuencia
   */
  const executeSequence = async (
    commands: string[][],
    options: ExecutionOptions = {}
  ): Promise<ExecutionResult[]> => {
    const results: ExecutionResult[] = [];
    
    for (const command of commands) {
      try {
        const result = await execute(command, {
          ...options,
          containerId: results.length > 0 && results[results.length - 1].success 
            ? results[results.length - 1].containerId 
            : options.containerId
        });
        results.push(result);
        
        // Si algún comando falla, detener la secuencia
        if (!result.success) {
          break;
        }
      } catch (error) {
        const errorResult: ExecutionResult = {
          stdout: '',
          containerId: options.containerId || (containerId || ''),
          success: false,
          error: error instanceof Error ? error : new Error('Error desconocido al ejecutar secuencia')
        };
        results.push(errorResult);
        break;
      }
    }
    
    return results;
  };

  return {
    execute,
    executeSequence,
    isExecuting,
    lastResult,
    logs: currentExecutionLogs,
    containerId,
    reset
  };
} 