'use client';

import { useState, useEffect } from 'react';
import { getContainerStatus } from '../lib/api';
import { StatusResponse } from '../types';

export default function StatusIndicator() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retryCount, setRetryCount] = useState(0);
  const [debugInfo, setDebugInfo] = useState<string | null>(null);

  useEffect(() => {
    let intervalId: NodeJS.Timeout;
    let retryTimeoutId: NodeJS.Timeout;

    const fetchStatus = async () => {
      try {
        // No establecer loading en true cada vez para evitar parpadeo
        // setLoading(true);
        console.log('Iniciando solicitud de estado del contenedor...');
        const containerStatus = await getContainerStatus();
        
        // Guardar detalles de depuración
        setDebugInfo(JSON.stringify(containerStatus, null, 2));
        
        console.log('Estado del contenedor recibido:', containerStatus);
        
        setStatus(containerStatus);
        setError(null);
        setErrorDetails(null);
        // Reiniciar contador de reintentos cuando hay éxito
        setRetryCount(0);
        
        // Solo establecer loading en false la primera vez o después de un error
        if (loading) {
          setLoading(false);
        }
      } catch (err) {
        console.error('Error al obtener estado:', err);
        
        // Extraer mensaje de error más detallado
        let errorMsg = 'Error al conectar con el servidor';
        let errorDetail = '';
        
        if (err instanceof Error) {
          if (err.message.includes('timeout')) {
            errorMsg = 'Tiempo de espera agotado';
            errorDetail = 'El servidor está tardando demasiado en responder. Esto puede deberse a una alta carga o problemas de red.';
          } else {
            errorMsg = err.message;
            errorDetail = err.stack || '';
          }
        }
        
        setError(errorMsg);
        setErrorDetails(errorDetail);
        
        // Incrementar contador de reintentos
        setRetryCount((prev) => prev + 1);
        
        // Establecer loading en false si hay error
        if (loading) {
          setLoading(false);
        }
      }
    };

    // Cargar estado inicial
    fetchStatus();

    // Configurar intervalo para consultas periódicas si no hay error
    // O configurar un reintento con backoff exponencial si hay error
    if (error) {
      // Backoff exponencial: esperar más tiempo entre reintentos
      const retryDelay = Math.min(1000 * Math.pow(2, retryCount), 30000); // Máximo 30 segundos
      retryTimeoutId = setTimeout(fetchStatus, retryDelay);
      
      console.log(`Reintentando conexión en ${retryDelay/1000} segundos...`);
    } else {
      // Actualizar cada 15 segundos (aumentado para reducir carga)
      intervalId = setInterval(fetchStatus, 15000);
    }

    // Limpiar al desmontar
    return () => {
      if (intervalId) clearInterval(intervalId);
      if (retryTimeoutId) clearTimeout(retryTimeoutId);
    };
  }, [error, retryCount, loading]);

  // Función para reintentar manualmente
  const handleManualRetry = () => {
    setLoading(true);
    setRetryCount(0);
    setError(null);
    setErrorDetails(null);
  };

  // Determinar clase de color basada en el estado
  const getStatusClass = () => {
    if (loading) return 'bg-gray-400';
    if (error) return 'bg-red-500';
    if (!status) return 'bg-gray-400';
    
    // Forzar estado activo si tenemos una respuesta y se ha creado
    // Verificar la existencia de container_id (el ID real) o al menos status: running
    return (status.container_id || status.status === 'running' || status.running === true)
      ? 'bg-green-500' 
      : 'bg-red-500';
  };

  // Determinar texto de estado
  const getStatusText = () => {
    if (loading) return 'Conectando...';
    if (error) return error + (retryCount > 1 ? ` (reintento ${retryCount})` : '');
    if (!status) return 'Desconectado';
    
    // Más verificaciones para determinar si el contenedor está activo
    const isActive = status.container_id || status.status === 'running' || status.running === true;
    
    return isActive
      ? 'Contenedor activo'
      : 'Contenedor no iniciado';
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2">
        <span className={`inline-block w-3 h-3 rounded-full ${getStatusClass()}`} />
        <span className="text-sm">{getStatusText()}</span>
        
        {error && (
          <button 
            onClick={handleManualRetry}
            className="ml-2 text-xs bg-blue-500 hover:bg-blue-600 text-white px-2 py-0.5 rounded"
          >
            Reintentar
          </button>
        )}
      </div>
      
      {/* Información de error */}
      {error && errorDetails && (
        <div className="mt-1 text-xs text-red-600">
          {errorDetails}
        </div>
      )}
      
      {/* Información de depuración cuando hay errores o problemas */}
      {(process.env.NODE_ENV !== 'production' && (error || debugInfo)) && (
        <details className="mt-1 text-xs text-muted-foreground">
          <summary>Detalles (debug)</summary>
          <pre className="mt-1 p-1 bg-muted/20 rounded-sm overflow-x-auto max-w-[300px]">
            {debugInfo || 'No hay información disponible'}
          </pre>
        </details>
      )}
    </div>
  );
} 