import { execSync } from 'child_process';
import { NextResponse } from 'next/server';

export async function POST() {
  try {
    // Obtener la lista de contenedores relacionados con nuestra aplicación
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
    
    console.log(`Se encontraron ${containers.length} contenedores para limpiar`);
    
    // Detener y eliminar cada contenedor
    const results = [];
    
    for (const container of containers) {
      try {
        console.log(`Deteniendo contenedor ${container.name} (${container.id})...`);
        execSync(`docker stop ${container.id}`, { stdio: 'pipe' });
        
        console.log(`Eliminando contenedor ${container.name} (${container.id})...`);
        execSync(`docker rm ${container.id}`, { stdio: 'pipe' });
        
        results.push({
          id: container.id,
          name: container.name,
          status: 'removed'
        });
      } catch (error) {
        console.warn(`Error al eliminar contenedor ${container.id}:`, error);
        const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
        
        results.push({
          id: container.id,
          name: container.name,
          status: 'error',
          error: errorMessage
        });
      }
    }
    
    return NextResponse.json({
      success: true,
      message: `${results.filter(r => r.status === 'removed').length} contenedores eliminados`,
      results
    });
  } catch (error) {
    console.error('Error general al limpiar recursos Docker:', error);
    const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
    
    return NextResponse.json({
      error: 'Error al limpiar recursos Docker',
      details: errorMessage
    }, { status: 500 });
  }
} 