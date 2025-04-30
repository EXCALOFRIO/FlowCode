import { execSync } from 'child_process';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    // Obtener el ID del contenedor que queremos mantener
    const body = await request.json();
    const keepContainerId = body.keepContainerId;
    
    if (!keepContainerId) {
      return NextResponse.json({
        error: 'Se requiere especificar el ID del contenedor a mantener'
      }, { status: 400 });
    }
    
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
        (container.name.includes('codeai') || 
        container.image.includes('codeai')) &&
        container.id !== keepContainerId
      );
    
    console.log(`Se encontraron ${containers.length} contenedores para limpiar (manteniendo ${keepContainerId})`);
    
    if (containers.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No hay contenedores para eliminar"
      });
    }
    
    // Método más eficiente: eliminar todos los contenedores en un solo comando
    try {
      // Recopilar todos los IDs de contenedores
      const containerIds = containers.map(container => container.id).join(' ');
      
      // Detener todos los contenedores con un solo comando
      console.log(`Deteniendo ${containers.length} contenedores...`);
      execSync(`docker stop ${containerIds}`, { stdio: 'pipe' });
      
      // Eliminar todos los contenedores con un solo comando
      console.log(`Eliminando ${containers.length} contenedores...`);
      execSync(`docker rm ${containerIds}`, { stdio: 'pipe' });
      
      const results = containers.map(container => ({
        id: container.id,
        name: container.name,
        status: 'removed'
      }));
      
      return NextResponse.json({
        success: true,
        message: `${results.length} contenedores eliminados (manteniendo ${keepContainerId.substring(0, 12)})`,
        results
      });
    } catch (error) {
      console.error('Error al eliminar contenedores en lote:', error);
      const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
      
      // Si falla el método en lote, intentamos el método secuencial como respaldo
      console.log('Intentando eliminar contenedores individualmente...');
      
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
        message: `${results.filter(r => r.status === 'removed').length} contenedores eliminados (manteniendo ${keepContainerId.substring(0, 12)})`,
        results,
        warning: `El método en lote falló: ${errorMessage}`
      });
    }
  } catch (error) {
    console.error('Error general al limpiar recursos Docker:', error);
    const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
    
    return NextResponse.json({
      error: 'Error al limpiar recursos Docker',
      details: errorMessage
    }, { status: 500 });
  }
} 