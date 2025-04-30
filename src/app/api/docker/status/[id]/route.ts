import { execSync } from 'child_process';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
    
    try {
      // Obtener información del contenedor
      const inspectOutput = JSON.parse(
        execSync(`docker container inspect ${containerId}`, { encoding: 'utf-8' })
      )[0];
      
      // Extraer información relevante
      const name = inspectOutput.Name.replace(/^\//, '');
      const image = inspectOutput.Config.Image;
      const status = inspectOutput.State.Status;
      const created = inspectOutput.Created;
      
      // Obtener información sobre el tiempo de ejecución
      let runningTime = "";
      if (status === "running") {
        try {
          const stats = execSync(`docker stats ${containerId} --no-stream --format "{{.CPUPerc}},{{.MemUsage}},{{.MemPerc}}"`, 
            { encoding: 'utf-8' }
          ).trim().split(',');
          
          // Obtener información sobre los puertos expuestos
          const ports: string[] = [];
          if (inspectOutput.NetworkSettings && inspectOutput.NetworkSettings.Ports) {
            Object.entries(inspectOutput.NetworkSettings.Ports).forEach(([containerPort, hostBindings]: [string, any]) => {
              if (hostBindings) {
                hostBindings.forEach((binding: any) => {
                  ports.push(`${binding.HostPort}:${containerPort}`);
                });
              }
            });
          }
          
          // Calcular el tiempo de ejecución
          const startTime = new Date(inspectOutput.State.StartedAt);
          const now = new Date();
          const runningTimeMs = now.getTime() - startTime.getTime();
          const runningTimeSec = Math.floor(runningTimeMs / 1000);
          
          const hours = Math.floor(runningTimeSec / 3600);
          const minutes = Math.floor((runningTimeSec % 3600) / 60);
          const seconds = runningTimeSec % 60;
          
          runningTime = `${hours}h ${minutes}m ${seconds}s`;
          
          // Información del sistema
          const systemInfo = {
            cpu: stats[0],
            memory: stats[1],
            memoryPercentage: stats[2]
          };
          
          return NextResponse.json({
            id: containerId,
            name,
            status,
            image,
            created,
            runningTime,
            ports,
            systemInfo
          });
        } catch (error) {
          console.warn(`Error al obtener estadísticas para ${containerId}:`, error);
          // Continuar sin estadísticas
        }
      }
      
      // Si no obtuvimos estadísticas o el contenedor no está en ejecución
      return NextResponse.json({
        id: containerId,
        name,
        status,
        image,
        created,
        runningTime
      });
      
    } catch (error) {
      console.error(`Error al obtener información del contenedor ${containerId}:`, error);
      const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
      
      // Si el error es porque el contenedor no existe
      if (errorMessage.includes('No such container')) {
        return NextResponse.json(
          { error: `El contenedor ${containerId} no existe` },
          { status: 404 }
        );
      }
      
      return NextResponse.json({
        error: 'Error al obtener información del contenedor',
        details: errorMessage
      }, { status: 500 });
    }
  } catch (error) {
    console.error('Error general al obtener estado del contenedor:', error);
    const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
    
    return NextResponse.json({
      error: 'Error al procesar la solicitud',
      details: errorMessage
    }, { status: 500 });
  }
} 