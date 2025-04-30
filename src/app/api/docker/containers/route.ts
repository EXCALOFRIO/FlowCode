import { execSync } from 'child_process';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    // Obtener la lista de contenedores con formato específico
    const containerListCmd = 'docker ps -a --format "{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.CreatedAt}}"';
    
    try {
      const output = execSync(containerListCmd, { encoding: 'utf-8' });
      const containers = output.trim().split('\n')
        .filter(line => line.trim() !== '')
        .map(line => {
          const [id, name, image, status, created] = line.split('|');
          
          // Extraer información sobre el estado (running, exited, etc.)
          let statusText = 'unknown';
          if (status.includes('Up')) {
            statusText = 'running';
          } else if (status.includes('Exited')) {
            statusText = 'exited';
          } else if (status.includes('Created')) {
            statusText = 'created';
          }
          
          return {
            id,
            name,
            image,
            status: statusText,
            rawStatus: status,
            created
          };
        });
      
      // Filtrar solo los contenedores relacionados con nuestra aplicación
      const appContainers = containers.filter(container => 
        container.name.includes('codeai') || 
        container.image.includes('codeai')
      );
      
      return NextResponse.json(appContainers);
    } catch (error) {
      console.error('Error al obtener lista de contenedores:', error);
      const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
      
      return NextResponse.json({
        error: 'Error al obtener lista de contenedores',
        details: errorMessage
      }, { status: 500 });
    }
  } catch (error) {
    console.error('Error general al obtener contenedores Docker:', error);
    const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
    
    return NextResponse.json({
      error: 'Error al procesar la solicitud',
      details: errorMessage
    }, { status: 500 });
  }
} 