import { execSync } from 'child_process';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    // Verificar que Docker esté instalado y funcionando
    try {
      execSync('docker --version', { stdio: 'pipe' });
    } catch (error) {
      console.error('Error al verificar Docker:', error);
      return NextResponse.json(
        { error: 'Docker no está instalado o no está en ejecución' },
        { status: 500 }
      );
    }

    // Limpiar todos los contenedores existentes al inicio
    try {
      console.log('Eliminando todos los contenedores existentes...');
      
      // Obtener todos los contenedores asociados con nuestra aplicación
      const containerListCmd = 'docker ps -a --format "{{.ID}}|{{.Names}}|{{.Image}}"';
      const output = execSync(containerListCmd, { encoding: 'utf-8' });
      
      const containers = output.trim().split('\n')
        .filter(line => line.trim() !== '')
        .map(line => {
          const [id, name, image] = line.split('|');
          return { id, name, image };
        })
        .filter(container => 
          container.name.includes('codeai') || 
          container.image.includes('codeai')
        );
      
      if (containers.length > 0) {
        console.log(`Se encontraron ${containers.length} contenedores para eliminar`);
        
        // Agrupar los IDs para eliminarlos todos de una vez (más rápido)
        const containerIds = containers.map(c => c.id).join(' ');
        
        // Detener todos los contenedores con un solo comando
        if (containerIds) {
          try {
            console.log('Deteniendo todos los contenedores...');
            execSync(`docker stop ${containerIds}`, { stdio: 'pipe' });
          } catch (error) {
            console.warn('Error al detener algunos contenedores:', error);
          }
          
          // Eliminar todos los contenedores con un solo comando
          try {
            console.log('Eliminando todos los contenedores...');
            execSync(`docker rm ${containerIds}`, { stdio: 'pipe' });
          } catch (error) {
            console.warn('Error al eliminar algunos contenedores:', error);
          }
        }
      } else {
        console.log('No se encontraron contenedores para eliminar');
      }
    } catch (error) {
      console.warn('Error al limpiar contenedores:', error);
      // Continuamos aunque haya error en la limpieza
    }

    // Crear la imagen personalizada si no existe
    try {
      const images = execSync('docker images -q codeai-execution-env:latest', { encoding: 'utf-8' });
      
      if (!images.trim()) {
        console.log('Creando imagen Docker personalizada...');
        
        // Verificar si existe el Dockerfile en la raíz del proyecto
        try {
          execSync('test -f Dockerfile', { stdio: 'pipe' });
        } catch (error) {
          // El Dockerfile no existe, crearlo
          const dockerfileContent = `FROM node:20-slim

# Instalar Python y dependencias comunes
RUN apt-get update && apt-get install -y --no-install-recommends \\
    python3 \\
    python3-pip \\
    python3-setuptools \\
    python3-wheel \\
    git \\
    curl \\
    && rm -rf /var/lib/apt/lists/*

# Crear dirección para archivos cargados
RUN mkdir -p /app/uploads

# Instalar dependencias de Python comunes
RUN pip3 install --no-cache-dir \\
    numpy \\
    pandas \\
    matplotlib \\
    scikit-learn \\
    tensorflow

# Configurar el directorio de trabajo
WORKDIR /app

# Mantener el contenedor en ejecución
CMD ["tail", "-f", "/dev/null"]`;

          require('fs').writeFileSync('Dockerfile', dockerfileContent);
        }
        
        // Construir la imagen
        execSync('docker build -t codeai-execution-env:latest .', { stdio: 'inherit' });
      }
    } catch (error) {
      console.error('Error al crear imagen Docker:', error);
      return NextResponse.json(
        { error: 'No se pudo crear la imagen Docker' },
        { status: 500 }
      );
    }

    // Crear un contenedor predeterminado
    try {
      const containerName = `codeai-container-${Date.now()}`;
      
      // Crear el contenedor
      const containerId = execSync(
        `docker run -d --name ${containerName} codeai-execution-env:latest`,
        { encoding: 'utf-8' }
      ).trim();
      
      // Ejecutar comandos de prueba en el contenedor para verificar que funciona
      const pythonVersion = execSync(
        `docker exec ${containerId} python3 --version`,
        { encoding: 'utf-8' }
      ).trim();
      
      const nodeVersion = execSync(
        `docker exec ${containerId} node --version`,
        { encoding: 'utf-8' }
      ).trim();
      
      console.log(`Contenedor Docker inicializado: ${containerId}`);
      console.log(`Python version: ${pythonVersion}`);
      console.log(`Node version: ${nodeVersion}`);
      
      // Obtener información del contenedor
      const containerInfo = {
        id: containerId,
        name: containerName,
        status: 'running',
        image: 'codeai-execution-env:latest',
        created: new Date().toISOString()
      };
      
      return NextResponse.json({ 
        success: true, 
        message: 'Docker inicializado correctamente',
        container: containerInfo,
        systemInfo: {
          python: pythonVersion,
          node: nodeVersion
        }
      });
    } catch (error) {
      console.error('Error al crear contenedor Docker:', error);
      return NextResponse.json(
        { error: 'No se pudo crear el contenedor Docker' },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Error general al inicializar Docker:', error);
    return NextResponse.json(
      { error: 'Error al inicializar Docker' },
      { status: 500 }
    );
  }
} 