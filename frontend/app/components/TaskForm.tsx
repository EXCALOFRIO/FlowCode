'use client';

import { useState } from 'react';
import { createTask } from '../lib/api';
import { TaskCreateRequest } from '../types';

interface TaskFormProps {
  onTaskCreated: (taskId: string) => void;
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
}

export default function TaskForm({ onTaskCreated, isLoading, setIsLoading }: TaskFormProps) {
  const [taskDescription, setTaskDescription] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!taskDescription.trim()) {
      setError('Por favor, ingresa una descripción de la tarea');
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      const taskRequest: TaskCreateRequest = {
        description: taskDescription,
        model: 'gemini-2.5-flash-preview-04-17', // Modelo predeterminado
      };

      const task = await createTask(taskRequest);
      onTaskCreated(task.task_id);
    } catch (err) {
      console.error('Error al crear la tarea:', err);
      setError('Error al crear la tarea. Por favor, intenta de nuevo.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full space-y-4">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label 
            htmlFor="task-description" 
            className="block text-sm font-medium mb-2"
          >
            Describe la tarea Docker para el agente Gemini
          </label>
          <textarea
            id="task-description"
            value={taskDescription}
            onChange={(e) => setTaskDescription(e.target.value)}
            placeholder="Ejemplo: 'Construye una imagen Docker desde './app', etiquétala como 'mi-app:v1', luego ejecútala mapeando el puerto 80 al 8080'"
            rows={5}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            disabled={isLoading}
          />
        </div>
        
        {error && (
          <div className="text-sm text-destructive">{error}</div>
        )}
        <button
          type="submit"
          className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
          disabled={isLoading}
        >
          {isLoading ? 'Creando tarea...' : 'Ejecutar tarea'}
        </button>
      </form>
    </div>
  );
} 