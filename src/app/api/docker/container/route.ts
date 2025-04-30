import { execSync } from 'child_process';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const config = await request.json();
    
    // Valores predeterminados
    const image = config.image || 'codeai-execution-env:latest';
    const name = config.name || `codeai-container-${Date.now()}`;
    
    // Construir el comando para crear el contenedor
    let dockerRunCmd = `docker run -d --name ${name}`;
    
    // Añadir puertos si se especifican
    if (config.ports && Array.isArray(config.ports) && config.ports.length > 0) {
      config.ports.forEach((port: string) => {
        dockerRunCmd += ` -p ${port}`;
      });
    }
    
    // Añadir variables de entorno si se especifican
    if (config.envVars && typeof config.envVars === 'object') {
      Object.entries(config.envVars).forEach(([key, value]) => {
        dockerRunCmd += ` -e ${key}=${value}`;
      });
    }
    
    // Añadir volúmenes si se especifican
    if (config.volumes && Array.isArray(config.volumes) && config.volumes.length > 0) {
      config.volumes.forEach((volume: string) => {
        dockerRunCmd += ` -v ${volume}`;
      });
    }
    
    // Añadir directorio de trabajo si se especifica
    if (config.workdir) {
      dockerRunCmd += ` -w ${config.workdir}`;
    }
    
    // Añadir la imagen
    dockerRunCmd += ` ${image}`;
    
    // Añadir comando personalizado si se especifica
    if (config.command && Array.isArray(config.command) && config.command.length > 0) {
      dockerRunCmd += ` ${config.command.join(' ')}`;
    }
    
    console.log(`Creando contenedor: ${dockerRunCmd}`);
    
    try {
      // Ejecutar el comando para crear el contenedor
      const containerId = execSync(dockerRunCmd, { encoding: 'utf-8' }).trim();
      
      // Ejecutar comandos de prueba en el contenedor
      console.log(`Contenedor creado con ID: ${containerId}`);
      
      // Ejecutar algunos comandos de prueba para verificar que funciona
      const checkCommands = [
        { cmd: 'python3 --version', label: 'Python version' },
        { cmd: 'node --version', label: 'Node version' },
        { cmd: 'ls -la /app', label: 'App directory' },
        { cmd: 'cat /etc/os-release', label: 'OS info' }
      ];
      
      const testResults: Record<string, string> = {};
      
      for (const { cmd, label } of checkCommands) {
        try {
          const output = execSync(`docker exec ${containerId} ${cmd}`, { encoding: 'utf-8' }).trim();
          testResults[label] = output;
          console.log(`${label}: ${output}`);
        } catch (error) {
          console.warn(`Error al ejecutar ${cmd}:`, error);
          if (error instanceof Error) {
            testResults[label] = `Error: ${error.message}`;
          } else {
            testResults[label] = 'Error desconocido';
          }
        }
      }
      
      // Crear directorios importantes en el contenedor
      try {
        execSync(`docker exec ${containerId} mkdir -p /app/uploads`, { stdio: 'pipe' });
      } catch (error) {
        console.warn('Error al crear directorios en el contenedor:', error);
      }
      
      // Obtener información detallada del contenedor
      const inspectOutput = JSON.parse(
        execSync(`docker container inspect ${containerId}`, { encoding: 'utf-8' })
      )[0];
      
      const containerInfo = {
        id: containerId,
        name: name,
        status: 'running',
        image: image,
        created: new Date().toISOString(),
        ports: config.ports || [],
      };
      
      return NextResponse.json(containerInfo);
    } catch (error) {
      console.error('Error al crear el contenedor:', error);
      const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
      return NextResponse.json(
        { error: 'No se pudo crear el contenedor Docker', details: errorMessage },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Error general al crear contenedor Docker:', error);
    const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
    return NextResponse.json(
      { error: 'Error al procesar la solicitud', details: errorMessage },
      { status: 500 }
    );
  }
} 