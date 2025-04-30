// Servicio Docker que funciona tanto en el cliente como en el servidor
import { EventEmitter } from 'events';

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

// Limpieza agresiva de contenedores obsoletos
async function cleanupAllExceptLatest(containerId: string) {
  try {
    const baseUrl = getBaseUrl();
    const response = await fetch(`${baseUrl}/api/docker/cleanup-others`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ keepContainerId: containerId })
    });
    
    if (!response.ok) {
      console.error('Error al limpiar contenedores antiguos:', response.statusText);
    }
    
    return response.ok;
  } catch (error) {
    console.error('Error al realizar limpieza:', error);
    return false;
  }
}

export interface DockerContainerConfig {
  image: string;
  name?: string;
  ports?: string[];
  volumes?: string[];
  envVars?: Record<string, string>;
  command?: string[];
  workdir?: string;
}

export interface ContainerInfo {
  id: string;
  name: string;
  status: string;
  image: string;
  ports?: string[];
  created?: string;
  runningTime?: string;
  systemInfo?: {
    cpu?: string;
    memory?: string;
    memoryPercentage?: string;
  };
}

export type LogLevel = 'info' | 'error' | 'warning' | 'success';

export interface LogEntry {
  timestamp: Date;
  message: string;
  level: LogLevel;
  command?: string;
  containerId?: string;
}

// Esta es la interfaz del cliente, que se comunicará con el servidor
class DockerService extends EventEmitter {
  private containerPool: Map<string, ContainerInfo> = new Map();
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;
  private defaultImage = 'codeai-execution-env:latest';
  private logs: LogEntry[] = [];
  private maxLogs = 1000;

  constructor() {
    super();
    this.initialize();
  }

  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  private addLog(log: Omit<LogEntry, 'timestamp'>): void {
    const newLog: LogEntry = {
      ...log,
      timestamp: new Date()
    };
    
    this.logs.push(newLog);
    
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }
    
    this.emit('log', newLog);
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    
    if (this.initPromise) {
      return this.initPromise;
    }

    this.addLog({
      message: 'Iniciando servicio Docker...',
      level: 'info'
    });

