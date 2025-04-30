'use client';

import { useState, useRef } from 'react';
import { useDockerExecution } from '@/hooks/useDockerExecution';
import { DockerCommandOutput } from './DockerCommandOutput';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Play, X, Terminal, Save, Copy } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';

interface DockerExecutionProps {
  title?: string;
  className?: string;
}

export function DockerExecution({ title = 'Ejecutar comandos', className }: DockerExecutionProps) {
  const { execute, lastResult, isExecuting, logs, reset, containerId } = useDockerExecution();
  const [command, setCommand] = useState('');
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleExecute = async () => {
    if (!command.trim()) return;
    
    try {
      // Guardar en historial
      setCommandHistory(prev => [...prev, command]);
      
      // Ejecutar comando
      const parsedCommand = parseCommand(command);
      await execute(parsedCommand);
      
      // Limpiar input
      setCommand('');
      setHistoryIndex(-1);
      
      // Dar foco al input
      inputRef.current?.focus();
    } catch (error) {
      console.error('Error al ejecutar comando:', error);
    }
  };

  const parseCommand = (cmd: string): string[] => {
    const parts: string[] = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';
    
    for (let i = 0; i < cmd.length; i++) {
      const char = cmd[i];
      
      if ((char === '"' || char === "'") && (i === 0 || cmd[i-1] !== '\\')) {
        if (!inQuotes) {
          inQuotes = true;
          quoteChar = char;
        } else if (char === quoteChar) {
          inQuotes = false;
          quoteChar = '';
        } else {
          current += char;
        }
      } else if (char === ' ' && !inQuotes) {
        if (current) {
          parts.push(current);
          current = '';
        }
      } else {
        current += char;
      }
    }
    
    if (current) {
      parts.push(current);
    }
    
    return parts;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleExecute();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      navigateHistory(-1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      navigateHistory(1);
    }
  };

  const navigateHistory = (direction: number) => {
    if (commandHistory.length === 0) return;
    
    let newIndex = historyIndex + direction;
    
    if (newIndex >= commandHistory.length) {
      newIndex = -1; // Volver al input vacío
    } else if (newIndex < -1) {
      newIndex = commandHistory.length - 1; // Ir al comando más antiguo
    }
    
    setHistoryIndex(newIndex);
    
    if (newIndex === -1) {
      setCommand('');
    } else {
      setCommand(commandHistory[newIndex]);
    }
  };

  const copyOutput = () => {
    if (lastResult?.stdout) {
      navigator.clipboard.writeText(lastResult.stdout);
      toast({
        title: "Copiado al portapapeles",
        description: "La salida del comando ha sido copiada"
      });
    }
  };

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="h-5 w-5" />
            {title}
          </div>
          {containerId && (
            <Badge variant="secondary" className="text-xs">
              {containerId.substring(0, 12)}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      
      <CardContent className="pt-0">
        <DockerCommandOutput
          logs={logs}
          isLoading={isExecuting}
          maxHeight="300px"
        />
        
        <div className="flex gap-2 mt-4">
          <Input
            ref={inputRef}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ingresa un comando para ejecutar (ej: python --version)"
            disabled={isExecuting}
            className="font-mono text-sm"
          />
          
          <Button 
            onClick={handleExecute}
            disabled={isExecuting || !command.trim()}
            size="icon"
            className="flex-shrink-0"
          >
            <Play className="h-4 w-4" />
          </Button>
          
          <Button
            onClick={reset}
            variant="outline"
            size="icon"
            className="flex-shrink-0"
            title="Limpiar"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        
        {lastResult?.stdout && (
          <div className="mt-4">
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-sm font-medium">Salida del último comando</h3>
              <Button 
                variant="ghost" 
                size="sm" 
                className="h-7 px-2" 
                onClick={copyOutput}
              >
                <Copy className="h-3.5 w-3.5 mr-1" />
                <span className="text-xs">Copiar</span>
              </Button>
            </div>
            <div className="bg-muted p-3 rounded-md overflow-x-auto">
              <pre className="text-xs whitespace-pre-wrap font-mono">{lastResult.stdout}</pre>
            </div>
          </div>
        )}
      </CardContent>
      
      {commandHistory.length > 0 && (
        <CardFooter className="flex-col items-start pt-0">
          <h3 className="text-sm font-medium mb-2">Historial de comandos</h3>
          <div className="w-full space-y-1">
            {commandHistory.slice(-5).reverse().map((cmd, index) => (
              <div 
                key={commandHistory.length - index - 1} 
                className="flex items-center gap-2 text-xs py-1 px-2 rounded-md hover:bg-muted cursor-pointer"
                onClick={() => setCommand(cmd)}
              >
                <Terminal className="h-3 w-3 text-muted-foreground" />
                <span className="font-mono truncate">{cmd}</span>
              </div>
            ))}
          </div>
        </CardFooter>
      )}
    </Card>
  );
} 