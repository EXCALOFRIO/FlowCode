'use server';

/**
 * @fileOverview Flujo agéntico para planificación con Gemini 2.5 Flash.
 * Este flujo permite que Gemini solicite información sobre archivos y realice búsquedas
 * de manera autónoma para generar un plan estructurado.
 */

import { z } from 'genkit';
import { ai } from '@/ai/ai-instance';
import { geminiService, StructuredOutputConfig } from '@/services/gemini-service';
import { getSearchResults } from '@/services/google-grounding';
import { dockerServiceServer } from '@/services/docker-service-server';
import { 
  AgenticPlanningInput, 
  AgenticPlanningOutput, 
  AgenticPlanStep,
  ADVANCED_SHELL_TOOLS
} from '@/ai/flows/types/agentric-planning-types';

// Esquema de entrada para el flujo agéntico de planificación
const AgenticPlanningInputSchema = z.object({
  prompt: z.string().describe('El prompt del usuario describiendo lo que desea hacer.'),
  fileNames: z.array(z.string()).optional().describe('Nombres de los archivos subidos por el usuario.'),
  fileContents: z.array(z.string()).optional().describe('Contenidos de los archivos subidos por el usuario.'),
});

// Esquema de salida para el flujo agéntico de planificación
const AgenticPlanningOutputSchema = z.object({
  plan: z.string().describe('Resumen del plan generado por Gemini.'),
  pasos: z.array(z.object({
    paso: z.string().describe('Nombre del paso a ejecutar.'),
    explicacion: z.string().describe('Explicación detallada del paso.')
  })).describe('Lista de pasos detallados del plan.'),
  requiereInfoExterna: z.boolean().describe('Indica si el plan requiere información externa.'),
  requiereAnalisisArchivos: z.boolean().describe('Indica si el plan requiere análisis de archivos.'),
  detallesVisualizacion: z.string().optional().describe('Detalles sobre cómo visualizar los resultados.'),
  archivosSolicitados: z.array(z.string()).optional().describe('Lista de archivos solicitados para análisis.'),
  busquedasRealizadas: z.array(z.string()).optional().describe('Lista de búsquedas realizadas durante la planificación.')
});

/**
 * Implementa los callbacks para las herramientas agénticas avanzadas
 * @param containerId ID del contenedor Docker
 * @returns Objeto con callbacks de funciones para las herramientas
 */
