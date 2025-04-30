/**
 * Prompts avanzados para el agente de planificación
 * Inspirados en Manus Agent y adaptados para Gemini
 */

export const AGENTRIC_PLANNER_PROMPTS = {
  /**
   * Instrucción de sistema base para el agente de planificación
   */
  SYSTEM_INSTRUCTION: `
Eres un asistente de planificación agéntica con capacidades avanzadas de resolución de problemas y análisis de código.

<capacidades>
- Puedes analizar archivos de código y comprender su estructura y funcionalidad
- Puedes ejecutar comandos en entornos Docker para probar y analizar código
- Puedes buscar información externa cuando es necesaria para resolver problemas
- Sabes adaptar tu enfoque cuando encuentras obstáculos o errores
- Generas planes detallados y estructurados con pasos bien definidos
- Explicas tu razonamiento de manera clara y lógica
</capacidades>

<ciclo_agéntico>
1. Analiza el problema inicial y determina qué información necesitas
2. Evalúa qué archivos son relevantes para la tarea y solicítalos
3. Analiza los archivos de código para entender su funcionamiento
4. Si es necesario, ejecuta pruebas o comandos para verificar comportamientos
5. Busca información externa si hay brechas de conocimiento
6. Genera un plan detallado basado en toda la información recopilada
7. Organiza el plan en pasos concretos y accionables con explicaciones
</ciclo_agéntico>

<formato_respuesta>
Tu respuesta final debe ser un JSON con la siguiente estructura:
{
  "plan": "Resumen general del plan",
  "pasos": [
    {
      "paso": "Nombre del primer paso",
      "explicacion": "Explicación detallada del primer paso"
    },
    {
      "paso": "Nombre del segundo paso",
      "explicacion": "Explicación detallada del segundo paso"
    }
  ],
  "detallesVisualizacion": "Información sobre cómo visualizar resultados (si aplica)"
}
</formato_respuesta>
`,

  /**
   * Prompt para analizar qué archivos son relevantes
   */
  FILE_RELEVANCE_PROMPT: `
Analiza el siguiente problema y determina qué archivos son relevantes para resolverlo:

TAREA: {prompt}

ARCHIVOS DISPONIBLES:
{availableFiles}

Tu trabajo es identificar qué archivos son relevantes para la tarea. Considera:
1. Archivos que contienen código que se debe modificar
2. Archivos de configuración relevantes
3. Archivos de datos que se deben procesar o analizar
4. Archivos que proporcionan contexto importante para entender el problema

Responde ÚNICAMENTE con un JSON siguiendo esta estructura:
{
  "filesToAnalyze": ["archivo1.ext", "archivo2.ext", ...]
}

No incluyas explicaciones fuera del JSON. Incluye solo los nombres de archivo exactos como aparecen en la lista, sin rutas adicionales.
`,

  /**
   * Prompt para determinar si se necesita información externa
   */
  EXTERNAL_INFO_PROMPT: `
Evalúa si necesitas información externa para resolver esta tarea:

TAREA: {prompt}

ARCHIVOS DISPONIBLES:
{availableFiles}

ESTADO DEL ANÁLISIS DE ARCHIVOS:
{fileAnalysisStatus}

Tu trabajo es determinar:
1. Si se necesita información externa (documentación, tutoriales, etc.)
2. Qué consultas específicas de búsqueda serían útiles
3. Si se necesitan ejecutar comandos en Docker para analizar mejor los archivos

Responde ÚNICAMENTE con un JSON siguiendo esta estructura:
{
  "needsExternalInfo": true/false,
  "searchQueries": ["consulta 1", "consulta 2", ...],
  "needsDockerCommands": true/false,
  "dockerCommands": ["comando 1", "comando 2", ...]
}

No incluyas explicaciones fuera del JSON.
`,

  /**
   * Prompt para crear un plan detallado
   */
  DETAILED_PLAN_PROMPT: `
Crea un plan detallado para resolver esta tarea usando toda la información disponible:

TAREA: {prompt}

{fileContext}

{externalInfoContext}

Tu trabajo es crear un plan completo que:
1. Aborde todos los aspectos de la tarea solicitada
2. Utilice la información de los archivos analizados
3. Aproveche la información externa recopilada
4. Proporcione pasos claros y accionables
5. Explique cada paso con suficiente detalle para implementarlo

Responde con un JSON siguiendo esta estructura:
{
  "plan": "Resumen general del plan en 2-3 oraciones",
  "pasos": [
    {
      "paso": "Nombre breve del paso 1",
      "explicacion": "Explicación detallada del paso 1"
    },
    {
      "paso": "Nombre breve del paso 2",
      "explicacion": "Explicación detallada del paso 2"
    },
    ...
  ],
  "detallesVisualizacion": "Información sobre cómo visualizar o verificar los resultados (si aplica)"
}

Asegúrate de que tu JSON sea válido y siga exactamente esta estructura.
`
};

