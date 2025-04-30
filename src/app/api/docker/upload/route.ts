import { execSync } from 'child_process';
import { NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { v4 as uuidv4 } from 'uuid';

// Esta función maneja la subida de archivos al contenedor
export async function POST(request: Request) {
  try {
    // Verificar el Content-Type para determinar cómo procesar la solicitud
    const contentType = request.headers.get('Content-Type') || '';
    
    let containerId: string;
    let fileInfos: Array<{
      originalName: string;
      tempPath: string;
      size: number;
    }> = [];
    
    // Procesar según el tipo de contenido
    if (contentType.includes('multipart/form-data')) {
      // Procesar como FormData (archivos subidos desde el navegador)
      try {
        const formData = await request.formData();
        containerId = formData.get('containerId') as string;
        
        if (!containerId) {
          return NextResponse.json(
            { error: 'ID de contenedor no proporcionado' },
            { status: 400 }
          );
        }
        
        // Obtener los archivos del formulario
        const files = formData.getAll('files') as File[];
        
        if (!files || files.length === 0) {
          return NextResponse.json(
            { error: 'No se proporcionaron archivos' },
            { status: 400 }
          );
        }
        
        console.log(`Subiendo ${files.length} archivos al contenedor ${containerId} vía FormData`);
        
        // Crear un directorio temporal para almacenar los archivos
        const tempDirId = uuidv4();
        const tempDir = join(tmpdir(), `docker-upload-${tempDirId}`);
        await mkdir(tempDir, { recursive: true });
        
        // Guardar los archivos en el directorio temporal
        fileInfos = await Promise.all(
          files.map(async (file) => {
            const filename = file.name;
            const buffer = Buffer.from(await file.arrayBuffer());
            const filepath = join(tempDir, filename);
            
            await writeFile(filepath, buffer);
            
            return {
              originalName: filename,
              tempPath: filepath,
              size: file.size
            };
          })
        );
      } catch (error) {
        console.error('Error al procesar FormData:', error);
        return NextResponse.json(
          { 
            error: 'Error al procesar FormData', 
            details: error instanceof Error ? error.message : 'Error desconocido' 
          },
          { status: 400 }
        );
      }
    } else if (contentType.includes('application/json')) {
      // Procesar como JSON (dataUri desde el servidor)
      try {
        const jsonData = await request.json();
        containerId = jsonData.containerId;
        
        if (!containerId) {
          return NextResponse.json(
            { error: 'ID de contenedor no proporcionado' },
            { status: 400 }
          );
        }
        
        // Verificar si se incluye un solo archivo o un array de archivos
        const files = Array.isArray(jsonData.files) ? jsonData.files : 
                      jsonData.fileName && jsonData.dataUri ? [{ name: jsonData.fileName, dataUri: jsonData.dataUri }] : [];
        
        if (files.length === 0) {
          return NextResponse.json(
            { error: 'No se proporcionaron archivos en el formato correcto' },
            { status: 400 }
          );
        }
        
        console.log(`Subiendo ${files.length} archivos al contenedor ${containerId} vía JSON/dataUri`);
        
        // Crear un directorio temporal para almacenar los archivos
        const tempDirId = uuidv4();
        const tempDir = join(tmpdir(), `docker-upload-${tempDirId}`);
        await mkdir(tempDir, { recursive: true });
        
        // Procesar cada archivo dataUri
        fileInfos = await Promise.all(
          files.map(async (file: { name: string, dataUri: string }) => {
            const filename = file.name;
            const dataUri = file.dataUri;
            
            // Extraer el contenido base64 del dataUri
            const match = dataUri.match(/^data:([^;]+);base64,(.+)$/);
            if (!match) {
              throw new Error(`Formato de dataUri inválido para ${filename}`);
            }
            
            const base64Content = match[2];
            const buffer = Buffer.from(base64Content, 'base64');
            const filepath = join(tempDir, filename);
            
            await writeFile(filepath, buffer);
            
            return {
              originalName: filename,
              tempPath: filepath,
              size: buffer.length
            };
          })
        );
      } catch (error) {
        console.error('Error al procesar JSON/dataUri:', error);
        return NextResponse.json(
          { 
            error: 'Error al procesar JSON/dataUri', 
            details: error instanceof Error ? error.message : 'Error desconocido' 
          },
          { status: 400 }
        );
      }
    } else {
      return NextResponse.json(
        { error: 'Content-Type no soportado. Debe ser multipart/form-data o application/json' },
        { status: 415 }
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
    
    // Crear el directorio de destino en el contenedor Docker
    const targetDir = '/uploads';
    try {
      execSync(`docker exec ${containerId} mkdir -p ${targetDir}`, { stdio: 'pipe' });
    } catch (error) {
      console.error(`Error al crear directorio en contenedor: ${error}`);
      return NextResponse.json(
        { error: 'Error al crear directorio en el contenedor' },
        { status: 500 }
      );
    }
    
    // Copiar archivos al contenedor
    const uploadedFiles = [];
    
    for (const fileInfo of fileInfos) {
      try {
        // Copiar el archivo al contenedor
        execSync(
          `docker cp "${fileInfo.tempPath}" "${containerId}:${targetDir}/${fileInfo.originalName}"`,
          { stdio: 'pipe' }
        );
        
        uploadedFiles.push({
          name: fileInfo.originalName,
          containerPath: `${targetDir}/${fileInfo.originalName}`,
          size: fileInfo.size
        });
        
        console.log(`Archivo "${fileInfo.originalName}" copiado al contenedor ${containerId}`);
      } catch (error) {
        console.error(`Error al copiar archivo ${fileInfo.originalName} al contenedor:`, error);
        const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
        
        return NextResponse.json({
          error: `Error al copiar archivo ${fileInfo.originalName}`,
          details: errorMessage
        }, { status: 500 });
      }
    }
    
    // Listar los archivos en el directorio para verificar
    try {
      const lsOutput = execSync(
        `docker exec ${containerId} ls -la ${targetDir}`,
        { encoding: 'utf-8' }
      );
      
      console.log(`Contenido del directorio ${targetDir} en el contenedor:`);
      console.log(lsOutput);
    } catch (error) {
      console.warn(`Error al listar archivos en el contenedor:`, error);
      // No fallamos la operación por esto
    }
    
    return NextResponse.json({
      success: true,
      message: `${uploadedFiles.length} archivos subidos al contenedor`,
      files: uploadedFiles,
      containerId,
      targetDirectory: targetDir
    });
    
  } catch (error) {
    console.error('Error general al subir archivos al contenedor Docker:', error);
    const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
    
    return NextResponse.json({
      error: 'Error al procesar la solicitud de subida de archivos',
      details: errorMessage
    }, { status: 500 });
  }
} 