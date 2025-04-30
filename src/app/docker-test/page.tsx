'use client';

import { useEffect, useState, useRef } from 'react';
import { useDocker } from '@/hooks/DockerContext';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DockerStatus } from '@/components/DockerStatus';
import { DockerCommandOutput } from '@/components/DockerCommandOutput';
import { Input } from '@/components/ui/input';
import { LogEntry } from '@/services/docker-service';
import { Loader2, Terminal, UploadCloud, Play, ChevronRight } from 'lucide-react';

export default function DockerTestPage() {
  const { getContainer, executeCommand, isInitialized } = useDocker();
  const [containerId, setContainerId] = useState<string | null>(null);
  const [isLoadingContainer, setIsLoadingContainer] = useState(false);
  const [isExecutingCommand, setIsExecutingCommand] = useState(false);
  const [commandOutput, setCommandOutput] = useState<LogEntry[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [command, setCommand] = useState('python3 --version');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Obtener un contenedor automáticamente cuando se inicializa Docker
  useEffect(() => {
    if (isInitialized && !containerId) {
      handleGetContainer();
    }
  }, [isInitialized]);

  const handleGetContainer = async () => {
    try {
      setIsLoadingContainer(true);
      const container = await getContainer();
      setContainerId(container.id);
      
      // Agregar un log de que se obtuvo el contenedor
      addCommandOutput({
        message: `Contenedor obtenido: ${container.name} (${container.id.substring(0, 12)})`,
        level: 'success',
        timestamp: new Date()
      });
      
      // Ejecutar comandos de prueba
      await runTestCommands(container.id);
    } catch (error) {
      console.error('Error al obtener contenedor:', error);
      const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
      
      addCommandOutput({
        message: `Error al obtener contenedor: ${errorMessage}`,
        level: 'error',
        timestamp: new Date()
      });
    } finally {
      setIsLoadingContainer(false);
    }
  };

  const runTestCommands = async (id: string) => {
    const testCommands = [
      ['python3', '--version'],
      ['node', '--version'],
      ['uname', '-a'],
      ['ls', '-la', '/app']
    ];
    
    for (const cmd of testCommands) {
      try {
        addCommandOutput({
          message: `Ejecutando: ${cmd.join(' ')}`,
          level: 'info',
          command: cmd.join(' '),
          timestamp: new Date()
        });
        
        const output = await executeCommand(id, cmd);
        
        addCommandOutput({
          message: output,
          level: 'info',
          timestamp: new Date()
        });
      } catch (error) {
        console.error(`Error al ejecutar comando ${cmd.join(' ')}:`, error);
        const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
        
        addCommandOutput({
          message: `Error al ejecutar ${cmd.join(' ')}: ${errorMessage}`,
          level: 'error',
          timestamp: new Date()
        });
      }
    }
  };

  const handleExecuteCommand = async () => {
    if (!containerId || !command.trim()) return;
    
    try {
      setIsExecutingCommand(true);
      const cmd = command.split(' ');
      
      addCommandOutput({
        message: `Ejecutando: ${command}`,
        level: 'info',
        command,
        timestamp: new Date()
      });
      
      const output = await executeCommand(containerId, cmd);
      
      addCommandOutput({
        message: output,
        level: 'info',
        timestamp: new Date()
      });
      
      // Limpiar el campo de comando
      setCommand('');
    } catch (error) {
      console.error('Error al ejecutar comando:', error);
      const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
      
      addCommandOutput({
        message: `Error al ejecutar comando: ${errorMessage}`,
        level: 'error',
        timestamp: new Date()
      });
    } finally {
      setIsExecutingCommand(false);
    }
  };

  const handleUploadFiles = async () => {
    if (!containerId || files.length === 0) return;
    
    try {
      setIsUploading(true);
      
      addCommandOutput({
        message: `Subiendo ${files.length} archivo(s)...`,
        level: 'info',
        timestamp: new Date()
      });
      
      // Crear un FormData para la carga de archivos
      const formData = new FormData();
      formData.append('containerId', containerId);
      
      for (const file of files) {
        formData.append('files', file);
      }
      
      // Realizar la carga
      const response = await fetch('/api/docker/upload', {
        method: 'POST',
        body: formData
      });
      
      if (!response.ok) {
        throw new Error(`Error al subir archivos: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      // Agregar log de éxito
      addCommandOutput({
        message: `Archivos subidos correctamente: ${result.files.map((f: any) => f.name).join(', ')}`,
        level: 'success',
        timestamp: new Date()
      });
      
      // Listar archivos subidos
      await executeCommand(containerId, ['ls', '-la', '/app/uploads']);
      
      // Limpiar la lista de archivos
      setFiles([]);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
      console.error('Error al subir archivos:', error);
      const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
      
      addCommandOutput({
        message: `Error al subir archivos: ${errorMessage}`,
        level: 'error',
        timestamp: new Date()
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const fileArray = Array.from(e.target.files);
      setFiles(fileArray);
      
      addCommandOutput({
        message: `${fileArray.length} archivo(s) seleccionado(s): ${fileArray.map(f => f.name).join(', ')}`,
        level: 'info',
        timestamp: new Date()
      });
    }
  };

  const addCommandOutput = (log: LogEntry) => {
    setCommandOutput(prev => [...prev, log]);
  };

  return (
    <div className="container py-8">
      <h1 className="text-3xl font-bold mb-6">Prueba de Docker</h1>
      
      <DockerStatus showDetails={true} />
      
      <Card className="p-6">
        <h2 className="text-xl font-semibold mb-4">Prueba de Comandos</h2>
        
        <div className="mb-6 flex gap-4">
          <Button 
            onClick={handleGetContainer} 
            disabled={isLoadingContainer || !isInitialized}
            className="flex items-center gap-2"
          >
            {isLoadingContainer ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Obteniendo contenedor...</>
            ) : (
              <><Terminal className="h-4 w-4" /> {containerId ? 'Reiniciar contenedor' : 'Obtener contenedor'}</>
            )}
          </Button>
          
          {containerId && (
            <div className="text-sm py-2 px-3 bg-muted rounded-md">
              ID: <code className="font-mono">{containerId.substring(0, 12)}</code>
            </div>
          )}
        </div>
        
        <Tabs defaultValue="command" className="mb-6">
          <TabsList>
            <TabsTrigger value="command">Ejecutar comando</TabsTrigger>
            <TabsTrigger value="upload">Subir archivos</TabsTrigger>
          </TabsList>
          
          <TabsContent value="command" className="mt-4">
            <div className="flex gap-2">
              <Input
                placeholder="Ingresa un comando para ejecutar en el contenedor"
                value={command}
                onChange={e => setCommand(e.target.value)}
                disabled={!containerId || isExecutingCommand}
                onKeyDown={e => e.key === 'Enter' && handleExecuteCommand()}
                className="font-mono text-sm"
              />
              <Button 
                onClick={handleExecuteCommand} 
                disabled={!containerId || isExecutingCommand || !command.trim()}
                size="icon"
              >
                {isExecutingCommand ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              </Button>
            </div>
            
            <div className="mt-2 text-xs text-muted-foreground">
              Ejemplos: <Button
                variant="link"
                size="sm"
                className="p-0 h-auto text-xs"
                onClick={() => setCommand('python3 -c "import numpy as np; print(np.random.rand(3,3))"')}
              >
                Ejecutar Python con NumPy
              </Button> | <Button
                variant="link"
                size="sm"
                className="p-0 h-auto text-xs"
                onClick={() => setCommand('node -e "console.log(\'Hola desde NodeJS\')"')}
              >
                Ejecutar Node.js
              </Button>
            </div>
          </TabsContent>
          
          <TabsContent value="upload" className="mt-4">
            <div className="flex flex-col gap-4">
              <input
                type="file"
                multiple
                onChange={handleFileChange}
                disabled={!containerId || isUploading}
                ref={fileInputRef}
                className="hidden"
                id="file-upload"
              />
              
              <label 
                htmlFor="file-upload"
                className={`
                  border-2 border-dashed rounded-lg p-8 text-center cursor-pointer
                  ${!containerId ? 'opacity-50 cursor-not-allowed' : 'hover:border-primary/50'}
                  transition-colors
                `}
              >
                <UploadCloud className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-muted-foreground">
                  Haz clic para seleccionar archivos
                </p>
              </label>
              
              {files.length > 0 && (
                <div className="mt-2">
                  <h4 className="text-sm font-medium mb-2">Archivos seleccionados:</h4>
                  <ul className="text-sm space-y-1 mb-3">
                    {files.map((file, index) => (
                      <li key={index} className="flex items-center gap-2">
                        <ChevronRight className="h-3 w-3 text-muted-foreground" />
                        {file.name} ({(file.size / 1024).toFixed(1)} KB)
                      </li>
                    ))}
                  </ul>
                  
                  <Button 
                    onClick={handleUploadFiles} 
                    disabled={isUploading}
                    className="w-full"
                  >
                    {isUploading ? (
                      <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Subiendo archivos...</>
                    ) : (
                      <><UploadCloud className="h-4 w-4 mr-2" /> Subir a /app/uploads/</>
                    )}
                  </Button>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
        
        <DockerCommandOutput 
          logs={commandOutput} 
          title="Salida de comandos" 
          maxHeight="400px" 
          emptyMessage="Ejecuta un comando para ver su salida aquí"
        />
      </Card>
    </div>
  );
} 