    this.initPromise = (async () => {
      try {
        // Llama al endpoint del servidor para inicializar Docker
        const baseUrl = getBaseUrl();
        const response = await fetch(`${baseUrl}/api/docker/initialize`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          }
        });
        
        if (!response.ok) {
          throw new Error(`Error al inicializar Docker: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        // Si el servidor creó un contenedor predeterminado, lo agregamos al pool
        if (data.container) {
          this.containerPool.set(data.container.id, data.container);
        }
        
        this.addLog({
          message: 'Servicio Docker inicializado correctamente',
          level: 'success'
        });
        
        this.isInitialized = true;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
        this.addLog({
          message: `Error al inicializar el servicio Docker: ${errorMessage}`,
          level: 'error'
        });
        console.error('Error al inicializar el servicio Docker:', error);
        throw error;
      }
    })();

    return this.initPromise;
  }

  async executeCommand(containerId: string, command: string[]): Promise<string> {
    await this.ensureInitialized();
    
    try {
      const containerInfo = this.containerPool.get(containerId);
      const containerName = containerInfo ? containerInfo.name : containerId.substring(0, 12);
      
      this.addLog({
        message: `Ejecutando comando en ${containerName}...`,
        level: 'info',
        command: command.join(' '),
        containerId
      });
      
      // Llama al endpoint del servidor para ejecutar el comando
      const baseUrl = getBaseUrl();
      const response = await fetch(`${baseUrl}/api/docker/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          containerId,
          command
        })
      });
      
      const data = await response.json();
      
      if (!response.ok || !data.success) {
        // Mostrar el error en los logs
        const errorMsg = data.stderr || data.details || data.error || 'Error desconocido';
        this.addLog({
          message: errorMsg,
          level: 'error',
          containerId
        });
        
        this.addLog({
          message: `Error al ejecutar comando en el contenedor ${containerName}`,
          level: 'error',
          containerId
        });
        
        throw new Error(errorMsg);
      }
      
      const output = data.output;
      
      this.addLog({
        message: output,
        level: 'info',
        containerId
      });
      
      this.addLog({
        message: `Comando completado exitosamente en ${containerName}`,
        level: 'success',
        containerId
      });
      
      return output;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
      this.addLog({
        message: `Error al ejecutar comando en el contenedor ${containerId}: ${errorMessage}`,
        level: 'error',
        containerId
      });
      throw error;
    }
  }

  async getAvailableContainer(config?: DockerContainerConfig): Promise<ContainerInfo> {
    await this.ensureInitialized();
    
    this.addLog({
      message: 'Buscando contenedor disponible...',
      level: 'info'
    });
    
    try {
      // Obtener todos los contenedores
      const containers = await this.getAllContainers();
      
      // Si hay más de un contenedor, realizar limpieza agresiva
      if (containers.length > 1) {
        this.addLog({
          message: `Se encontraron ${containers.length} contenedores activos. Iniciando limpieza...`,
          level: 'warning'
        });
        
        // Ordenar por fecha de creación (más reciente primero)
        containers.sort((a, b) => {
          if (!a.created || !b.created) return 0;
          return new Date(b.created).getTime() - new Date(a.created).getTime();
        });
        
        // Mantener solo el contenedor más reciente
        const latestContainer = containers[0];
        
        // Eliminar todos los contenedores excepto el más reciente
        await this.forceCleanupExceptLatest(latestContainer.id);
        
        // Si el contenedor más reciente está en ejecución, lo devolvemos
        if (latestContainer.status === 'running' && (!config || latestContainer.image === config.image)) {
          this.addLog({
            message: `Reutilizando contenedor existente: ${latestContainer.name} (${latestContainer.id.substring(0, 12)})`,
            level: 'success',
            containerId: latestContainer.id
          });
          return latestContainer;
        }
      } 
      // Si hay exactamente un contenedor y está en ejecución, lo reutilizamos
      else if (containers.length === 1 && containers[0].status === 'running' && 
              (!config || containers[0].image === config.image)) {
        this.addLog({
          message: `Reutilizando contenedor existente: ${containers[0].name} (${containers[0].id.substring(0, 12)})`,
          level: 'success',
          containerId: containers[0].id
        });
        return containers[0];
      }
      
      // Si no hay contenedores adecuados disponibles, creamos uno nuevo
      this.addLog({
        message: `Creando nuevo contenedor${config?.name ? ` con nombre ${config.name}` : ''}...`,
        level: 'info'
      });
      
      const baseUrl = getBaseUrl();
      const response = await fetch(`${baseUrl}/api/docker/container`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(config || { image: this.defaultImage })
      });
      
      if (!response.ok) {
        throw new Error(`Error al crear contenedor: ${response.statusText}`);
      }
      
      const containerInfo: ContainerInfo = await response.json();
      
      // Añadir al pool
      this.containerPool.set(containerInfo.id, containerInfo);
      
      // Si ya tenemos otros contenedores, limpiar todos excepto el nuevo
      if (containers.length > 0) {
        await this.forceCleanupExceptLatest(containerInfo.id);
      }
      
      this.addLog({
        message: `Contenedor ${containerInfo.name} (${containerInfo.id.substring(0, 12)}) creado correctamente`,
        level: 'success',
        containerId: containerInfo.id
      });
      
      return containerInfo;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
      this.addLog({
        message: `Error al crear contenedor: ${errorMessage}`,
        level: 'error'
      });
      throw error;
    }
  }

  async uploadFiles(containerId: string, files: File[]): Promise<void> {
    await this.ensureInitialized();
    
    const containerInfo = this.containerPool.get(containerId);
    const containerName = containerInfo ? containerInfo.name : containerId.substring(0, 12);
    
    this.addLog({
      message: `Subiendo ${files.length} archivos al contenedor ${containerName}...`,
      level: 'info',
      containerId
    });
    
    try {
      const formData = new FormData();
      formData.append('containerId', containerId);
      
      files.forEach(file => {
        formData.append('files', file);
      });
      
      const baseUrl = getBaseUrl();
      const response = await fetch(`${baseUrl}/api/docker/upload`, {
        method: 'POST',
        body: formData
      });
      
      if (!response.ok) {
        throw new Error(`Error al subir archivos: ${response.statusText}`);
      }
      
      this.addLog({
        message: `Archivos subidos correctamente a ${containerName}`,
        level: 'success',
        containerId
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
      this.addLog({
        message: `Error al subir archivos al contenedor ${containerName}: ${errorMessage}`,
        level: 'error',
        containerId
      });
      throw error;
    }
  }

  async getContainerStatus(containerId: string): Promise<ContainerInfo> {
    try {
      const baseUrl = getBaseUrl();
      const response = await fetch(`${baseUrl}/api/docker/status/${containerId}`);
      
      if (!response.ok) {
        throw new Error(`Error al obtener estado: ${response.statusText}`);
      }
      
      const containerInfo: ContainerInfo = await response.json();
      
      // Actualizar el pool local
      this.containerPool.set(containerInfo.id, containerInfo);
      
      return containerInfo;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
      this.addLog({
        message: `Error al obtener estado del contenedor ${containerId}: ${errorMessage}`,
        level: 'error',
        containerId
      });
      throw error;
    }
  }

  async getAllContainers(): Promise<ContainerInfo[]> {
    try {
      const baseUrl = getBaseUrl();
      const response = await fetch(`${baseUrl}/api/docker/containers`);
      
      if (!response.ok) {
        throw new Error(`Error al obtener contenedores: ${response.statusText}`);
      }
      
      const containers: ContainerInfo[] = await response.json();
      
      // Actualizar el pool local
      containers.forEach(container => {
        this.containerPool.set(container.id, container);
      });
      
      return containers;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
      this.addLog({
        message: `Error al obtener lista de contenedores: ${errorMessage}`,
        level: 'error'
      });
      throw error;
    }
  }

  async removeContainer(containerId: string): Promise<void> {
    try {
      const containerInfo = this.containerPool.get(containerId);
      if (!containerInfo) {
        throw new Error(`Contenedor ${containerId} no encontrado`);
      }
      
      const containerName = containerInfo.name;
      
      this.addLog({
        message: `Eliminando contenedor ${containerName} (${containerId.substring(0, 12)})...`,
        level: 'info',
        containerId
      });
      
      const baseUrl = getBaseUrl();
      const response = await fetch(`${baseUrl}/api/docker/container/${containerId}`, {
        method: 'DELETE'
      });
      
      if (!response.ok) {
        throw new Error(`Error al eliminar contenedor: ${response.statusText}`);
      }
      
      // Eliminar del pool
      this.containerPool.delete(containerId);
      
      this.addLog({
        message: `Contenedor ${containerName} eliminado correctamente`,
        level: 'success'
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
      this.addLog({
        message: `Error al eliminar el contenedor ${containerId}: ${errorMessage}`,
        level: 'error',
        containerId
      });
      throw error;
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }
  }

  async cleanup(): Promise<void> {
    this.addLog({
      message: 'Limpiando recursos Docker...',
      level: 'info'
    });
    
    try {
      const baseUrl = getBaseUrl();
      const response = await fetch(`${baseUrl}/api/docker/cleanup`, {
        method: 'POST'
      });
      
      if (!response.ok) {
        throw new Error(`Error al limpiar recursos: ${response.statusText}`);
      }
      
      // Limpiar el pool local
      this.containerPool.clear();
      
      this.addLog({
        message: 'Limpieza completada',
        level: 'success'
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
      this.addLog({
        message: `Error al limpiar recursos Docker: ${errorMessage}`,
        level: 'error'
      });
      throw error;
    }
  }

  async forceCleanupExceptLatest(keepContainerId: string): Promise<boolean> {
    this.addLog({
      message: `Limpiando todos los contenedores excepto ${keepContainerId.substring(0, 12)}...`,
      level: 'info'
    });
    
    try {
      // Obtener todos los contenedores
      const containers = await this.getAllContainers();
      
      // Eliminar todos los contenedores excepto el especificado
      let eliminados = 0;
      for (const container of containers) {
        if (container.id !== keepContainerId) {
          try {
            await this.removeContainer(container.id);
            eliminados++;
          } catch (error) {
            console.error(`Error al eliminar contenedor ${container.id}:`, error);
          }
        }
      }
      
      this.addLog({
        message: `Limpieza completada: ${eliminados} contenedores eliminados`,
        level: 'success'
      });
      
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
      this.addLog({
        message: `Error al limpiar contenedores: ${errorMessage}`,
        level: 'error'
      });
      return false;
    }
  }

  async uploadFilesFromDataUris(containerId: string, files: { name: string, dataUri: string }[]): Promise<string[]> {
    await this.ensureInitialized();
    
    const containerInfo = this.containerPool.get(containerId);
    const containerName = containerInfo ? containerInfo.name : containerId.substring(0, 12);
    
    this.addLog({
      message: `Subiendo ${files.length} archivos al contenedor ${containerName}...`,
      level: 'info',
      containerId
    });
    
    try {
      // Crear el directorio uploads si no existe
      await this.executeCommand(containerId, ['mkdir', '-p', '/uploads']);
      
      const uploadedPaths: string[] = [];
      
      for (const file of files) {
        try {
          // Extraer el contenido del dataUri
          const match = file.dataUri.match(/^data:([^;]+);base64,(.+)$/);
          
          if (!match) {
            throw new Error(`Formato de dataUri inválido para ${file.name}`);
          }
          
          const [, , base64Content] = match;
          
          // Crear un archivo temporal con el contenido
          const tempFilePath = `/tmp/${file.name}`;
          const targetPath = `/uploads/${file.name}`;
          
          // Guardar el contenido base64 en el archivo dentro del contenedor
          await this.executeCommand(containerId, [
            'bash', 
            '-c', 
            `echo "${base64Content}" | base64 --decode > "${tempFilePath}"`
          ]);
          
          // Mover el archivo al directorio uploads
          await this.executeCommand(containerId, [
            'mv',
            tempFilePath,
            targetPath
          ]);
          
          uploadedPaths.push(targetPath);
          
          this.addLog({
            message: `Archivo ${file.name} subido correctamente a ${targetPath}`,
            level: 'success',
            containerId
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
          this.addLog({
            message: `Error al subir archivo ${file.name}: ${errorMessage}`,
            level: 'error',
            containerId
          });
        }
      }
      
      this.addLog({
        message: `${uploadedPaths.length} de ${files.length} archivos subidos correctamente a ${containerName}`,
        level: 'success',
        containerId
      });
      
      return uploadedPaths;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
      this.addLog({
        message: `Error al subir archivos al contenedor ${containerName}: ${errorMessage}`,
        level: 'error',
        containerId
      });
      throw error;
    }
  }
}

// Singleton instance
export const dockerService = new DockerService(); 