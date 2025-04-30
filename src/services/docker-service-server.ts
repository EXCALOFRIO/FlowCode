// Versión del servicio Docker específica para el servidor
import { ContainerInfo, DockerContainerConfig } from './docker-service';

class DockerServiceServer {
  private baseUrl: string = 'http://localhost:9002';

  async getAvailableContainer(config?: DockerContainerConfig): Promise<ContainerInfo> {
    try {
      const response = await fetch(`${this.baseUrl}/api/docker/containers`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      if (!response.ok) {
        throw new Error(`Error al obtener contenedores: ${response.statusText}`);
      }

      const containers = await response.json();
      
      // Si hay contenedores disponibles, usar el primero
      if (containers && containers.length > 0) {
        return containers[0];
      }

      // Si no hay contenedores, crear uno nuevo
      const createResponse = await fetch(`${this.baseUrl}/api/docker/initialize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(config || {})
      });

      if (!createResponse.ok) {
        throw new Error(`Error al crear contenedor: ${createResponse.statusText}`);
      }

      const newContainer = await createResponse.json();
      return newContainer.container;
    } catch (error) {
      console.error('Error al obtener/crear contenedor:', error);
      throw error;
    }
  }

  async executeCommand(containerId: string, command: string[]): Promise<string> {
    try {
      const response = await fetch(`${this.baseUrl}/api/docker/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          containerId,
          command
        })
      });

      if (!response.ok) {
        throw new Error(`Error al ejecutar comando: ${response.statusText}`);
      }

      const data = await response.json();
      return data.output || '';
    } catch (error) {
      console.error('Error al ejecutar comando:', error);
      throw error;
    }
  }

  async uploadFilesFromDataUris(containerId: string, files: { name: string, dataUri: string }[]): Promise<string[]> {
    try {
      console.log(`Subiendo ${files.length} archivos al contenedor ${containerId} mediante dataUris`);

      // Enviamos la solicitud como JSON con la información de dataUri
      const response = await fetch(`${this.baseUrl}/api/docker/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          containerId,
          files: files
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Error al subir archivos: ${response.status} ${response.statusText}`, errorText);
        throw new Error(`Error al subir archivos: ${response.statusText}`);
      }

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Error desconocido al subir archivos');
      }

      console.log(`${data.files?.length || 0} archivos subidos correctamente al contenedor ${containerId}`);
      
      // Devuelve las rutas de los archivos en el contenedor
      return data.files?.map((f: any) => f.containerPath) || [];
    } catch (error) {
      console.error('Error al subir archivos:', error);
      throw error;
    }
  }
}

export const dockerServiceServer = new DockerServiceServer(); 