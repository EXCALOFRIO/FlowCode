'use client';

import { useState, useEffect, ReactNode, useRef } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Terminal, AlertCircle, Check, Clock, Loader2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type LogLevel = 'info' | 'error' | 'warning' | 'success';

interface LogEntry {
  timestamp: Date;
  message: string;
  level: LogLevel;
  command?: string;
}

interface DockerCommandOutputProps {
  logs: LogEntry[];
  title?: string;
  isLoading?: boolean;
  className?: string;
  containerInfo?: {
    id: string;
    name: string;
    status: string;
  };
  maxHeight?: string;
  emptyMessage?: string;
}

export function DockerCommandOutput({
  logs,
  title = 'Docker Output',
  isLoading = false,
  className,
  containerInfo,
  maxHeight = '300px',
  emptyMessage = 'Esperando comandos para mostrar la salida...'
}: DockerCommandOutputProps) {
  // Auto-scroll al final cuando se añaden nuevos logs
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  
  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const getLogIcon = (level: LogLevel): ReactNode => {
    switch (level) {
      case 'error':
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      case 'warning':
        return <AlertCircle className="h-4 w-4 text-yellow-500" />;
      case 'success':
        return <Check className="h-4 w-4 text-green-500" />;
      default:
        return <Terminal className="h-4 w-4 text-blue-500" />;
    }
  };

  const getLogClass = (level: LogLevel): string => {
    switch (level) {
      case 'error':
        return 'text-red-500 bg-red-50 dark:bg-red-950/30 border-red-200';
      case 'warning':
        return 'text-yellow-600 bg-yellow-50 dark:bg-yellow-950/30 border-yellow-200';
      case 'success':
        return 'text-green-600 bg-green-50 dark:bg-green-950/30 border-green-200';
      default:
        return 'text-blue-600 bg-blue-50 dark:bg-blue-950/30 border-blue-200';
    }
  };

  const formatTime = (date: Date): string => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <Card className={cn("w-full shadow-sm", className)}>
      <CardHeader className="py-2 px-3 flex flex-row items-center justify-between bg-muted/20">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Terminal className="h-4 w-4" />
          {title}
          {isLoading && <Loader2 className="h-3 w-3 animate-spin text-blue-500 ml-2" />}
        </CardTitle>
        
        {containerInfo && (
          <div className="flex gap-2 items-center">
            <Badge variant="secondary" className="text-xs py-0">
              {containerInfo.name}
            </Badge>
            <Badge 
              variant="secondary" 
              className={cn(
                "text-xs py-0",
                containerInfo.status === 'running' ? "bg-green-100 text-green-800 hover:bg-green-100 dark:bg-green-900 dark:text-green-300" : ""
              )}
            >
              {containerInfo.status}
            </Badge>
          </div>
        )}
      </CardHeader>
      <CardContent className="p-0 border-t">
        <div className="relative">
          <ScrollArea className={cn("p-0 rounded-b-md", maxHeight && `max-h-[${maxHeight}]`)}>
            <div className="p-4 font-mono text-sm">
              {logs.length === 0 ? (
                <div className="text-muted-foreground text-center py-8">
                  <Clock className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p>{emptyMessage}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {logs.map((log, index) => (
                    <div
                      key={index}
                      className={cn(
                        "p-2 rounded-md border",
                        getLogClass(log.level)
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <div className="flex-shrink-0 mt-1">
                          {getLogIcon(log.level)}
                        </div>
                        <div className="flex-grow">
                          {log.command && (
                            <div className="font-semibold text-xs mb-1 border-b pb-1 border-current/30">
                              $ {log.command}
                            </div>
                          )}
                          <pre className="whitespace-pre-wrap text-xs">{log.message}</pre>
                        </div>
                        <div className="text-xs opacity-60 ml-auto flex-shrink-0">
                          {formatTime(log.timestamp)}
                        </div>
                      </div>
                    </div>
                  ))}
                  <div ref={logsEndRef} />
                </div>
              )}
            </div>
          </ScrollArea>
          
          <div className="absolute bottom-2 right-2">
            <Badge
              variant="outline"
              className={cn(
                "cursor-pointer transition-colors",
                autoScroll ? "bg-primary/10 hover:bg-primary/20" : "hover:bg-muted"
              )}
              onClick={() => setAutoScroll(!autoScroll)}
            >
              {autoScroll ? "Auto-scroll: ON" : "Auto-scroll: OFF"}
            </Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
} 