'use client';

import { useDocker } from '@/hooks/DockerContext';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2, TerminalSquare, AlertCircle, Database, Cpu, Package, Network, Server, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useEffect, useState } from 'react';
import { DockerCommandOutput } from './DockerCommandOutput';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { ContainerInfo, LogEntry } from '@/services/docker-service';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

interface DockerStatusProps {
  showDetails?: boolean;
}

export function DockerStatus({ showDetails = false }: DockerStatusProps) {
  const { isInitialized, isLoading, error, containers, logs, refreshContainers, executeCommand, cleanupExceptLatest } = useDocker();
  const [showStatus, setShowStatus] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [selectedContainer, setSelectedContainer] = useState<string | null>(null);
  const [containerStatuses, setContainerStatuses] = useState<Record<string, ContainerInfo>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [commandResult, setCommandResult] = useState<{command: string, output: string} | null>(null);
  const [commandInput, setCommandInput] = useState('');
  const [executingCommand, setExecutingCommand] = useState(false);

  // Solo mostrar después de 2 segundos si aún está cargando
  useEffect(() => {
    const timer = setTimeout(() => {
      if (isLoading) {
        setShowStatus(true);
      }
    }, 2000);

    return () => clearTimeout(timer);
  }, [isLoading]);

  // Obtener información detallada de los contenedores periódicamente
  useEffect(() => {
    if (!isInitialized || containers.length === 0) return;

    const fetchContainerStatus = async () => {
      try {
        const statusPromises = containers.map(async (container) => {
          try {
            const response = await fetch(`/api/docker/status/${container.id}`);
            if (response.ok) {
              const data = await response.json();
              return data;
            }
          } catch (error) {
            console.error(`Error al obtener estado del contenedor ${container.id}:`, error);
          }
          return null;
        });

        const statuses = await Promise.all(statusPromises);
        const statusMap = statuses.reduce((acc, status) => {
          if (status) {
            acc[status.id] = status;
          }
          return acc;
        }, {} as Record<string, ContainerInfo>);

        setContainerStatuses(statusMap);
      } catch (error) {
        console.error('Error al actualizar estados de contenedores:', error);
      }
    };

    // Actualizar estados de inmediato y luego cada 10 segundos
    fetchContainerStatus();
    const interval = setInterval(fetchContainerStatus, 10000);

    return () => clearInterval(interval);
  }, [isInitialized, containers]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshContainers();
    
    // Simular un pequeño retraso para evitar parpadeos rápidos del UI
    setTimeout(() => {
      setRefreshing(false);
    }, 500);
  };
  
  // Función para limpiar todos los contenedores excepto el seleccionado
  const handleCleanup = async () => {
    if (!selectedContainer && containers.length === 0) {
      return;
    }
    
    // Si no hay contenedor seleccionado, usar el más reciente
    const containerId = selectedContainer || containers[0].id;
    
    setCleaning(true);
    
    try {
      await cleanupExceptLatest(containerId);
      // Actualizar la lista de contenedores después de una breve pausa
      setTimeout(async () => {
        await refreshContainers();
        setCleaning(false);
      }, 1000);
    } catch (error) {
      console.error('Error al limpiar contenedores:', error);
      setCleaning(false);
    }
  };
  
  // Función para ejecutar un comando
  const handleExecuteCommand = async (containerId: string, cmd: string) => {
    if (!cmd.trim()) return;
    
    setExecutingCommand(true);
    
    try {
      const command = cmd.split(' ');
      const output = await executeCommand(containerId, command);
      
      // Guardar el resultado para mostrarlo
      setCommandResult({
        command: cmd,
        output
      });
      
      // Limpiar el input
      setCommandInput('');
    } catch (error) {
      console.error('Error al ejecutar comando:', error);
      
      // Guardar el error como resultado para mostrarlo
      setCommandResult({
        command: cmd,
        output: error instanceof Error ? error.message : 'Error desconocido al ejecutar el comando'
      });
    } finally {
      setExecutingCommand(false);
    }
  };

  // No mostrar nada si Docker está inicializado y no se solicitan detalles
  if (isInitialized && !showDetails && !expanded) {
    // Obtener el contenedor activo más reciente
    const activeContainer = containers.find(c => c.status === 'running');
    
    return (
      <div className="mb-4 flex justify-between items-center">
        <div className="flex items-center gap-2">
          {activeContainer && (
            <Badge variant="success" className="px-2 py-0.5 gap-1 flex items-center">
              <Server className="h-3 w-3" />
              <span>Docker: {activeContainer.name.substring(0, 12)}</span>
            </Badge>
          )}
        </div>
        <Button 
          variant="outline" 
          size="sm" 
          className="text-xs flex items-center gap-1" 
          onClick={() => setExpanded(true)}
        >
          <TerminalSquare className="h-3.5 w-3.5" />
          Ver estado de Docker
        </Button>
      </div>
    );
  }

  // No mostrar nada si está cargando pero no ha pasado suficiente tiempo
  if (isLoading && !showStatus && !expanded) {
    return null;
  }

  const initialStatusSection = (
    <div className="mb-4">
      {isLoading && (
        <Alert className="bg-blue-50 border-blue-200">
          <Loader2 className="h-4 w-4 mr-2 animate-spin text-blue-500" />
          <AlertTitle>Iniciando Docker</AlertTitle>
          <AlertDescription>
            Preparando el entorno Docker en segundo plano...
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Error al inicializar Docker</AlertTitle>
          <AlertDescription>
            {error.message}
          </AlertDescription>
        </Alert>
      )}

      {isInitialized && (
        <Alert className="bg-green-50 border-green-200">
          <AlertTitle>Docker inicializado</AlertTitle>
          <AlertDescription>
            El entorno Docker está listo para ejecutar comandos.
            {expanded && (
              <Button 
                variant="link" 
                size="sm" 
                className="text-xs p-0 h-auto mt-1 text-green-700"
                onClick={() => setExpanded(false)}
              >
                Ocultar detalles
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );

  if (!expanded) {
    return initialStatusSection;
  }

  return (
    <Card className="mb-6 w-full max-w-3xl mx-auto">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <TerminalSquare className="h-5 w-5" />
          Estado de Docker
          {isLoading && <Loader2 className="h-4 w-4 animate-spin text-blue-500 ml-2" />}
        </CardTitle>
        <CardDescription>
          Monitorea el estado y los logs del entorno Docker
          <Button 
            variant="link" 
            size="sm" 
            className="text-xs p-0 h-auto ml-2 text-muted-foreground"
            onClick={() => setExpanded(false)}
          >
            Minimizar
          </Button>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="containers">
          <TabsList className="mb-4">
            <TabsTrigger value="containers">Contenedores</TabsTrigger>
            <TabsTrigger value="logs">Logs</TabsTrigger>
            <TabsTrigger value="commands">Comandos</TabsTrigger>
          </TabsList>
          
          <TabsContent value="containers">
            <div className="flex justify-between items-center mb-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleCleanup}
                disabled={cleaning || isLoading || containers.length <= 1}
                className={`text-xs flex items-center gap-1 ${cleaning ? 'bg-yellow-50 text-yellow-700' : 'bg-red-50 hover:bg-red-100 text-red-600'}`}
              >
                {cleaning ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Limpiando...
                  </>
                ) : (
                  <>
                    <AlertCircle className="h-3 w-3" />
                    Limpiar {containers.length > 1 ? containers.length - 1 : 0}
                  </>
                )}
              </Button>
              
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleRefresh}
                disabled={refreshing || isLoading}
                className="text-xs flex items-center gap-1"
              >
                {refreshing ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
                Actualizar
              </Button>
            </div>
            
            {containers.length > 0 ? (
              <>
                <div className="space-y-3 mb-4">
                  {containers.map(container => {
                    const detailedStatus = containerStatuses[container.id];
                    const isRunning = container.status === 'running';
                    
                    // Extraer información de memoria y CPU si está disponible
                    let cpuUsage = "N/A";
                    let memoryUsage = "N/A";
                    let memoryPercentage = 0;
                    
                    if (detailedStatus?.systemInfo) {
                      cpuUsage = detailedStatus.systemInfo.cpu || "N/A";
                      memoryUsage = detailedStatus.systemInfo.memory || "N/A";
                      memoryPercentage = parseInt(detailedStatus.systemInfo.memoryPercentage || "0");
                    }
                    
                    const isSelected = selectedContainer === container.id;
                    
                    return (
                      <Card 
                        key={container.id} 
                        className={`border ${isSelected ? 'border-primary' : ''} hover:border-primary/50 transition-colors cursor-pointer`}
                        onClick={() => setSelectedContainer(isSelected ? null : container.id)}
                      >
                        <CardHeader className="py-2 px-3">
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-base flex items-center gap-2">
                              <Server className="h-4 w-4" />
                              {container.name}
                            </CardTitle>
                            <Badge variant={isRunning ? "success" : "secondary"}>
                              {container.status}
                            </Badge>
                          </div>
                          <CardDescription className="text-xs mt-1">
                            ID: {container.id.substring(0, 12)} | Imagen: {container.image}
                          </CardDescription>
                        </CardHeader>
                        
                        {isSelected && (
                          <CardContent className="py-2 px-3">
                            <div className="grid grid-cols-2 gap-3 text-sm">
                              <div>
                                <div className="flex items-center gap-1 mb-1 text-muted-foreground text-xs">
                                  <Cpu className="w-3.5 h-3.5" />
                                  <span>CPU</span>
                                </div>
                                <div className="flex justify-between items-center">
                                  <span className="font-medium">{cpuUsage}</span>
                                </div>
                              </div>
                              
                              <div>
                                <div className="flex items-center gap-1 mb-1 text-muted-foreground text-xs">
                                  <Database className="w-3.5 h-3.5" />
                                  <span>Memoria</span>
                                </div>
                                <div className="space-y-1">
                                  <div className="flex justify-between items-center text-xs">
                                    <span>{memoryUsage}</span>
                                    <span>{memoryPercentage}%</span>
                                  </div>
                                  <Progress value={memoryPercentage} className="h-1.5" />
                                </div>
                              </div>
                              
                              {detailedStatus?.runningTime && (
                                <div className="col-span-2 mt-1">
                                  <div className="flex items-center gap-1 text-muted-foreground text-xs">
                                    <span>Tiempo en ejecución: {detailedStatus.runningTime}</span>
                                  </div>
                                </div>
                              )}
                              
                              {detailedStatus?.ports && detailedStatus.ports.length > 0 && (
                                <div className="col-span-2 mt-1">
                                  <div className="flex items-center gap-1 text-muted-foreground text-xs">
                                    <Network className="w-3.5 h-3.5" />
                                    <span>Puertos: {detailedStatus.ports.join(', ')}</span>
                                  </div>
                                </div>
                              )}
                            </div>
                            
                            <Separator className="my-3" />
                            
                            <div className="flex flex-col gap-2">
                              <div className="flex items-center gap-2">
                                <input 
                                  type="text" 
                                  className="flex-1 px-2 py-1 text-xs border rounded" 
                                  placeholder="Ingresa un comando (ej: ls -la)" 
                                  value={commandInput}
                                  onChange={(e) => setCommandInput(e.target.value)}
                                  onClick={(e) => e.stopPropagation()}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !executingCommand) {
                                      e.stopPropagation();
                                      handleExecuteCommand(container.id, commandInput);
                                    }
                                  }}
                                />
                                <Button 
                                  size="sm" 
                                  className="text-xs h-7"
                                  disabled={executingCommand || !commandInput.trim()}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleExecuteCommand(container.id, commandInput);
                                  }}
                                >
                                  {executingCommand ? (
                                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                                  ) : null}
                                  Ejecutar
                                </Button>
                              </div>
                              
                              {commandResult && (
                                <div className="mt-2 text-xs bg-gray-50 p-2 rounded border">
                                  <div className="font-semibold text-xs mb-1">$ {commandResult.command}</div>
                                  <div className="whitespace-pre-wrap max-h-20 overflow-y-auto text-xs font-mono">
                                    {commandResult.output || "El comando no produjo ninguna salida."}
                                  </div>
                                </div>
                              )}
                            </div>
                          </CardContent>
                        )}
                      </Card>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Server className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p>No hay contenedores en ejecución actualmente.</p>
              </div>
            )}
          </TabsContent>
          
          <TabsContent value="logs">
            <DockerCommandOutput logs={logs} title="Logs de Docker" />
          </TabsContent>
          
          <TabsContent value="commands">
            <div className="bg-gray-50 rounded-md p-3 border">
              <h3 className="text-sm font-medium mb-2">Comandos frecuentes</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[
                  { name: "Listar archivos", cmd: "ls -la" },
                  { name: "Verificar Python", cmd: "python3 --version" },
                  { name: "Verificar Node.js", cmd: "node --version" },
                  { name: "Crear archivo de prueba", cmd: "echo 'Prueba' > test.txt" },
                  { name: "Ver contenido de archivo", cmd: "cat test.txt" },
                  { name: "Instalar biblioteca Python", cmd: "pip install requests" }
                ].map((item) => (
                  <Button 
                    key={item.cmd}
                    variant="outline" 
                    size="sm" 
                    className="text-xs justify-start h-auto py-1 px-2"
                    onClick={() => {
                      if (selectedContainer) {
                        handleExecuteCommand(selectedContainer, item.cmd);
                      } else if (containers.length > 0) {
                        setSelectedContainer(containers[0].id);
                        handleExecuteCommand(containers[0].id, item.cmd);
                      }
                    }}
                    disabled={containers.length === 0 || executingCommand}
                  >
                    <span className="truncate">{item.name}: <span className="font-mono">{item.cmd}</span></span>
                  </Button>
                ))}
              </div>
            </div>
            
            {commandResult && (
              <div className="mt-3">
                <h3 className="text-sm font-medium mb-1">Último comando ejecutado</h3>
                <div className="bg-black text-white p-2 rounded-md font-mono text-xs">
                  <div className="text-green-400">$ {commandResult.command}</div>
                  <div className="mt-1 whitespace-pre-wrap max-h-48 overflow-y-auto">
                    {commandResult.output || "El comando no produjo ninguna salida."}
                  </div>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
      
      <CardFooter className="pt-0 text-xs text-muted-foreground border-t px-6 py-3">
        <div className="flex items-center gap-2">
          <Package className="h-3.5 w-3.5" />
          <span>
            {containers.length} contenedor{containers.length !== 1 ? 'es' : ''} activo{containers.length !== 1 ? 's' : ''}
          </span>
        </div>
      </CardFooter>
    </Card>
  );
} 