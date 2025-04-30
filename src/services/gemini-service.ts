/**
 * @fileOverview Servicio para integración con Gemini, soportando function calling y structured output.
 * Este servicio permite interacciones agénticas con Gemini mediante el modelo gemini-2.5-flash-preview-04-17.
 */

import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, GenerateContentResult, FunctionDeclaration } from '@google/generative-ai';

// Interfaz para las herramientas (functions) disponibles para el modelo
export interface ToolInterface {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, any>;
    required?: string[];
  };
}

// Interfaz para la respuesta de la función
export interface FunctionResponse {
  name: string;
  response: Record<string, any>;
}

// Interfaz para la salida estructurada
export interface StructuredOutputConfig {
  title: string;
  description: string;
  type: string;
  properties: Record<string, any>;
  required?: string[];
}

// Interfaces para los nuevos métodos
export interface FileRelevanceResponse {
  filesToAnalyze: string[];
}

export interface ExternalInfoResponse {
  needsExternalInfo: boolean;
  searchQueries: string[];
  needsDockerCommands: boolean;
  dockerCommands: string[];
}

export interface DetailedPlanResponse {
  plan: string;
  pasos: {
    paso: string;
    explicacion: string;
  }[];
  detallesVisualizacion?: string;
}

export class GeminiService {
  private genAI: GoogleGenerativeAI;
  private modelName: string = 'gemini-2.5-flash-preview-04-17';
  private apiKey: string;
  private maxRetries: number = 3;
  private retryDelay: number = 1000; // ms

