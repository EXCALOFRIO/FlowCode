import axios from 'axios';
import { TaskCreateRequest, Task, StepResult, StatusResponse } from '../types/index';

// URL base de la API usando el proxy de Next.js
const API_BASE_URL = '/api/agent';
const DOCKER_API_BASE_URL = '/api/docker';

// Cliente axios configurado
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  // Aumentar timeout para evitar esperas infinitas (30 segundos)
  timeout: 300000,
});

// Cliente para Docker Manager
const dockerClient = axios.create({
  baseURL: DOCKER_API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  // Añadir timeout para evitar esperas infinitas
  timeout: 10000,
});

// Funciones para interactuar con la API

// Crear una nueva tarea
export async function createTask(taskRequest: TaskCreateRequest): Promise<Task> {
  try {
    const response = await apiClient.post('/tasks', taskRequest);
    return response.data;
  } catch (error) {
    console.error('Error al crear tarea:', error);
    throw error;
  }
}

// Obtener una tarea por su ID
export async function getTask(taskId: string): Promise<Task> {
  try {
    const response = await apiClient.get(`/tasks/${taskId}`);
    return response.data;
  } catch (error) {
    console.error('Error al obtener tarea:', error);
    throw error;
  }
}

// Ejecutar un paso de una tarea
export async function executeStep(
  taskId: string,
  feedback?: string,
  autoRecover: boolean = true
): Promise<StepResult> {
  try {
    const payload = feedback ? { feedback, auto_recover: autoRecover } : { auto_recover: autoRecover };
    const response = await apiClient.post(`/tasks/${taskId}/steps`, payload);
    return response.data;
  } catch (error) {
    console.error('Error al ejecutar paso:', error);
    throw error;
  }
}

// Obtener el estado del contenedor Docker
export async function getContainerStatus(): Promise<StatusResponse> {
  try {
    console.log('Solicitando estado del contenedor...');
    const response = await dockerClient.get('/status');
    console.log('Respuesta recibida:', response.data);
    
    // Asegurar que la respuesta tiene la estructura esperada
    const data = response.data;
    
    // Establecer explícitamente la propiedad running como booleano si no está presente
    if (data.status === 'running' && data.running === undefined) {
      data.running = true;
    }
    
    return data;
  } catch (error) {
    console.error('Error detallado al obtener estado del contenedor:', error);
    
    // Crear una respuesta de error con todos los detalles
    let errorMessage = 'Error desconocido';
    if (error instanceof Error) {
      errorMessage = error.message;
    }
    
    throw new Error(`Error al obtener estado del contenedor: ${errorMessage}`);
  }
}

// Resetear el contenedor Docker
export async function resetContainer(): Promise<{ status: string; message: string }> {
  try {
    const response = await dockerClient.post('/reset');
    return response.data;
  } catch (error) {
    console.error('Error al resetear el contenedor:', error);
    throw error;
  }
}

// Obtener logs del contenedor
export async function getContainerLogs(tail: number = 100): Promise<{ logs: string }> {
  try {
    const response = await dockerClient.get(`/logs?tail=${tail}`);
    return response.data;
  } catch (error) {
    console.error('Error al obtener logs:', error);
    throw error;
  }
}

// Obtener todas las tareas
export async function getAllTasks(): Promise<Task[]> {
  try {
    const response = await apiClient.get('/tasks');
    return response.data.tasks;
  } catch (error) {
    console.error('Error al obtener tareas:', error);
    throw error;
  }
}

// Generar un reporte detallado de la tarea
export async function generateDetailedReport(taskId: string): Promise<{ report: string }> {
  try {
    const response = await axios.post(`${API_BASE_URL}/tasks/${taskId}/report`, {}, { timeout: 30000 });
    return response.data;
  } catch (error) {
    console.error('Error al generar el reporte detallado:', error);
    throw error;
  }
} 