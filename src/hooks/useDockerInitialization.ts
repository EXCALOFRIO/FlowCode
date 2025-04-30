import { useEffect, useState } from 'react';
import { dockerService } from '../services/docker-service';

interface UseDockerInitializationResult {
  isInitialized: boolean;
  error: Error | null;
}

/**
 * Hook para inicializar el servicio Docker en segundo plano
 * al cargar la aplicación
 */
export function useDockerInitialization(): UseDockerInitializationResult {
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let isMounted = true;

    const initializeDocker = async () => {
      try {
        await dockerService.initialize();
        
        if (isMounted) {
          setIsInitialized(true);
        }
      } catch (err) {
        console.error('Error al inicializar Docker:', err);
        
        if (isMounted) {
          setError(err instanceof Error ? err : new Error('Error desconocido al inicializar Docker'));
        }
      }
    };

    // Iniciar la carga en segundo plano
    initializeDocker();

    // Cleanup al desmontar
    return () => {
      isMounted = false;
    };
  }, []);

  return { isInitialized, error };
} 