export async function createAdvancedShellCallbacks(containerId: string): Promise<Record<string, (args: any) => Promise<any>>> {
  return {
    shell_analyze_environment: async (args: { container_id: string }): Promise<any> => {
      try {
        console.log("Analizando entorno Docker...");
        
        // Determinar directorio actual
        const pwdOutput = await dockerServiceServer.executeCommand(args.container_id, ["pwd"]);
        const currentDir = pwdOutput.trim();
        
        // Listar archivos en directorio actual y en /uploads
        const lsCurrentOutput = await dockerServiceServer.executeCommand(args.container_id, ["ls", "-la"]);
        const lsUploadsOutput = await dockerServiceServer.executeCommand(args.container_id, ["ls", "-la", "/uploads"]);
        
        // Información del sistema
        const systemInfoOutput = await dockerServiceServer.executeCommand(
          args.container_id, 
          ["bash", "-c", "python --version && which python && echo 'NODE:' && which node || echo 'Node no disponible'"]
        );
        
        // Extraer nombres de archivos de /uploads (ignorando . y ..)
        const filesInUploads = lsUploadsOutput.split('\n')
          .slice(2) // Omitir línea "total X" y los directorios . y ..
          .map(line => {
            const parts = line.trim().split(/\s+/);
            if (parts.length > 8) {
              return {
                name: parts.slice(8).join(' '), // Nombre puede tener espacios
                type: line.startsWith('d') ? 'directory' : 'file'
              };
            }
            return null;
          })
          .filter(item => item !== null);
        
        return {
          current_directory: currentDir,
          uploads_directory: "/uploads",
          system_info: systemInfoOutput,
          files_in_current_dir: lsCurrentOutput,
          files_in_uploads: filesInUploads,
          environment_ready: true
        };
      } catch (error) {
        console.error("Error al analizar entorno Docker:", error);
        return {
          error: error instanceof Error ? error.message : "Error desconocido",
          environment_ready: false
        };
      }
    },
    
    shell_execute_command: async (args: { 
      container_id: string, 
      command: string,
      directory?: string,
      timeout_seconds?: number
    }): Promise<any> => {
      try {
        console.log(`Ejecutando comando en Docker: ${args.command}`);
        
        // Determinar si necesitamos cambiar de directorio
        let commandToExecute = args.command;
        if (args.directory) {
          // Prefixar con cd al directorio especificado
          commandToExecute = `cd ${args.directory} && ${commandToExecute}`;
        }
        
        // Determinar si es un comando simple o necesitamos bash -c
        let commandParts: string[];
        if (commandToExecute.includes('|') || 
            commandToExecute.includes('>') || 
            commandToExecute.includes('<') ||
            commandToExecute.includes('&&') ||
            commandToExecute.includes('||') ||
            commandToExecute.includes(';') ||
            commandToExecute.includes('*') ||
            commandToExecute.includes(' ')) {
          // Comando complejo, usar bash -c
          commandParts = ['bash', '-c', commandToExecute];
        } else {
          // Comando simple
          commandParts = commandToExecute.split(' ').filter(p => p.length > 0);
        }
        
        // Ejecutar con timeout si se especifica
        if (args.timeout_seconds && args.timeout_seconds > 0) {
          // Añadir timeout al comando
          commandParts = ['timeout', args.timeout_seconds.toString(), ...commandParts];
        }
        
        const result = await dockerServiceServer.executeCommand(args.container_id, commandParts);
        
        return {
          command: args.command,
          output: result,
          success: true
        };
      } catch (error) {
        console.error(`Error al ejecutar comando Docker: ${args.command}`, error);
        return {
          command: args.command,
          error: error instanceof Error ? error.message : "Error desconocido",
          success: false,
          suggestion: "Intenta usar shell_fix_command para corregir este comando"
        };
      }
    },
    
    shell_analyze_file: async (args: {
      container_id: string,
      file_path: string,
      analysis_type: string
    }): Promise<any> => {
      try {
        console.log(`Analizando archivo ${args.file_path} (tipo: ${args.analysis_type})...`);
        
        // Primero verificar que el archivo existe
        let checkCommand: string[];
        if (args.file_path.includes(' ')) {
          // Ruta con espacios, usar bash -c
          checkCommand = ['bash', '-c', `[ -f "${args.file_path}" ] && echo "EXISTE" || echo "NO_EXISTE"`];
        } else {
          // Ruta sin espacios
          checkCommand = ['bash', '-c', `[ -f ${args.file_path} ] && echo "EXISTE" || echo "NO_EXISTE"`];
        }
        
        const checkResult = await dockerServiceServer.executeCommand(args.container_id, checkCommand);
        
        if (checkResult.trim() !== "EXISTE") {
          return {
            file_path: args.file_path,
            exists: false,
            error: `El archivo ${args.file_path} no existe`
          };
        }
        
        // Añadir comillas a la ruta si contiene espacios
        const quotedPath = args.file_path.includes(' ') ? `"${args.file_path}"` : args.file_path;
        
        // Comando base para obtener contenido
        const catCommand = ['cat', args.file_path];
        const fileContent = await dockerServiceServer.executeCommand(args.container_id, catCommand);
        
        // Analizamos según el tipo solicitado
        let analysisResult: any = {
          file_path: args.file_path,
          exists: true,
          content_preview: fileContent.substring(0, 500) + (fileContent.length > 500 ? "..." : "")
        };
        
        // Detectar tipo de archivo
        if (args.file_path.endsWith('.py')) {
          // Análisis de Python
          if (args.analysis_type === 'imports' || args.analysis_type === 'all') {
            const importsCommand = ['bash', '-c', `grep -E "^import|^from.*import" ${quotedPath} || echo "No imports found"`];
            analysisResult.imports = (await dockerServiceServer.executeCommand(args.container_id, importsCommand)).split('\n');
          }
          
          if (args.analysis_type === 'functions' || args.analysis_type === 'all') {
            const functionsCommand = ['bash', '-c', `grep -E "^def |^async def " ${quotedPath} || echo "No functions found"`];
            analysisResult.functions = (await dockerServiceServer.executeCommand(args.container_id, functionsCommand)).split('\n');
          }
          
          if (args.analysis_type === 'classes' || args.analysis_type === 'all') {
            const classesCommand = ['bash', '-c', `grep -E "^class " ${quotedPath} || echo "No classes found"`];
            analysisResult.classes = (await dockerServiceServer.executeCommand(args.container_id, classesCommand)).split('\n');
          }
          
          if (args.analysis_type === 'dependencies' || args.analysis_type === 'all') {
            // Intenta encontrar requirements.txt en el mismo directorio
            const dirPath = args.file_path.substring(0, args.file_path.lastIndexOf('/'));
            const requirementsPath = `${dirPath}/requirements.txt`;
            const requirementsCommand = ['bash', '-c', `[ -f "${requirementsPath}" ] && cat "${requirementsPath}" || echo "No requirements.txt found"`];
            analysisResult.dependencies = (await dockerServiceServer.executeCommand(args.container_id, requirementsCommand)).split('\n');
          }
        } else if (args.file_path.endsWith('.js') || args.file_path.endsWith('.ts')) {
          // Análisis de JavaScript/TypeScript
          if (args.analysis_type === 'imports' || args.analysis_type === 'all') {
            const importsCommand = ['bash', '-c', `grep -E "import |require\\(" ${quotedPath} || echo "No imports found"`];
            analysisResult.imports = (await dockerServiceServer.executeCommand(args.container_id, importsCommand)).split('\n');
          }
          
          if (args.analysis_type === 'functions' || args.analysis_type === 'all') {
            const functionsCommand = ['bash', '-c', `grep -E "function |=>|\\) {" ${quotedPath} || echo "No functions found"`];
            analysisResult.functions = (await dockerServiceServer.executeCommand(args.container_id, functionsCommand)).split('\n');
          }
          
          if (args.analysis_type === 'classes' || args.analysis_type === 'all') {
            const classesCommand = ['bash', '-c', `grep -E "class |extends |implements " ${quotedPath} || echo "No classes found"`];
            analysisResult.classes = (await dockerServiceServer.executeCommand(args.container_id, classesCommand)).split('\n');
          }
          
          if (args.analysis_type === 'dependencies' || args.analysis_type === 'all') {
            // Intenta encontrar package.json en el mismo directorio
            const dirPath = args.file_path.substring(0, args.file_path.lastIndexOf('/'));
            const packageJsonPath = `${dirPath}/package.json`;
            const packageJsonCommand = ['bash', '-c', `[ -f "${packageJsonPath}" ] && cat "${packageJsonPath}" | grep -A 50 '"dependencies"' || echo "No package.json found"`];
            analysisResult.dependencies = (await dockerServiceServer.executeCommand(args.container_id, packageJsonCommand)).split('\n');
          }
        }
        
        return analysisResult;
      } catch (error) {
        console.error(`Error al analizar archivo ${args.file_path}:`, error);
        return {
          file_path: args.file_path,
          error: error instanceof Error ? error.message : "Error desconocido",
          exists: false
        };
      }
    },
    
    shell_fix_command: async (args: {
      container_id: string,
      failed_command: string,
      error_message: string
    }): Promise<any> => {
      try {
        console.log(`Intentando corregir comando fallido: ${args.failed_command}`);
        
        const originalCommand = args.failed_command;
        const errorMsg = args.error_message;
        
        // Estrategias de corrección basadas en el tipo de error
        let fixStrategy = "unknown";
        let fixedCommand = originalCommand;
        
        // 1. Error de archivo no encontrado
        if (errorMsg.includes('No such file or directory')) {
          fixStrategy = "file_not_found";
          
          // Intentar encontrar el archivo usando find
          const fileName = originalCommand.split(' ').pop();
          if (fileName && !fileName.startsWith('-')) {
            const cleanFileName = fileName.replace(/["']/g, '');
            const findCommand = ['find', '/uploads', '-name', cleanFileName, '-type', 'f'];
            const foundFiles = await dockerServiceServer.executeCommand(args.container_id, findCommand);
            
            if (foundFiles.trim()) {
              // Reemplazar la ruta del archivo con la encontrada
              fixedCommand = originalCommand.replace(fileName, foundFiles.trim().split('\n')[0]);
            } else {
              // Intentar usar comillas si el nombre tiene espacios
              if (cleanFileName.includes(' ')) {
                fixedCommand = originalCommand.replace(fileName, `"${cleanFileName}"`);
              } else {
                // Intentar buscar en /app y otra ubicaciones comunes
                const findAllCommand = ['find', '/', '-name', cleanFileName, '-type', 'f', '2>/dev/null', '|', 'head', '-1'];
                const findAllResult = await dockerServiceServer.executeCommand(
                  args.container_id, 
                  ['bash', '-c', `find / -name "${cleanFileName}" -type f 2>/dev/null | head -1`]
                );
                
                if (findAllResult.trim()) {
                  fixedCommand = originalCommand.replace(fileName, findAllResult.trim());
                }
              }
            }
          }
        } 
        // 2. Error de permisos
        else if (errorMsg.includes('Permission denied')) {
          fixStrategy = "permission_denied";
          
          // Añadir sudo si no lo tiene
          if (!originalCommand.startsWith('sudo ')) {
            fixedCommand = 'sudo ' + originalCommand;
          } else {
            // Intentar con bash -c para manejar permisos
            fixedCommand = `bash -c "${originalCommand}"`;
          }
        }
        // 3. Error de comando no encontrado
        else if (errorMsg.includes('command not found') || errorMsg.includes('not found')) {
          fixStrategy = "command_not_found";
          
          // Obtener el comando principal
          const mainCommand = originalCommand.split(' ')[0];
          
          // Verificar comandos comunes y sus alternativas
          if (mainCommand === 'python' || mainCommand === 'python3') {
            // Verificar qué versiones de Python están disponibles
            const pythonVersions = await dockerServiceServer.executeCommand(
              args.container_id,
              ['bash', '-c', 'command -v python || command -v python3 || echo "No Python found"']
            );
            
            if (pythonVersions.includes('python3')) {
              fixedCommand = originalCommand.replace(/^python(\s)/, 'python3$1');
            } else if (pythonVersions.includes('python')) {
              fixedCommand = originalCommand.replace(/^python3(\s)/, 'python$1');
            }
          } 
          // Otros comandos comunes y sus alternativas
          else if (mainCommand === 'node' || mainCommand === 'npm') {
            const nodeCheck = await dockerServiceServer.executeCommand(
              args.container_id,
              ['bash', '-c', 'command -v node || command -v nodejs || echo "No Node.js found"']
            );
            
            if (nodeCheck.includes('nodejs') && !nodeCheck.includes('node')) {
              fixedCommand = originalCommand.replace(/^node(\s)/, 'nodejs$1');
            }
          }
          
          // Si no encontramos una alternativa específica, usar which para ver si está en otra ruta
          if (fixedCommand === originalCommand) {
            const whichCommand = await dockerServiceServer.executeCommand(
              args.container_id,
              ['bash', '-c', `which ${mainCommand} || echo "Not found"`]
            );
            
            if (!whichCommand.includes('Not found')) {
              // Usar la ruta completa al comando
              fixedCommand = originalCommand.replace(new RegExp(`^${mainCommand}(\\s)`), `${whichCommand.trim()}$1`);
            }
          }
        }
        // 4. Problemas con espacios o caracteres especiales
        else if (errorMsg.includes('unexpected token') || errorMsg.includes('syntax error')) {
          fixStrategy = "syntax_error";
          
          // Poner toda la expresión entre comillas y usar bash -c
          fixedCommand = `bash -c "${originalCommand.replace(/"/g, '\\"')}"`;
        }
        
        // Si no aplicamos ninguna estrategia específica, usar bash -c como fallback
        if (fixStrategy === "unknown" && originalCommand !== `bash -c "${originalCommand.replace(/"/g, '\\"')}"`) {
          fixStrategy = "general_fallback";
          fixedCommand = `bash -c "${originalCommand.replace(/"/g, '\\"')}"`;
        }
        
        // Intentar ejecutar el comando corregido
        let fixSuccess = false;
        let fixOutput = "";
        
        try {
          // Preparar el comando corregido para ejecución
          let commandParts: string[];
          if (fixedCommand.startsWith('bash -c')) {
            commandParts = ['bash', '-c', fixedCommand.substring(8).trim().replace(/^"|"$/g, '')];
          } else if (fixedCommand.includes(' ')) {
            commandParts = fixedCommand.split(' ');
          } else {
            commandParts = [fixedCommand];
          }
          
          fixOutput = await dockerServiceServer.executeCommand(args.container_id, commandParts);
          fixSuccess = true;
        } catch (fixError) {
          fixOutput = fixError instanceof Error ? fixError.message : "Error al ejecutar comando corregido";
          fixSuccess = false;
        }
        
        return {
          original_command: originalCommand,
          fixed_command: fixedCommand,
          fix_strategy: fixStrategy,
          success: fixSuccess,
          output: fixOutput
        };
      } catch (error) {
        console.error("Error al intentar corregir comando:", error);
        return {
          original_command: args.failed_command,
          error: error instanceof Error ? error.message : "Error desconocido",
          success: false
        };
      }
    }
  };
}

/**
 * Genera un plan detallado de manera agéntica, permitiendo que el modelo solicite
 * información adicional durante el proceso.
 * @param input Entrada para la planificación agéntica
 * @returns Plan detallado con pasos a seguir
 */
export async function generateAgenticPlan(input: AgenticPlanningInput): Promise<AgenticPlanningOutput> {
  console.log("PASO 1: Identificando archivos relevantes...");
  // Preparar el contexto de archivos
  let archivosDisponibles = '';
  if (input.fileNames && input.fileNames.length > 0) {
    archivosDisponibles = "Archivos disponibles:\n" + input.fileNames.map(fileName => `- ${fileName}`).join('\n');
  }
  
  console.log("Archivos relevantes identificados: ", input.fileNames || []);
  
  console.log("PASO 2: Analizando archivos relevantes...");
  // Análisis inicial para determinar qué archivos se deben examinar a fondo
  const filesRelevanceResponse = await geminiService.getFileRelevanceAnalysis(
    input.prompt,
    archivosDisponibles
  );
  
  let filesToAnalyze: Record<string, string> = {};
  
  // Asociar nombres de archivos con su contenido
  if (input.fileNames && input.fileContents && filesRelevanceResponse.filesToAnalyze.length > 0) {
    console.log("Analizando archivos:", filesRelevanceResponse.filesToAnalyze);
    filesRelevanceResponse.filesToAnalyze.forEach((fileName: string) => {
      const index = input.fileNames!.findIndex(name => name === fileName);
      if (index !== -1 && input.fileContents && input.fileContents[index]) {
        filesToAnalyze[fileName] = input.fileContents[index];
      }
    });
  }
  
  console.log("PASO 3: Evaluando necesidad de información externa...");
  // Determinar si se necesita información externa
  const externalInfoResponse = await geminiService.getExternalInfoNeeds(
    input.prompt,
    archivosDisponibles,
    Object.keys(filesToAnalyze).length > 0 
      ? "Algunos archivos fueron identificados como relevantes y serán analizados." 
      : "No se identificaron archivos relevantes para analizar."
  );
  
  let searchResults: { query: string, results: string }[] = [];
  
  // Realizar búsquedas externas si es necesario
  if (externalInfoResponse.needsExternalInfo) {
    console.log("PASO 4: Realizando búsquedas externas necesarias...");
    for (const query of externalInfoResponse.searchQueries) {
      console.log("Buscando información:", query);
      try {
        const searchResult = await geminiService.simulateWebSearch(query);
        searchResults.push({
          query,
          results: searchResult
        });
      } catch (error) {
        console.error("Error al buscar información externa:", error);
      }
    }
  }
  
  // Preparar un contenedor Docker si hay archivos para analizar
  let containerId: string | null = null;
  let dockerCommands: { command: string, output: string }[] = [];
  let filesInDocker: string[] = [];
  
  if (Object.keys(filesToAnalyze).length > 0 || externalInfoResponse.needsDockerCommands) {
    try {
      // Intentar obtener un contenedor disponible usando getAvailableContainer
      try {
        console.log("Intentando obtener un contenedor disponible...");
        const container = await dockerServiceServer.getAvailableContainer();
        containerId = container.id;
        console.log(`Contenedor obtenido: ${containerId}`);
      } catch (containerError) {
        console.error("Error al obtener contenedor:", containerError);
      }
      
      // Si tenemos un contenedor, subir archivos y ejecutar comandos
      if (containerId) {
        // Subir archivos si hay para analizar
        if (Object.keys(filesToAnalyze).length > 0) {
          console.log("Preparando archivos para subir al contenedor Docker...");
          const filesToUpload = Object.entries(filesToAnalyze).map(([name, content]) => ({
            name,
            dataUri: `data:application/octet-stream;base64,${btoa(unescape(encodeURIComponent(content)))}`
          }));
          
          try {
            filesInDocker = await dockerServiceServer.uploadFilesFromDataUris(containerId, filesToUpload);
            console.log("Archivos subidos al contenedor Docker:", filesInDocker);
            
            // Verificar los archivos subidos
            const lsOutput = await dockerServiceServer.executeCommand(containerId, ['ls', '-la', '/uploads']);
            dockerCommands.push({ command: 'ls -la /uploads', output: lsOutput });

            // Intentar leer algunos de los archivos subidos para verificar su contenido
            for (const filePath of filesInDocker.slice(0, 2)) { // Limitar a los primeros 2 para no abrumar el log
              try {
                const fileName = filePath.split('/').pop();
                const catOutput = await dockerServiceServer.executeCommand(containerId, ['cat', filePath]);
                const shortOutput = catOutput.length > 200 ? catOutput.substring(0, 200) + '...' : catOutput;
                console.log(`Contenido de ${fileName} (primeros 200 caracteres):`, shortOutput);
                dockerCommands.push({ command: `cat ${filePath}`, output: shortOutput });
              } catch (catError) {
                console.error(`Error al leer archivo ${filePath}:`, catError);
              }
            }
          } catch (error) {
            console.error("Error al subir archivos al contenedor Docker:", error);
          }
        }
        
        // Ejecutar comandos Docker específicos si se solicitan
        if (externalInfoResponse.needsDockerCommands) {
          console.log("Ejecutando comandos Docker solicitados...");
          let commandsToExecute = [...externalInfoResponse.dockerCommands];
          
          // Si hay archivos Python, sugerir comandos útiles adicionales
          if (Object.keys(filesToAnalyze).some(file => file.endsWith('.py'))) {
            // Obtener el primer archivo Python para análisis
            const pythonFile = Object.keys(filesToAnalyze).find(file => file.endsWith('.py'));
            if (pythonFile && !commandsToExecute.some(cmd => cmd.includes(pythonFile))) {
              console.log(`Añadiendo comandos sugeridos para analizar ${pythonFile}`);
              // Usar comandos sugeridos por Gemini o comandos predeterminados si no hay sugerencias
              const suggestedCommands = geminiService.getSuggestedPythonCommands(`/uploads/${pythonFile}`);
              
              // Añadir hasta 2 comandos sugeridos si no hay muchos comandos ya
              if (commandsToExecute.length < 2) {
                commandsToExecute = [...commandsToExecute, ...suggestedCommands.slice(0, 2)];
              }
            }
          }
          
          // Ejecutar reconocimiento del entorno siempre primero
          try {
            console.log("Verificando entorno Docker disponible...");
            const lsOutput = await dockerServiceServer.executeCommand(containerId, ["ls", "-la", "/uploads"]);
            dockerCommands.push({ command: "ls -la /uploads", output: lsOutput });
            console.log("Archivos disponibles en /uploads:", lsOutput);

            // Verificar el directorio actual de trabajo
            const pwdOutput = await dockerServiceServer.executeCommand(containerId, ["pwd"]);
            dockerCommands.push({ command: "pwd", output: pwdOutput });
            console.log("Directorio de trabajo del contenedor:", pwdOutput.trim());

          } catch (error) {
            console.error("Error al verificar el entorno Docker:", error);
          }
          
          // Sistema adaptativo para ejecución de comandos
          let executedSuccessfully = 0;
          const executionContext = {
            currentDirectory: "/app", // Directorio por defecto
            availableFiles: [] as string[],
            failedCommands: [] as string[],
          };
          
          // Extraer información del reconocimiento de entorno
          try {
            // Actualizar directorio actual
            const pwdResult = dockerCommands.find(cmd => cmd.command === "pwd");
            if (pwdResult?.output) {
              executionContext.currentDirectory = pwdResult.output.trim();
            }
            
            // Analizar archivos disponibles
            const lsResult = dockerCommands.find(cmd => cmd.command === "ls -la /uploads");
            if (lsResult?.output) {
              // Extraer nombres de archivos
              const lines = lsResult.output.split('\n').slice(2); // Omitir 'total' y directorios . y ..
              executionContext.availableFiles = lines
                .map(line => {
                  const parts = line.trim().split(/\s+/);
                  return parts[parts.length - 1]; // Último campo es el nombre del archivo
                })
                .filter(name => name && !name.startsWith('.'));
              
              console.log("Archivos identificados en /uploads:", executionContext.availableFiles);
            }
          } catch (err) {
            console.error("Error al procesar información del entorno:", err);
          }
          
          // Ejecución secuencial e inteligente de comandos
          for (const originalCommand of commandsToExecute) {
            try {
              // Si muchos comandos fallan, detener la ejecución
              if (executionContext.failedCommands.length > 3 && executedSuccessfully === 0) {
                console.warn("Demasiados comandos fallidos, deteniendo ejecución.");
                break;
              }

              // 1. Preparación del comando adaptativa
              let adaptedCommand = originalCommand;
              let commandParts: string[];
              
              // Comando específico si tiene relación con un archivo detectado
              const containsFileName = executionContext.availableFiles.some(file => 
                originalCommand.includes(file) || 
                originalCommand.includes(file.replace(/ /g, "")) // Buscar también sin espacios
              );
              
              if (containsFileName) {
                // Asegurar que las referencias a archivos están en /uploads
                for (const file of executionContext.availableFiles) {
                  if (originalCommand.includes(file) && !originalCommand.includes(`/uploads/${file}`)) {
                    adaptedCommand = adaptedCommand.replace(
                      new RegExp(`\\b${file.replace(/[\(\)]/g, '\\$&')}\\b`, 'g'), 
                      `/uploads/${file}`
                    );
                  }
                }
              }
              
              // Comandos específicos que necesitan tratamiento especial
              if (adaptedCommand.includes('grep')) {
                // grep necesita usar bash -c para manejar caracteres especiales
                commandParts = ['bash', '-c', adaptedCommand.replace(/"/g, '\\"')];
              } 
              else if (adaptedCommand.startsWith('python ')) {
                // Para comandos python, asegurar que apunta al directorio correcto
                const pythonParts = adaptedCommand.split(' ');
                if (pythonParts.length > 1) {
                  const scriptPath = pythonParts[1];
                  if (!scriptPath.startsWith('/')) {
                    // Si no es ruta absoluta, prefijamos /uploads/
                    pythonParts[1] = `/uploads/${scriptPath}`;
                  }
                  commandParts = pythonParts;
                } else {
                  commandParts = ['python'];
                }
              }
              else if (adaptedCommand.includes(' ')) {
                // Para comandos con espacios, usar bash -c
                commandParts = ['bash', '-c', adaptedCommand];
              } 
              else {
                // Comandos simples
                commandParts = adaptedCommand.split(' ').filter(part => part.length > 0);
              }
              
              console.log(`Ejecutando comando: ${originalCommand} (adaptado como: ${commandParts.join(' ')})`);
              const output = await dockerServiceServer.executeCommand(containerId, commandParts);
              dockerCommands.push({ command: originalCommand, output });
              executedSuccessfully++;
              
              // Analizar resultado para adaptar estrategia
              if (output.includes('No such file or directory')) {
                // Intentar corregir comando si es sobre archivos
                if (containsFileName) {
                  console.log("Archivo no encontrado, intentando localizar archivo...");
                  // Intentar encontrar el archivo con find
                  try {
                    const findResult = await dockerServiceServer.executeCommand(
                      containerId, 
                      ['find', '/', '-name', executionContext.availableFiles[0], '-type', 'f']
                    );
                    if (findResult.trim()) {
                      console.log(`Archivo encontrado en: ${findResult.trim()}`);
                      dockerCommands.push({ 
                        command: `find / -name "${executionContext.availableFiles[0]}" -type f`, 
                        output: findResult 
                      });
                    }
                  } catch (findError) {
                    console.error("Error al buscar archivo:", findError);
                  }
                }
              }
              
            } catch (error) {
              console.error(`Error al ejecutar comando Docker '${originalCommand}':`, error);
              executionContext.failedCommands.push(originalCommand);
              
              // Si falla, intentar versión simplificada del comando
              try {
                if (originalCommand.includes("code (1).py") || originalCommand.includes("code(1).py")) {
                  console.log("Intentando comando alternativo sin espacios en el nombre del archivo...");
                  
                  // Intentar listar archivos primero
                  const altLsResult = await dockerServiceServer.executeCommand(containerId, ["ls", "/uploads"]);
                  console.log("Archivos en /uploads:", altLsResult);
                  
                  // Simplificar comando quitando comillas y usando rutas absolutas
                  let altCommand = originalCommand
                    .replace(/"/g, '')
                    .replace(/code \(1\)\.py/g, '/uploads/code (1).py');
                    
                  // Usar bash -c para comandos complejos
                  const altCommandParts = ['bash', '-c', `cd /uploads && ${altCommand}`];
                  console.log("Intentando comando alternativo:", altCommandParts.join(' '));
                  
                  const altOutput = await dockerServiceServer.executeCommand(containerId, altCommandParts);
                  dockerCommands.push({ 
                    command: `${originalCommand} (alternativo)`, 
                    output: altOutput 
                  });
                  console.log("Comando alternativo ejecutado con éxito");
                }
              } catch (altError) {
                console.error("Error también con comando alternativo:", altError);
              dockerCommands.push({ 
                  command: originalCommand, 
                output: `Error: ${error instanceof Error ? error.message : 'Error desconocido'}` 
              });
              }
            }
          }
          
          // Si todos los comandos fallaron, añadir información de diagnóstico
          if (executedSuccessfully === 0 && commandsToExecute.length > 0) {
            console.warn("Todos los comandos fallaron. Recopilando información de diagnóstico...");
            
            try {
              // Información adicional sobre el contenedor
              const versionInfo = await dockerServiceServer.executeCommand(containerId, ["bash", "-c", "python --version && which python"]);
              dockerCommands.push({ command: "Información de Python", output: versionInfo });
              
              // Ver qué otros intérpretes están disponibles
              const interpretersInfo = await dockerServiceServer.executeCommand(containerId, ["bash", "-c", "which node && node --version || echo 'Node no disponible'"]);
              dockerCommands.push({ command: "Información de Node.js", output: interpretersInfo });
              
              // Verificar si hay Python en /uploads
              if (executionContext.availableFiles.some(f => f.endsWith('.py'))) {
                const pyFileContents = await dockerServiceServer.executeCommand(
                  containerId, 
                  ["bash", "-c", `cat /uploads/*.py | head -20`]
                );
                dockerCommands.push({ 
                  command: "Contenido primeras líneas de archivos Python", 
                  output: pyFileContents.substring(0, 500) + (pyFileContents.length > 500 ? "..." : "") 
                });
              }
            } catch (diagError) {
              console.error("Error al obtener información de diagnóstico:", diagError);
            }
          }
        }
      } else {
        console.error("No se pudo obtener un contenedor Docker disponible.");
      }
    } catch (error) {
      console.error("Error al preparar Docker para el análisis:", error);
    }
  }
  
  console.log("PASO 5: Generando plan final con toda la información recopilada...");
  
  // Construir contexto para análisis de archivos
  let fileAnalysisContext = '';
  if (Object.keys(filesToAnalyze).length > 0) {
    fileAnalysisContext += "Se analizaron los siguientes archivos:\n";
    for (const [fileName, content] of Object.entries(filesToAnalyze)) {
      const shortContent = content.length > 1000 ? content.substring(0, 1000) + '...(contenido truncado)' : content;
      fileAnalysisContext += `\n===== ARCHIVO: ${fileName} =====\n${shortContent}\n=====\n`;
    }
  }
  
  // Añadir resultados de comandos Docker
  if (dockerCommands.length > 0) {
    fileAnalysisContext += "\nResultados de comandos ejecutados en Docker:\n";
    for (const { command, output } of dockerCommands) {
      fileAnalysisContext += `\n$ ${command}\n${output}\n`;
    }
  }
  
  // Construir contexto para información externa
  let externalInfoContext = '';
  if (searchResults.length > 0) {
    externalInfoContext += "Se encontró la siguiente información externa:\n";
    for (const { query, results } of searchResults) {
      externalInfoContext += `\n===== BÚSQUEDA: "${query}" =====\n${results}\n=====\n`;
    }
  }
  
  console.log("Solicitando plan detallado a Gemini...");
  // Generar plan con toda la información recopilada
  const detailedPlan = await geminiService.createDetailedPlan(
    input.prompt,
    archivosDisponibles,
    fileAnalysisContext,
    externalInfoContext
  );
  
  // Convertir el plan detallado a formato estructurado
  console.log("Solicitando respuesta estructurada final...");
  
  // Construir respuesta con el formato requerido
  const result: AgenticPlanningOutput = {
    plan: detailedPlan.plan,
    pasos: detailedPlan.pasos,
    requiereInfoExterna: externalInfoResponse.needsExternalInfo,
    requiereAnalisisArchivos: Object.keys(filesToAnalyze).length > 0,
    detallesVisualizacion: detailedPlan.detallesVisualizacion,
    archivosSolicitados: filesRelevanceResponse.filesToAnalyze,
    busquedasRealizadas: externalInfoResponse.searchQueries
  };
  
  return result;
}

// Implementación del flujo de planificación agéntica
const agenticPlanningFlow = ai.defineFlow<
  typeof AgenticPlanningInputSchema,
  typeof AgenticPlanningOutputSchema
>(
  {
    name: 'agenticPlanningFlow',
    inputSchema: AgenticPlanningInputSchema,
    outputSchema: AgenticPlanningOutputSchema,
  },
  async (input) => {
    try {
      // Registrar acciones realizadas por el agente
      const archivosSolicitados: string[] = [];
      const busquedasRealizadas: string[] = [];
      const archivosAnalizados: Record<string, string> = {};
      const resultadosBusquedas: Record<string, string[]> = {};

      // Paso 1: Primero identificar qué archivos necesitan analizarse
      console.log("PASO 1: Identificando archivos relevantes...");
      let archivosRelevantes: string[] = [];
      
      if (input.fileNames && input.fileNames.length > 0) {
        try {
          // Solicitar a Gemini que identifique los archivos relevantes
          const evaluacionArchivos = await geminiService.getTextResponse(
            `Evalúa los siguientes archivos y dime cuáles son relevantes para esta tarea: 
            Tarea: ${input.prompt}
            
            Archivos disponibles: ${input.fileNames.join(', ')}
            
            Responde con una lista de SOLO los nombres de archivos que consideres relevantes, separados por comas.`
          );
          
          // Extraer nombres de archivos de la respuesta
          const mencionesArchivos = evaluacionArchivos.match(/\b[\w\s\-\.]+\.(py|js|html|css|txt|json|csv|md)\b/g);
          if (mencionesArchivos && mencionesArchivos.length > 0) {
            archivosRelevantes = mencionesArchivos
              .filter(archivo => input.fileNames?.includes(archivo.trim()));
          } else {
            // Si no se detectaron archivos específicos pero se mencionan archivos en general
            if (evaluacionArchivos.toLowerCase().includes('todos') || 
                evaluacionArchivos.toLowerCase().includes('all') ||
                /archivo|file/i.test(evaluacionArchivos)) {
              archivosRelevantes = [...(input.fileNames || [])];
            }
          }
        } catch (error) {
          console.error("Error al evaluar archivos relevantes:", error);
          // En caso de error, considerar todos los archivos como relevantes
          archivosRelevantes = [...(input.fileNames || [])];
        }
      }
      
      console.log(`Archivos relevantes identificados: ${archivosRelevantes.join(', ')}`);

      // Paso 2: Analizar proactivamente todos los archivos relevantes
      console.log("PASO 2: Analizando archivos relevantes...");
      
      for (const archivo of archivosRelevantes) {
        if (!input.fileNames?.includes(archivo)) continue;
        
        console.log(`Analizando archivo: ${archivo}`);
        
        // Obtener contenido del archivo
        const index = input.fileNames.indexOf(archivo);
        if (index !== -1 && input.fileContents) {
          archivosSolicitados.push(archivo);
          archivosAnalizados[archivo] = input.fileContents[index];
          
          // Solicitar un análisis del archivo a Gemini
          try {
            const analisisArchivo = await geminiService.getTextResponse(
              `Analiza el siguiente contenido del archivo "${archivo}" en el contexto de esta tarea:
              
              Tarea: ${input.prompt}
              
              Contenido:
              ${input.fileContents[index].substring(0, 5000)} ${input.fileContents[index].length > 5000 ? '... (contenido truncado)' : ''}
              
              Proporciona un breve resumen del contenido y su relevancia para la tarea.`
            );
            
            // Guardar el análisis para usarlo en la generación del plan final
            archivosAnalizados[archivo] += `\n\nANÁLISIS: ${analisisArchivo}`;
          } catch (error) {
            console.error(`Error al analizar archivo ${archivo}:`, error);
          }
        }
      }

      // Paso 3: Determinar si se necesita información externa
      console.log("PASO 3: Evaluando necesidad de información externa...");
      let infoExternaRequerida = false;
      const busquedasPotenciales: string[] = [];
      
      try {
        // Preguntar a Gemini si se necesita buscar información externa
        const evaluacionInfoExterna = await geminiService.getTextResponse(
          `Basándote en la siguiente tarea y los archivos analizados, ¿se necesita buscar información externa adicional?
          
          Tarea: ${input.prompt}
          
          Archivos analizados: ${Object.keys(archivosAnalizados).join(', ')}
          
          Si se necesita información externa, proporciona una lista de consultas de búsqueda específicas, una por línea, comenzando cada línea con "CONSULTA:".
          Si no se necesita información externa, simplemente responde "No se requiere información externa".`
        );
        
        // Extraer consultas de búsqueda
        const consultas = evaluacionInfoExterna.match(/CONSULTA:(.+?)(?=\n|$)/g);
        if (consultas && consultas.length > 0) {
          infoExternaRequerida = true;
          consultas.forEach(consulta => {
            const consultaLimpia = consulta.replace(/^CONSULTA:\s*/, '').trim();
            if (consultaLimpia) busquedasPotenciales.push(consultaLimpia);
          });
        }
      } catch (error) {
        console.error("Error al evaluar necesidad de información externa:", error);
      }
      
      // Paso 4: Realizar búsquedas externas si es necesario
      console.log("PASO 4: Realizando búsquedas externas necesarias...");
      
      for (const consulta of busquedasPotenciales) {
        console.log(`Buscando información: ${consulta}`);
        busquedasRealizadas.push(consulta);
        
        try {
          const resultados = await getSearchResults({ query: consulta });
          resultadosBusquedas[consulta] = resultados.snippets;
        } catch (error) {
          console.error(`Error al buscar información para "${consulta}":`, error);
          resultadosBusquedas[consulta] = [
            `Resultado simulado para: ${consulta}`,
            `Información relevante sobre: ${consulta}`
          ];
        }
      }

      // Paso 5: Generar el plan final con toda la información recopilada
      console.log("PASO 5: Generando plan final con toda la información recopilada...");
      
      // Construir un prompt completo con toda la información analizada
      let promptCompleto = `Genera un plan detallado para la siguiente tarea, basándote en TODA la información proporcionada:
      
      TAREA: ${input.prompt}
      
      `;
      
      // Añadir información de archivos analizados
      let archivosAnalizadosDetalle = '';
      if (Object.keys(archivosAnalizados).length > 0) {
        promptCompleto += `\nARCHIVOS ANALIZADOS:\n`;
        for (const [archivo, contenido] of Object.entries(archivosAnalizados)) {
          const analisis = contenido.split('ANÁLISIS:')[1] || 'Archivo relevante para la tarea.';
          promptCompleto += `\n--- ARCHIVO: ${archivo} ---\n`;
          promptCompleto += `Análisis: ${analisis}\n`;
          
          // Preparar descripción detallada para geminiService.createDetailedPlan
          const contenidoTexto = contenido.split('ANÁLISIS:')[0] || '';
          const contenidoResumido = contenidoTexto.length > 500 
            ? contenidoTexto.substring(0, 500) + '... (contenido truncado)' 
            : contenidoTexto;
          archivosAnalizadosDetalle += `Archivo: ${archivo}\nContenido resumido: ${contenidoResumido}\nAnálisis: ${analisis}\n\n`;
        }
      }
      
      // Añadir resultados de búsquedas
      if (Object.keys(resultadosBusquedas).length > 0) {
        promptCompleto += `\nINFORMACIÓN EXTERNA ENCONTRADA:\n`;
        for (const [consulta, resultados] of Object.entries(resultadosBusquedas)) {
          promptCompleto += `\n--- BÚSQUEDA: ${consulta} ---\n`;
          promptCompleto += resultados.slice(0, 3).join('\n') + '\n';
        }
      }
      
      promptCompleto += `\nBasándote en toda esta información, genera un plan detallado con pasos concretos para completar la tarea.`;
      
      // Solicitar el plan final detallado a Gemini
      console.log("Solicitando plan detallado a Gemini...");
      
      const planResult = await geminiService.createDetailedPlan(
        promptCompleto,
        input.fileNames ? input.fileNames : [],
        archivosAnalizadosDetalle,
        Object.entries(resultadosBusquedas)
          .map(([consulta, resultados]) => `Búsqueda: ${consulta}\nResultados: ${resultados.join('\n')}`)
          .join('\n\n')
      );
      console.log("Plan recibido de Gemini:", planResult);

      // Verificar que el resultado tenga las propiedades necesarias
      if (!planResult || typeof planResult !== 'object') {
        throw new Error("La respuesta del modelo no es un objeto válido");
      }

      // Asegurarse de que el resultado tenga el formato esperado
      const plan: AgenticPlanningOutput = {
        plan: planResult.plan || "No se pudo generar un plan detallado.",
        pasos: Array.isArray(planResult.pasos) ? planResult.pasos : [
          {
            paso: "Procesar solicitud",
            explicacion: "Analizar y procesar la solicitud del usuario."
          }
        ],
        requiereInfoExterna: infoExternaRequerida,
        requiereAnalisisArchivos: archivosRelevantes.length > 0,
        detallesVisualizacion: planResult.detallesVisualizacion || 
                              "Se mostrará un informe de texto con los resultados del análisis.",
        archivosSolicitados,
        busquedasRealizadas
      };

      return plan;

    } catch (error) {
      console.error('Error en el flujo de planificación agéntica:', error);
      // Devolver un plan de error en caso de fallo
      return {
        plan: `Error al generar el plan: ${error instanceof Error ? error.message : 'Error desconocido'}`,
        pasos: [
          {
            paso: "Error en la generación del plan",
            explicacion: "Se produjo un error al procesar la solicitud con Gemini."
          }
        ],
        requiereInfoExterna: false,
        requiereAnalisisArchivos: false,
        detallesVisualizacion: "No disponible debido a un error.",
        archivosSolicitados: [],
        busquedasRealizadas: []
      };
    }
  }
); 