  constructor(apiKey: string) {
    if (!apiKey || apiKey.trim() === '') {
      console.error('Error: API Key de Gemini no proporcionada');
      throw new Error('API Key de Gemini no proporcionada');
    }
    
    this.apiKey = apiKey;
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  /**
   * Configuración predeterminada para generación de contenido
   */
  private getDefaultGenerationConfig() {
    return {
      temperature: 0.2,
      topK: 32,
      topP: 0.95,
      maxOutputTokens: 8192
    };
  }

  /**
   * Maneja errores comunes de la API de Gemini
   * @param error Error original
   * @returns Error procesado con mensaje mejorado
   */
  private handleApiError(error: any): Error {
    console.error('Error en la llamada a la API de Gemini:', error);
    
    // Verificar si es un error de autorización (403)
    if (error.message && error.message.includes('403')) {
      return new Error('Error de autorización (403): La API key no es válida o no tiene permisos. Verifica tu API key y los permisos de la cuenta.');
    }
    
    // Verificar si es un error de cuota excedida
    if (error.message && (error.message.includes('429') || error.message.includes('quota'))) {
      return new Error('Error de cuota excedida: Has superado el límite de solicitudes permitidas. Intenta más tarde o aumenta tu cuota.');
    }
    
    // Otros errores
    return new Error(`Error en la llamada a la API de Gemini: ${error.message || 'Error desconocido'}`);
  }

  /**
   * Ejecuta una operación con reintentos automáticos
   * @param operation Función a ejecutar
   * @returns Resultado de la operación
   */
  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = this.handleApiError(error);
        
        // Si no es un error que se pueda reintentar, lanzarlo inmediatamente
        if (!lastError.message.includes('429') && !lastError.message.includes('500')) {
          throw lastError;
        }
        
        // Esperar antes de reintentar
        if (attempt < this.maxRetries - 1) {
          const delay = this.retryDelay * Math.pow(2, attempt);
          console.log(`Reintentando en ${delay}ms (intento ${attempt + 1}/${this.maxRetries})...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError || new Error('Máximo de reintentos alcanzado');
  }

  /**
   * Crea un cliente de Gemini con las herramientas especificadas
   * @param tools Lista de herramientas (funciones) disponibles para el modelo
   * @returns Cliente de Gemini configurado
   */
  private async createModelWithTools(tools: ToolInterface[]) {
    // Verificar que la API key está disponible
    if (!this.apiKey || this.apiKey.trim() === '') {
      throw new Error('API Key de Gemini no configurada');
    }
    
    // Convertir nuestras definiciones de herramientas al formato de la API
    const functionDeclarations = tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    })) as FunctionDeclaration[];

    const model = this.genAI.getGenerativeModel({
      model: this.modelName,
      generationConfig: this.getDefaultGenerationConfig(),
      tools: [{
        functionDeclarations
      }]
    });

    return model;
  }

  /**
   * Crea un cliente de Gemini con configuración para salida estructurada
   * @param schema Esquema OpenAPI para la salida estructurada
   * @returns Cliente de Gemini configurado
   */
  private async createModelWithStructuredOutput(schema: StructuredOutputConfig) {
    // Verificar que la API key está disponible
    if (!this.apiKey || this.apiKey.trim() === '') {
      throw new Error('API Key de Gemini no configurada');
    }
    
    const model = this.genAI.getGenerativeModel({
      model: this.modelName,
      generationConfig: this.getDefaultGenerationConfig(),
      systemInstruction: `Debes devolver respuestas en un formato JSON estructurado según el siguiente esquema: ${JSON.stringify(schema)}`,
    });
    return model;
  }

  /**
   * Obtiene respuesta de texto simple de Gemini
   * @param prompt Prompt de usuario
   * @returns Respuesta de texto
   */
  async getTextResponse(prompt: string): Promise<string> {
    return this.withRetry(async () => {
      // Verificar que la API key está disponible
      if (!this.apiKey || this.apiKey.trim() === '') {
        throw new Error('API Key de Gemini no configurada');
      }
      
      const model = this.genAI.getGenerativeModel({
        model: this.modelName,
        generationConfig: this.getDefaultGenerationConfig(),
      });
      
      const result = await model.generateContent(prompt);
      return result.response.text();
    });
  }

  /**
   * Obtiene una respuesta estructurada de Gemini
   * @param prompt Prompt de usuario
   * @param schema Esquema para la salida estructurada
   * @returns Objeto JSON estructurado según el esquema
   */
  async getStructuredResponse<T>(userPrompt: string, schema: StructuredOutputConfig): Promise<T> {
    return this.withRetry(async () => {
      // Verificar que la API key está disponible
      if (!this.apiKey || this.apiKey.trim() === '') {
        throw new Error('API Key de Gemini no configurada');
      }
      
      // Convertir nuestro esquema al formato esperado por la API de Gemini
      const responseSchema: any = {
        type: schema.type
      };
      
      // Agregar la descripción y otras propiedades básicas
      if (schema.description) {
        responseSchema.description = schema.description;
      }
      
      if (schema.required) {
        responseSchema.required = schema.required;
      }
      
      // Agregar propiedades si existen
      if (schema.properties) {
        responseSchema.properties = {};
        
        Object.entries(schema.properties).forEach(([key, prop]) => {
          if (typeof prop === 'object') {
            const propSchema: any = { type: prop.type };
            
            if (prop.description) {
              propSchema.description = prop.description;
            }
            
            // Manejar arrays
            if (prop.type === 'array' && prop.items) {
              propSchema.items = {
                type: prop.items.type
              };
              
              if (prop.items.properties) {
                propSchema.items.properties = prop.items.properties;
                if (prop.items.required) {
                  propSchema.items.required = prop.items.required;
                }
              }
            }
            
            responseSchema.properties[key] = propSchema;
          }
        });
        
        // Agregar propertyOrdering para mejorar la respuesta
        if (Object.keys(responseSchema.properties).length > 0) {
          responseSchema.propertyOrdering = Object.keys(responseSchema.properties);
        }
      }

      // Configurar el modelo para generar salida estructurada
      const model = this.genAI.getGenerativeModel({
        model: this.modelName,
        generationConfig: {
          ...this.getDefaultGenerationConfig(),
          responseMimeType: 'application/json'
        }
      });

      // Agregar el schema al prompt para mejor contexto
      const promptWithSchema = `${userPrompt}

A continuación se muestra el esquema JSON que debes seguir en tu respuesta:
${JSON.stringify(responseSchema, null, 2)}

IMPORTANTE: Tu respuesta debe ser únicamente un JSON válido que siga este esquema, sin texto adicional.`;

      // Generar contenido con el prompt del usuario
      const result = await model.generateContent(promptWithSchema);
      let responseText = result.response.text();
      
      try {
        // Intentar parsear directamente
        return JSON.parse(responseText) as T;
      } catch (parseError) {
        console.error('Error al analizar la respuesta JSON inicial:', parseError);
        
        // Intento de extracción de JSON de la respuesta
        const extractedJson = this.extractJsonFromText(responseText);
        if (extractedJson) {
          console.log('JSON extraído con éxito de la respuesta');
          return extractedJson as T;
        }
        
        // Si no podemos extraer JSON, intentamos construir una respuesta básica
        console.warn('No se pudo extraer JSON de la respuesta, construyendo respuesta básica');
        
        // Crear una estructura básica basada en el esquema requerido
        const basicResponse = this.createBasicResponseFromSchema(schema, responseText);
        return basicResponse as T;
      }
    });
  }

  /**
   * Extrae un objeto JSON de un texto que puede contener explicaciones u otro contenido
   * @param text Texto del cual extraer el JSON
   * @returns Objeto JSON extraído o null si no se pudo extraer
   */
  private extractJsonFromText(text: string): any | null {
    try {
      // Primero intentar parsear directamente el texto completo como JSON
      try {
        return JSON.parse(text);
      } catch (e) {
        // No es JSON válido directamente, continuar con extracción
      }

      // Mejora: Buscar bloques de código JSON en markdown
      // Esto maneja casos como ```json {...} ``` o ```{...}```
      const jsonCodeBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)\n?```/;
      const codeBlockMatch = text.match(jsonCodeBlockRegex);
      if (codeBlockMatch && codeBlockMatch[1]) {
        try {
          return JSON.parse(codeBlockMatch[1]);
    } catch (e) {
          // No es JSON válido dentro del bloque de código, continuar
          console.log("Bloque código JSON detectado pero no es válido:", e);
        }
      }

      // Buscar objeto JSON que comience con { y termine con } en el texto
      // Mejora: Esta versión es más robusta y maneja objetos JSON anidados correctamente
      let braceCount = 0;
      let startIndex = -1;
      
      for (let i = 0; i < text.length; i++) {
        if (text[i] === '{') {
          if (braceCount === 0) {
            startIndex = i;
          }
          braceCount++;
        } else if (text[i] === '}') {
          braceCount--;
          if (braceCount === 0 && startIndex !== -1) {
            // Posible objeto JSON encontrado desde startIndex hasta i+1
            try {
              const jsonCandidate = text.substring(startIndex, i + 1);
              const result = JSON.parse(jsonCandidate);
              // Si llegamos aquí es un JSON válido
              if (typeof result === 'object' && result !== null) {
                return result;
              }
            } catch (e) {
              // No es JSON válido, continuar buscando
            }
          }
        }
      }

      // Buscar JSON que empiece con un array
      // Mejora: Detectar arrays no solo objetos
      if (text.includes('[') && text.includes(']')) {
        let bracketCount = 0;
        let arrayStartIndex = -1;
        
        for (let i = 0; i < text.length; i++) {
          if (text[i] === '[') {
            if (bracketCount === 0) {
              arrayStartIndex = i;
            }
            bracketCount++;
          } else if (text[i] === ']') {
            bracketCount--;
            if (bracketCount === 0 && arrayStartIndex !== -1) {
            try {
                const jsonCandidate = text.substring(arrayStartIndex, i + 1);
                const result = JSON.parse(jsonCandidate);
                // Si llegamos aquí es un JSON válido array
                if (Array.isArray(result)) {
                  return result;
                }
              } catch (e) {
                // No es JSON válido, continuar
              }
            }
          }
        }
      }

      // Mejora: Intentar arreglar errores comunes en el JSON
      // 1. Comillas simples en lugar de dobles
      let fixedText = text.replace(/(\w+)'\s*:/g, '"$1":');
      fixedText = fixedText.replace(/:\s*'([^']+)'/g, ':"$1"');
      
      // 2. Reemplazar comentarios tipo JavaScript // o /* */
      fixedText = fixedText.replace(/\/\/.*$/gm, '');
      fixedText = fixedText.replace(/\/\*[\s\S]*?\*\//g, '');
      
      // Búsqueda de JSON con texto corregido
      // Verificar si hay un objeto JSON en el texto corregido
      let match = fixedText.match(/{[\s\S]*?}/);
      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch (e) {
          // Todavía no es JSON válido, continuar
        }
      }
      
      // Intentar con array en texto corregido
      match = fixedText.match(/\[[\s\S]*?\]/);
      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch (e) {
          // No es JSON válido, continuar
        }
      }

      // Si todo lo anterior falla, buscar cualquier JSON parcial e intentar reconstruirlo
      console.warn("No se pudo extraer un JSON válido completo. Buscando propiedades clave-valor...");
      const propsRegex = /"([^"]+)":\s*("[^"]*"|\d+|true|false|null|\{[\s\S]*?\}|\[[\s\S]*?\])/g;
      const props: Record<string, any> = {};
      let propMatch;
      
