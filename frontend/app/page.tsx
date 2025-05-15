'use client';

import { useState } from 'react';
import ThemeToggle from './components/ThemeToggle';
import TaskForm from './components/TaskForm';
import TaskDetails from './components/TaskDetails';
import StatusIndicator from './components/StatusIndicator';

export default function Home() {
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const handleTaskCreated = (taskId: string) => {
    setCurrentTaskId(taskId);
  };

  const handleReset = () => {
    setCurrentTaskId(null);
  };

  return (
    <main className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 w-full border-b border-border bg-background/95 backdrop-blur">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
              <path d="M21 18H6a3 3 0 0 0 0 6h15a3 3 0 1 0 0-6M3 6h18a3 3 0 1 1 0 6H3a3 3 0 1 1 0-6"/>
              <path d="M3 12h6"/>
            </svg>
            <h1 className="text-lg font-bold">FlowCode - Docker Gemini UI</h1>
          </div>
          
          <div className="flex items-center gap-4">
            <StatusIndicator />
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Contenido Principal */}
      <div className="container mx-auto px-4 py-8">
        {!currentTaskId ? (
          /* Formulario inicial con información sobre la aplicación */
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="max-w-2xl">
              <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
                <div className="flex flex-col space-y-1.5 p-6">
                  <h3 className="text-2xl font-semibold leading-none tracking-tight">Describe Docker Task</h3>
                  <p className="text-sm text-muted-foreground">
                    Ingresa una tarea específica para que el agente Gemini la realice.
                  </p>
                </div>
                <div className="p-6 pt-0">
                  <TaskForm 
                    onTaskCreated={handleTaskCreated}
                    isLoading={isLoading}
                    setIsLoading={setIsLoading}
                  />
                </div>
              </div>
            </div>
            
            <div className="max-w-xl md:mt-0 mt-4">
              <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
                <div className="p-6">
                  <h3 className="text-xl font-semibold mb-4">¿Qué puede hacer el agente?</h3>
                  
                  <div className="space-y-4">
                    <div className="flex gap-3">
                      <div className="flex-shrink-0 h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
                          <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
                          <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                          <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
                        </svg>
                      </div>
                      <div>
                        <h4 className="font-medium">Crear y gestionar imágenes</h4>
                        <p className="text-sm text-muted-foreground">Construir, etiquetar, publicar y eliminar imágenes Docker.</p>
                      </div>
                    </div>
                    
                    <div className="flex gap-3">
                      <div className="flex-shrink-0 h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
                          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                        </svg>
                      </div>
                      <div>
                        <h4 className="font-medium">Ejecutar contenedores</h4>
                        <p className="text-sm text-muted-foreground">Iniciar, detener, ver logs y gestionar contenedores Docker.</p>
                      </div>
                    </div>
                    
                    <div className="flex gap-3">
                      <div className="flex-shrink-0 h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
                          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                          <polyline points="14 2 14 8 20 8" />
                          <path d="M10 12a1 1 0 0 0-1 1v1a1 1 0 0 1-1 1 1 1 0 0 1 1 1v1a1 1 0 0 0 1 1" />
                          <path d="M14 18a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1 1 1 0 0 1-1-1v-1a1 1 0 0 0-1-1" />
                        </svg>
                      </div>
                      <div>
                        <h4 className="font-medium">Gestionar archivos</h4>
                        <p className="text-sm text-muted-foreground">Manipular archivos dentro de contenedores y crear Dockerfiles.</p>
                      </div>
                    </div>
                    
                    <div className="flex gap-3">
                      <div className="flex-shrink-0 h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
                          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                          <polyline points="3.29 7 12 12 20.71 7" />
                          <line x1="12" y1="22" x2="12" y2="12" />
                        </svg>
                      </div>
                      <div>
                        <h4 className="font-medium">Configurar redes y volúmenes</h4>
                        <p className="text-sm text-muted-foreground">Configurar redes, volúmenes y otros aspectos de Docker.</p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="mt-6 text-sm text-muted-foreground">
                    <p>Simplemente describe lo que necesitas en lenguaje natural y el agente Gemini ejecutará los comandos Docker necesarios.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Panel de ejecución de tarea cuando hay una tarea seleccionada */
          <div className="max-w-none">
            <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
              <div className="flex flex-col space-y-1.5 p-6">
                <h3 className="text-2xl font-semibold leading-none tracking-tight">Ejecución de Tarea</h3>
                <p className="text-sm text-muted-foreground">
                  Visualiza el progreso y los resultados de la tarea.
                </p>
              </div>
              <div className="p-6 pt-0">
                <TaskDetails 
                  taskId={currentTaskId}
                  setLoading={setIsLoading}
                  onReset={handleReset}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="border-t border-border py-6">
        <div className="container mx-auto px-4">
          <p className="text-center text-sm text-muted-foreground">
            FlowCode - Agent de Docker con Gemini AI &copy; {new Date().getFullYear()}
          </p>
        </div>
      </footer>
    </main>
  );
} 