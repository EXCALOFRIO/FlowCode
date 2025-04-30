import { execSync } from 'child_process';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    // Ahora esperamos a que se resuelva el objeto params
    const resolvedParams = await params;
    const containerId = resolvedParams.id;
    
    if (!containerId) {
      return NextResponse.json(
        { error: 'ID de contenedor no proporcionado' },
        { status: 400 }
      );
    }
    
    // Verificar que el contenedor existe
    try {
      execSync(`docker container inspect ${containerId}`, { stdio: 'pipe' });
    } catch (error) {
      return NextResponse.json(
        { error: `El contenedor ${containerId} no existe` },
        { status: 404 }
      );
    }
    
    // Detener el contenedor
    try {
      console.log(`Deteniendo contenedor: ${containerId}`);
      execSync(`docker stop ${containerId}`, { encoding: 'utf-8' });
      
      // Eliminar el contenedor
      console.log(`Eliminando contenedor: ${containerId}`);
      execSync(`docker rm ${containerId}`, { encoding: 'utf-8' });
      
      return NextResponse.json({ 
        success: true, 
        message: `Contenedor ${containerId} eliminado correctamente` 
      });
    } catch (error) {
      console.error(`Error al eliminar contenedor ${containerId}:`, error);
      const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
      
      return NextResponse.json({
        error: 'Error al eliminar el contenedor',
        details: errorMessage
      }, { status: 500 });
    }
  } catch (error) {
    console.error('Error general al eliminar contenedor Docker:', error);
    const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
    
    return NextResponse.json({
      error: 'Error al procesar la solicitud',
      details: errorMessage
    }, { status: 500 });
  }
} 