      while ((propMatch = propsRegex.exec(text)) !== null) {
        try {
          const key = propMatch[1];
          const value = propMatch[2];
          // Intentar parsear el valor
          try {
            props[key] = JSON.parse(value);
          } catch {
            // Si no se puede parsear, usar el valor como string
            props[key] = value.replace(/^"|"$/g, '');
            }
        } catch (e) {
          // Ignorar propiedades mal formadas
        }
      }
      
      if (Object.keys(props).length > 0) {
        return props;
      }

      return null;
    } catch (error) {
      console.error('Error al extraer JSON del texto:', error);
    return null;
    }
  }

  /**
   * Crea una respuesta básica basada en el esquema requerido y el texto recibido
   * @param schema Esquema de la respuesta esperada
   * @param text Texto de respuesta del modelo
   * @returns Un objeto que cumple mínimamente con el esquema
   */
  private createBasicResponseFromSchema(schema: StructuredOutputConfig, text: string): any {
    const result: any = {};
    
    // Recorrer las propiedades requeridas y añadirlas al resultado
    if (schema.properties) {
      Object.entries(schema.properties).forEach(([key, prop]) => {
        if (typeof prop === 'object') {
          // Manejar tipos básicos
          if (prop.type === 'string') {
            // Para las propiedades de tipo string, usar el texto completo o parte de él
            if (key === 'plan') {
              result[key] = text; // Para el plan, usar todo el texto
            } else {
              // Para otras propiedades string, extraer una parte relevante o usar un valor por defecto
              result[key] = `Información extraída para ${key}`;
            }
          } else if (prop.type === 'boolean') {
            // Para booleanos, asumimos false por defecto
            result[key] = false;
          } else if (prop.type === 'array') {
            // Para arrays, creamos un array vacío o con un elemento básico
            result[key] = [];
            // Si es un array de objetos y tenemos la estructura, añadir un elemento de ejemplo
            if (prop.items && typeof prop.items === 'object' && prop.items.type === 'object') {
              const exampleItem: any = {};
              if (prop.items.properties) {
                Object.keys(prop.items.properties).forEach(itemKey => {
                  exampleItem[itemKey] = `Ejemplo de ${itemKey}`;
                });
              }
              result[key].push(exampleItem);
            }
          } else if (prop.type === 'object') {
            // Para objetos, crear un objeto vacío
            result[key] = {};
          } else {
            // Para otros tipos, usar null
            result[key] = null;
          }
        }
      });
    }
    
    return result;
  }

  /**
   * Ejecuta una conversación agéntica con Gemini
   * @param prompt Prompt inicial del usuario
   * @param tools Lista de herramientas disponibles
   * @param functionCallbacks Callbacks para las funciones
   * @param systemInstruction Instrucción de sistema opcional
   * @param maxIterations Número máximo de iteraciones
   * @returns Respuesta final de la conversación
   */
  async runAgenticConversation(
    prompt: string,
    tools: ToolInterface[],
    functionCallbacks: Record<string, (args: any) => Promise<any>>,
    systemInstruction?: string,
    maxIterations: number = 10
  ): Promise<string> {
    return this.withRetry(async () => {
      // Verificar que la API key está disponible
      if (!this.apiKey || this.apiKey.trim() === '') {
        throw new Error('API Key de Gemini no configurada');
      }
      
      // Verificar herramientas y callbacks
      if (!tools || tools.length === 0) {
        throw new Error('No se proporcionaron herramientas para la conversación agéntica');
      }

      const functionNames = tools.map(tool => tool.name);
      const callbackNames = Object.keys(functionCallbacks);
      
      for (const func of functionNames) {
        if (!callbackNames.includes(func)) {
          throw new Error(`Falta el callback para la función "${func}"`);
        }
      }
      
      // Crear el modelo con las herramientas definidas
      const model = await this.createModelWithTools(tools);
      
      // Configurar el chat
      const chat = model.startChat({
        systemInstruction: systemInstruction || 
          "Eres un asistente AI que puede llamar a funciones para realizar tareas. " +
          "Analiza la petición del usuario, determina qué funciones necesitas llamar, " +
          "y proporciona respuestas útiles basadas en los resultados."
      });
      
      // Enviar mensaje inicial
      let response = await chat.sendMessage(prompt);
      let text = response.response.text();
      let iterations = 0;
      
      // En lugar de usar métodos poco claros, guardamos las referencias
      const functionCaller = (response.response as any).functionCalls;
      const hasFunctionCalls = typeof functionCaller === 'function';
      
      // Iterar mientras haya llamadas a funciones
      while (hasFunctionCalls && iterations < maxIterations) {
        const calls = functionCaller ? functionCaller() : [];
        if (!calls || calls.length === 0) {
          break;
        }
        
        iterations++;
        
        // Procesar cada llamada a función
        for (const functionCall of calls) {
          const functionName = functionCall.name;
          
          // Verificar que tenemos un callback para esta función
          if (!functionCallbacks[functionName]) {
            console.error(`No se encontró callback para la función: ${functionName}`);
            continue;
          }
          
          try {
            // Parsear argumentos
            const args = JSON.parse(functionCall.args);
            
            // Ejecutar el callback correspondiente
            const result = await functionCallbacks[functionName](args);
            
            // Crear un mensaje string en lugar de usar objetos complejos
            const responseStr = `Función ${functionName} ejecutada con éxito. Resultado: ${JSON.stringify(result)}`;
            response = await chat.sendMessage(responseStr);
            
            // Actualizar el texto de respuesta
            text = response.response.text();
            } catch (error) {
            console.error(`Error al ejecutar la función "${functionName}":`, error);
            
            // Enviar mensaje de error como string
            const errorStr = `Error al ejecutar la función ${functionName}: ${error instanceof Error ? error.message : 'Error desconocido'}`;
            response = await chat.sendMessage(errorStr);
            
            // Actualizar el texto de respuesta
            text = response.response.text();
          }
        }
      }
      
      return text;
    });
  }

  /**
   * Crea un plan detallado basado en un prompt del usuario
   * @param userPrompt Prompt del usuario
   * @param availableFiles Archivos disponibles para análisis
   * @param fileAnalysisContext Contexto del análisis de archivos
   * @param externalInfoContext Contexto de información externa
   * @returns Plan detallado
   */
  async createDetailedPlan(
    userPrompt: string,
    availableFiles: string | string[],
    fileAnalysisContext?: string,
    externalInfoContext?: string
  ): Promise<DetailedPlanResponse> {
    return this.withRetry(async () => {
      // Verificar que la API key está disponible
      if (!this.apiKey || this.apiKey.trim() === '') {
        throw new Error('API Key de Gemini no configurada');
      }
      
      // Normalizar la lista de archivos
      const filesList = Array.isArray(availableFiles) 
        ? availableFiles.join('\n') 
        : availableFiles;
      
      // Construir el prompt
      const prompt = `
      Necesito crear un plan detallado para ejecutar la siguiente tarea:
      
      ${userPrompt}
      
      ARCHIVOS DISPONIBLES:
      ${filesList}
      
      ${fileAnalysisContext ? `ANÁLISIS DE ARCHIVOS:\n${fileAnalysisContext}` : ''}
      
      ${externalInfoContext ? `INFORMACIÓN EXTERNA:\n${externalInfoContext}` : ''}
      
      Necesito que me proporciones un plan detallado con los siguientes elementos:
      
      1. Un resumen general del plan
      2. Una lista de pasos específicos, donde cada paso incluya:
         - Nombre del paso
         - Explicación detallada
      
      Por favor, proporciona tu respuesta como un objeto JSON con la siguiente estructura:
      {
        "plan": "Resumen general del plan...",
  "pasos": [
    {
            "paso": "Nombre del primer paso",
            "explicacion": "Explicación detallada del primer paso..."
          },
          ...
        ],
        "detallesVisualizacion": "Opcional: información adicional para visualizar el plan"
      }
      `;
      
      // Definir el esquema para la respuesta estructurada
      const schema: StructuredOutputConfig = {
        title: "Plan Detallado",
        description: "Un plan detallado para ejecutar la tarea solicitada",
        type: "object",
        properties: {
          plan: {
            type: "string",
            description: "Resumen general del plan"
          },
          pasos: {
            type: "array",
            description: "Lista de pasos específicos a ejecutar",
            items: {
              type: "object",
              properties: {
                paso: {
                  type: "string",
                  description: "Nombre del paso"
                },
                explicacion: {
                  type: "string",
                  description: "Explicación detallada del paso"
                }
              },
              required: ["paso", "explicacion"]
            }
          },
          detallesVisualizacion: {
            type: "string",
            description: "Información adicional para visualizar el plan (opcional)"
          }
        },
        required: ["plan", "pasos"]
      };
      
      // Obtener la respuesta estructurada
      return await this.getStructuredResponse<DetailedPlanResponse>(prompt, schema);
    });
  }

  // Agregar los nuevos métodos a la clase GeminiService
  async getFileRelevanceAnalysis(userPrompt: string, availableFiles: string): Promise<FileRelevanceResponse> {
    const schema: StructuredOutputConfig = {
      title: "Análisis de Relevancia de Archivos",
      description: "Determina qué archivos son relevantes para resolver la solicitud",
      type: "object",
      properties: {
        filesToAnalyze: {
          type: "array",
          description: "Lista de nombres de archivos a analizar",
          items: {
            type: "string"
          }
        }
      }
    };

    try {
      const prompt = `Eres un asistente experto que analiza solicitudes de usuario y determina qué archivos son relevantes para resolver su solicitud.
Por favor, analiza la solicitud del usuario y la lista de archivos disponibles.
Determina qué archivos son probablemente necesarios para resolver la solicitud.

Solicitud del usuario: ${userPrompt}

${availableFiles}

Si no hay archivos relevantes, devuelve una lista vacía.
Utiliza tu mejor juicio para determinar qué archivos son probablemente relevantes en función de su nombre y la tarea solicitada.`;

      const result = await this.getStructuredResponse<FileRelevanceResponse>(prompt, schema);
      
      return result || { filesToAnalyze: [] };
    } catch (error) {
      console.error('Error al analizar relevancia de archivos:', error);
      return { filesToAnalyze: [] };
    }
  }

  async getExternalInfoNeeds(
    userPrompt: string, 
    availableFiles: string,
    fileAnalysisStatus: string
  ): Promise<ExternalInfoResponse> {
    const schema: StructuredOutputConfig = {
      title: "Necesidades de Información Externa",
      description: "Determina si se necesita información externa y qué búsquedas serían útiles",
      type: "object",
      properties: {
        needsExternalInfo: {
          type: "boolean",
          description: "Si se necesita información externa"
        },
        searchQueries: {
          type: "array",
          description: "Consultas de búsqueda si needsExternalInfo es true",
          items: {
            type: "string"
          }
        },
        needsDockerCommands: {
          type: "boolean",
          description: "Si se necesitan ejecutar comandos en Docker"
        },
        dockerCommands: {
          type: "array",
          description: "Comandos a ejecutar si needsDockerCommands es true",
          items: {
            type: "string"
          }
        }
      }
    };

    try {
      // Detectar si hay archivos Python para sugerir comandos apropiados
      const hasPythonFiles = availableFiles.includes('.py');
      const hasFileWithSpaces = availableFiles.includes('(') || availableFiles.includes(')') || availableFiles.includes(' ');
      
      const prompt = `Eres un asistente experto que analiza solicitudes de usuario y determina si se necesita información externa.
Por favor, analiza la solicitud del usuario y la lista de archivos disponibles.
Determina si se necesita información adicional y qué búsquedas web serían útiles.
También determina si se necesitan ejecutar comandos en Docker para analizar mejor los archivos o el entorno.

${hasPythonFiles ? `
IMPORTANTE PARA COMANDOS DOCKER:
Los archivos que se analizarán están en el directorio /uploads dentro del contenedor Docker.
Aquí hay algunas pautas importantes para que los comandos funcionen correctamente:

1. Para archivos con espacios o caracteres especiales, hay tres opciones seguras:
   - Usa: bash -c "cat /uploads/nombre\\ del\\ archivo.py"
   - Usa: bash -c "cd /uploads && python nombre\\ del\\ archivo.py"
   - Usa: bash -c "cd /uploads && grep -n pattern nombre\\ del\\ archivo.py"

2. Para comandos de análisis de código Python:
   - Para verificar sintaxis: bash -c "cd /uploads && python -m py_compile archivo.py"
   - Para ejecución: bash -c "cd /uploads && python archivo.py"
   - Para ver estructura: bash -c "cd /uploads && grep -n '^def\\|^class' archivo.py"
   - Para ver imports: bash -c "cd /uploads && grep -n '^import\\|^from' archivo.py"

${hasFileWithSpaces ? '¡IMPORTANTE! Hay archivos con espacios o caracteres especiales. Asegúrate de escapar correctamente estos nombres usando las formas sugeridas arriba.' : ''}
` : ''}

Solicitud del usuario: ${userPrompt}

${availableFiles}

${fileAnalysisStatus}`;

      const result = await this.getStructuredResponse<ExternalInfoResponse>(prompt, schema);
      
      return result || { 
        needsExternalInfo: false, 
        searchQueries: [],
        needsDockerCommands: false,
        dockerCommands: []
      };
    } catch (error) {
      console.error('Error al analizar necesidades de información externa:', error);
      return { 
        needsExternalInfo: false, 
        searchQueries: [],
        needsDockerCommands: false,
        dockerCommands: []
      };
    }
  }

  async simulateWebSearch(query: string): Promise<string> {
    try {
      const model = this.genAI.getGenerativeModel({
        model: this.modelName,
        generationConfig: this.getDefaultGenerationConfig(),
      });
      
      const systemPrompt = `Eres un motor de búsqueda web especializado. Te proporcionaré una consulta, 
y deberás simular una búsqueda web para esa consulta. Proporciona resultados relevantes y útiles 
en un formato de resumen conciso, como si fueras el resultado de una búsqueda en Google.`;
      
      const userPrompt = `Consulta de búsqueda: "${query}"`;
      
      const result = await model.generateContent({
        contents: [
          { role: "user", parts: [{ text: systemPrompt + "\n\n" + userPrompt }] }
        ]
      });
      
      const responseText = result.response.text();
      return responseText;
    } catch (error) {
      console.error('Error al simular búsqueda web:', error);
      return `Error al buscar información sobre "${query}"`;
    }
  }

  // Sugiere comandos Docker relevantes para analizar un archivo Python
  getSuggestedPythonCommands(pythonFile: string): string[] {
    // El nombre del archivo con posibles espacios
    const escapedFileName = pythonFile.includes(' ') ? 
      pythonFile.replace(/ /g, '\\ ') : 
      pythonFile;
    
    // Lista de comandos útiles para analizar archivos Python
    return [
      `bash -c "cd /uploads && python -m py_compile ${escapedFileName.replace('/uploads/', '')}"`,
      `bash -c "cd /uploads && python ${escapedFileName.replace('/uploads/', '')}"`,
      `bash -c "cd /uploads && grep -n '^import\\|^from' ${escapedFileName.replace('/uploads/', '')}"`,
      `bash -c "cd /uploads && grep -n '^def\\|^class' ${escapedFileName.replace('/uploads/', '')}"` 
    ];
  }
}

// Exportar una instancia del servicio
export const geminiService = new GeminiService(process.env.GOOGLE_GENAI_API_KEY || ''); 