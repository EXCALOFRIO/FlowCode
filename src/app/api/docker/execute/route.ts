import { execSync } from 'child_process';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { containerId, command } = await request.json();

    if (!containerId || !command || !Array.isArray(command)) {
      return NextResponse.json(
        { error: 'Parámetros inválidos. Se requiere containerId y un array de command' },
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

    // Ejecutar el comando
    try {
      // Primero, obtener el directorio de trabajo actual
      let workdir = '/';
      try {
        workdir = execSync(`docker exec ${containerId} pwd`, {
          encoding: 'utf-8',
          stdio: 'pipe'
        }).trim();
        console.log(`Directorio de trabajo del contenedor: ${workdir}`);
      } catch (error) {
        console.error('Error al obtener el directorio de trabajo:', error);
      }

      // Modificar los comandos de archivos si es necesario
      let modifiedCommand = [...command];
      
      // Si el comando es echo y está creando un archivo
      if (command[0] === 'echo' && command.length > 2 && command[command.length - 2] === '>') {
        // Obtenemos el nombre del archivo
        const fileName = command[command.length - 1];
        
        // Crearemos el archivo usando un método más directo
        // Primero ejecutamos el echo sin redirección
        const content = command.slice(1, command.length - 2).join(' ');
        
        // Usando echo con | tee para asegurarnos de que funcione
        modifiedCommand = ['bash', '-c', `echo ${content} > "${fileName}"`];
      }

      // Para comandos como ls y cat
      if (command[0] === 'ls' || command[0] === 'cat') {
        // Si no hay argumentos o el argumento es relativo, usamos el comando tal cual
      }

      // Para comandos como mkdir, asegurarse de que se creen correctamente
      if (command[0] === 'mkdir') {
        // Asegurarse de que el comando mkdir use -p para crear directorios padre si no existen
        if (!command.includes('-p')) {
          modifiedCommand = ['mkdir', '-p', ...command.slice(1)];
        }
      }
      
      // Escapar los argumentos del comando para evitar problemas de seguridad
      const escapedCommand = modifiedCommand.map(arg => JSON.stringify(arg)).join(' ');
      
      console.log(`Ejecutando comando en ${containerId}: ${escapedCommand}`);
      
      // Ejecutar en el directorio de trabajo del contenedor
      const output = execSync(`docker exec ${containerId} ${escapedCommand}`, {
        encoding: 'utf-8',
        maxBuffer: 1024 * 1024 * 5 // 5MB buffer para permitir salidas grandes
      });

      console.log(`Comando ejecutado exitosamente en ${containerId}: ${command.join(' ')}`);
      return NextResponse.json({ 
        success: true, 
        output: output.trim() 
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
      const stderr = error instanceof Error && 'stderr' in error 
        ? (error as any).stderr?.toString() 
        : 'Salida de error no disponible';
        
      console.error(`Error al ejecutar comando en ${containerId}:`, errorMessage);
      
      // Devolver los detalles del error en lugar de un error 500
      // Esto permite que el cliente muestre el error completo
      return NextResponse.json({ 
        success: false,
        error: 'Error al ejecutar comando', 
        details: errorMessage,
        stderr,
        output: stderr || errorMessage, // Incluir la salida de error como output
      });
    }
  } catch (error) {
    console.error('Error general al ejecutar comando Docker:', error);
    return NextResponse.json(
      { 
        success: false,
        error: 'Error al procesar la solicitud',
        details: error instanceof Error ? error.message : 'Error desconocido',
      }
    );
  }
} 