'use client';

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { dockerService, ContainerInfo, DockerContainerConfig, LogEntry } from '../services/docker-service';

// Función para obtener la URL base de forma segura
function getBaseUrl() {
  if (typeof window !== 'undefined') {
    // En el navegador
    return window.location.origin;
  } else {
    // En el servidor
    return 'http://localhost:9002'; // Puerto especificado en el npm run dev
  }
}

interface DockerContextType {
  isInitialized: boolean;
  isLoading: boolean;
  error: Error | null;
  containers: ContainerInfo[];
  logs: LogEntry[];
  getContainer: (config?: DockerContainerConfig) => Promise<ContainerInfo>;
  executeCommand: (containerId: string, command: string[]) => Promise<string>;
  removeContainer: (containerId: string) => Promise<void>;
  refreshContainers: () => Promise<ContainerInfo[]>;
  cleanupExceptLatest: (containerId: string) => Promise<boolean>;
}

const DockerContext = createContext<DockerContextType | undefined>(undefined);

interface DockerProviderProps {
  children: ReactNode;
}

export function DockerProvider({ children }: DockerProviderProps) {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [containers, setContainers] = useState<ContainerInfo[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  // Función para actualizar la lista de contenedores
  const refreshContainers = async (): Promise<ContainerInfo[]> => {
    try {
      // Obtenemos los contenedores activos desde la API
      const baseUrl = getBaseUrl();
      const response = await fetch(`${baseUrl}/api/docker/containers`);
      
      if (!response.ok) {
        throw new Error(`Error al obtener contenedores: ${response.statusText}`);
      }
      
      const containerList = await response.json();
      
      // Actualizamos el estado
      setContainers(containerList);
      return containerList;
    } catch (err) {
      console.error('Error al actualizar contenedores:', err);
      return [];
    }
  };

  useEffect(() => {
    let isMounted = true;

    // Inicializar el servicio Docker
    const initializeDocker = async () => {
      try {
        await dockerService.initialize();
        
        if (isMounted) {
          setIsInitialized(true);
          setIsLoading(false);
          setLogs(dockerService.getLogs());
          
          // Obtenemos los contenedores iniciales
          await refreshContainers();
        }
      } catch (err) {
        console.error('Error al inicializar Docker:', err);
        
        if (isMounted) {
          setError(err instanceof Error ? err : new Error('Error desconocido al inicializar Docker'));
          setIsLoading(false);
        }
      }
    };

    // Suscribirse a eventos de log
    const handleNewLog = (log: LogEntry) => {
      if (isMounted) {
        setLogs(prev => [...prev, log]);
      }
    };

    // Iniciar la inicialización en segundo plano
    initializeDocker();
    
    // Agregar event listener para nuevos logs
    dockerService.on('log', handleNewLog);

    // Limpieza al desmontar
    return () => {
      isMounted = false;
      dockerService.removeListener('log', handleNewLog);
    };
  }, []);

  // Funciones de utilidad para acceder al servicio
  const getContainer = async (config?: DockerContainerConfig): Promise<ContainerInfo> => {
    const container = await dockerService.getAvailableContainer(config);
    setContainers(prev => [...prev.filter(c => c.id !== container.id), container]);
    return container;
  };

  const executeCommand = async (containerId: string, command: string[]): Promise<string> => {
    return dockerService.executeCommand(containerId, command);
  };

  const removeContainer = async (containerId: string): Promise<void> => {
    await dockerService.removeContainer(containerId);
    setContainers(prev => prev.filter(c => c.id !== containerId));
  };

  const cleanupExceptLatest = async (containerId: string): Promise<boolean> => {
    return dockerService.forceCleanupExceptLatest(containerId);
  };

  const value: DockerContextType = {
    isInitialized,
    isLoading,
    error,
    containers,
    logs,
    getContainer,
    executeCommand,
    removeContainer,
    refreshContainers,
    cleanupExceptLatest,
  };

  return (
    <DockerContext.Provider value={value}>
      {children}
    </DockerContext.Provider>
  );
}

export function useDocker(): DockerContextType {
  const context = useContext(DockerContext);
  
  if (context === undefined) {
    throw new Error('useDocker debe ser usado dentro de un DockerProvider');
  }
  
  return context;
} 