/**
 * Plantillas para generar comandos Docker adaptados automáticamente
 */
export const DOCKER_COMMAND_TEMPLATES = {
  // Análisis de archivos Python
  PYTHON_ANALYSIS_COMMANDS: [
    "cd /uploads && ls -la", // Ver archivos disponibles
    "cat {file_path} | head -50", // Ver contenido inicial
    "grep -n \"import \" {file_path}", // Ver importaciones
    "grep -n \"def \" {file_path}", // Ver definiciones de funciones
    "grep -n \"class \" {file_path}", // Ver definiciones de clases
    "python -m py_compile {file_path} && echo 'Compilación exitosa'", // Verificar sintaxis
    "python -c \"import ast; print(ast.dump(ast.parse(open('{file_path}').read())))\" || echo 'Error en AST'", // Análisis AST
    "python {file_path}", // Ejecutar script
  ],

  // Análisis de archivos JavaScript/TypeScript
  JS_ANALYSIS_COMMANDS: [
    "cd /uploads && ls -la", // Ver archivos disponibles
    "cat {file_path} | head -50", // Ver contenido inicial
    "grep -n \"import \" {file_path} || grep -n \"require(\" {file_path}", // Ver importaciones
    "grep -n \"function \" {file_path} || grep -n \"=>\" {file_path}", // Ver funciones
    "grep -n \"class \" {file_path}", // Ver clases
    "node -c {file_path} && echo 'Compilación exitosa'" // Verificar sintaxis
  ],

  // Comandos genéricos para análisis de archivos
  GENERIC_ANALYSIS_COMMANDS: [
    "cd /uploads && ls -la", // Ver archivos disponibles
    "file {file_path}", // Determinar tipo de archivo
    "cat {file_path} | head -30", // Ver primeras líneas
    "cat {file_path} | tail -30", // Ver últimas líneas
    "wc -l {file_path}" // Contar líneas
  ]
};

/**
 * Prompts para analizadores de funciones específicas
 */
export const FUNCTION_ANALYSIS_PROMPTS = {
  /**
   * Prompt para analizar un archivo Python
   */
  PYTHON_FILE_ANALYSIS: `
Analiza el siguiente archivo Python:

ARCHIVO: {file_name}

CONTENIDO:
{file_content}

Proporciona un análisis detallado que incluya:
1. Propósito principal del archivo
2. Funciones/clases clave y sus propósitos
3. Dependencias externas
4. Posibles problemas o limitaciones
5. Cómo se relaciona con la tarea: {task_description}

Formato solicitado: análisis detallado en texto plano.
`,

  /**
   * Prompt para analizar un error Docker
   */
  DOCKER_ERROR_ANALYSIS: `
Analiza el siguiente error en la ejecución de un comando Docker:

COMANDO: {command}
ERROR: {error_message}

Contenido del archivo relacionado (si aplica):
{file_content}

Explica:
1. Causa probable del error
2. Posibles soluciones
3. Comandos alternativos que podrían funcionar

Sé específico en tus recomendaciones y considera:
- Problemas de permisos
- Errores de sintaxis
- Problemas con nombres de archivo (espacios, caracteres especiales)
- Dependencias faltantes
- Versiones incompatibles
`,

  /**
   * Prompt para generar comandos adaptados al entorno
   */
  ADAPTIVE_COMMAND_GENERATION: `
Genera comandos Docker para analizar este archivo, considerando las características del entorno:

ARCHIVO: {file_name}
TIPO: {file_type}
RUTA: {file_path}

ENTORNO:
- Directorio actual: {current_dir}
- Archivos disponibles: {available_files}
- Información del sistema: {system_info}

Genera comandos que:
1. Manejen correctamente archivos con espacios o caracteres especiales
2. Funcionen en el entorno Docker disponible
3. Proporcionen información útil sobre el archivo
4. Utilicen herramientas disponibles en el sistema

Incluye comandos para analizar la estructura, contenido y funcionamiento del archivo.
`
}; 