import os
import json
import requests
import logging
from typing import List, Dict, Any, Callable, Optional, Tuple, Union
from enum import Enum
from pydantic import BaseModel, Field
from dotenv import load_dotenv
from google import genai
from google.genai import types

# Importar esquemas de datos para respuesta estructurada
from schemas import Plan, PlanStep

# Configuración de logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
log = logging.getLogger(__name__)

# Cargar variables de entorno
load_dotenv()

# URL del servidor Docker Manager - Puerto 9001 para evitar conflictos con Flask (9000)
# Modificado para usar 127.0.0.1 directamente y el puerto correcto 9001 por defecto
DOCKER_MANAGER_URL = os.getenv("DOCKER_MANAGER_URL", "http://127.0.0.1:9001").replace("localhost", "127.0.0.1")
GEMINI_API_KEY = os.getenv("GOOGLE_API_KEY")

# Inicialización del cliente de Google Genai
client = genai.Client(api_key=GEMINI_API_KEY)

# --- Modelos de datos y tipos ---

class ActionStatus(str, Enum):
    SUCCESS = "success"
    FAILURE = "failure"
    WAITING = "waiting"


class FunctionResult(BaseModel):
    status: ActionStatus
    result: Any
    message: str = ""


class AgentTask(BaseModel):
    id: str
    description: str
    plan: List[str] = []
    current_step: int = 0
    status: str = "pending"
    conversation_history: List[Dict[str, Any]] = []
    

# --- Funciones para interactuar con Docker Manager ---

def run_command_in_docker(command: str) -> FunctionResult:
    """Ejecuta un comando en el contenedor Docker.
    
    Args:
        command: El comando a ejecutar en el contenedor
    """
    try:
        response = requests.post(
            f"{DOCKER_MANAGER_URL}/run",
            data={"command": command}
        )
        
        if response.status_code == 200:
            return FunctionResult(
                status=ActionStatus.SUCCESS,
                result=response.text,
                message=f"Comando ejecutado exitosamente: {command}"
            )
        else:
            return FunctionResult(
                status=ActionStatus.FAILURE,
                result=None,
                message=f"Error al ejecutar comando: {response.status_code} - {response.text}"
            )
    except Exception as e:
        log.error(f"Error en run_command_in_docker: {e}")
        return FunctionResult(
            status=ActionStatus.FAILURE,
            result=None,
            message=f"Error en la solicitud: {str(e)}"
        )


def get_docker_status() -> FunctionResult:
    """Obtiene el estado actual del contenedor Docker."""
    try:
        response = requests.get(f"{DOCKER_MANAGER_URL}/status")
        
        if response.status_code == 200:
            return FunctionResult(
                status=ActionStatus.SUCCESS,
                result=response.json(),
                message="Estado del contenedor obtenido exitosamente"
            )
        else:
            return FunctionResult(
                status=ActionStatus.FAILURE,
                result=None,
                message=f"Error al obtener estado: {response.status_code} - {response.text}"
            )
    except Exception as e:
        log.error(f"Error en get_docker_status: {e}")
        return FunctionResult(
            status=ActionStatus.FAILURE,
            result=None,
            message=f"Error en la solicitud: {str(e)}"
        )


def create_file_in_docker(file_content: str, file_path: str) -> FunctionResult:
    """Crea un archivo con el contenido especificado en el contenedor Docker.
    
    Args:
        file_content: Contenido del archivo a crear
        file_path: Ruta del archivo en el contenedor (incluido el nombre)
    """
    try:
        # Primero creamos un archivo temporal local
        import tempfile
        with tempfile.NamedTemporaryFile(delete=False, mode='w+') as temp_file:
            temp_file.write(file_content)
            temp_path = temp_file.name
        
        # Luego lo subimos al contenedor
        with open(temp_path, 'rb') as f:
            files = {'file': f}
            data = {'container_path': file_path}
            response = requests.post(
                f"{DOCKER_MANAGER_URL}/copy_to",
                files=files,
                data=data
            )
        
        # Eliminamos el archivo temporal
        os.unlink(temp_path)
        
        if response.status_code == 200:
            return FunctionResult(
                status=ActionStatus.SUCCESS,
                result=response.json(),
                message=f"Archivo creado exitosamente en {file_path}"
            )
        else:
            return FunctionResult(
                status=ActionStatus.FAILURE,
                result=None,
                message=f"Error al crear archivo: {response.status_code} - {response.text}"
            )
    except Exception as e:
        log.error(f"Error en create_file_in_docker: {e}")
        return FunctionResult(
            status=ActionStatus.FAILURE,
            result=None,
            message=f"Error al crear archivo: {str(e)}"
        )


def install_package_in_docker(package_name: str) -> FunctionResult:
    """Instala un paquete en el contenedor Docker.
    
    Args:
        package_name: Nombre del paquete a instalar
    """
    try:
        # Verificar si estamos en un contenedor Ubuntu (apt) o Alpine (apk)
        check_cmd = "if command -v apt-get > /dev/null; then echo 'apt'; elif command -v apk > /dev/null; then echo 'apk'; else echo 'unknown'; fi"
        pkg_manager_result = run_command_in_docker(check_cmd)
        
        if pkg_manager_result.status != ActionStatus.SUCCESS:
            return FunctionResult(
                status=ActionStatus.FAILURE,
                result=None,
                message="No se pudo determinar el gestor de paquetes"
            )
        
        pkg_manager = pkg_manager_result.result.strip()
        
        if pkg_manager == "apt":
            install_cmd = f"apt-get update && apt-get install -y {package_name}"
        elif pkg_manager == "apk":
            install_cmd = f"apk update && apk add {package_name}"
        else:
            return FunctionResult(
                status=ActionStatus.FAILURE,
                result=None,
                message="Gestor de paquetes no soportado"
            )
        
        return run_command_in_docker(install_cmd)
    except Exception as e:
        log.error(f"Error en install_package_in_docker: {e}")
        return FunctionResult(
            status=ActionStatus.FAILURE,
            result=None,
            message=f"Error al instalar paquete: {str(e)}"
        )


def web_search(search_query: str) -> FunctionResult:
    """Realiza una búsqueda web simulada para obtener información.
    
    Args:
        search_query: El término de búsqueda
    """
    # En una implementación real, se conectaría a una API de búsqueda
    # Como es una simulación, devolvemos un resultado estático
    return FunctionResult(
        status=ActionStatus.SUCCESS,
        result=f"Resultados de búsqueda para: {search_query}",
        message="Búsqueda simulada exitosa"
    )


def create_checkpoint(name: Optional[str] = None) -> FunctionResult:
    """Crea un checkpoint del estado actual del contenedor.
    
    Args:
        name: Nombre opcional para el checkpoint
    """
    try:
        data = {}
        if name:
            data["name"] = name
        
        response = requests.post(
            f"{DOCKER_MANAGER_URL}/checkpoint",
            data=data
        )
        
        if response.status_code == 200:
            return FunctionResult(
                status=ActionStatus.SUCCESS,
                result=response.json(),
                message=f"Checkpoint creado exitosamente" + (f" con nombre {name}" if name else "")
            )
        else:
            return FunctionResult(
                status=ActionStatus.FAILURE,
                result=None,
                message=f"Error al crear checkpoint: {response.status_code} - {response.text}"
            )
    except Exception as e:
        log.error(f"Error en create_checkpoint: {e}")
        return FunctionResult(
            status=ActionStatus.FAILURE,
            result=None,
            message=f"Error al crear checkpoint: {str(e)}"
        )


def restore_checkpoint(checkpoint_name: str) -> FunctionResult:
    """Restaura un checkpoint previo.
    
    Args:
        checkpoint_name: Nombre del checkpoint a restaurar
    """
    try:
        response = requests.post(
            f"{DOCKER_MANAGER_URL}/restore",
            data={"checkpoint_name": checkpoint_name}
        )
        
        if response.status_code == 200:
            return FunctionResult(
                status=ActionStatus.SUCCESS,
                result=response.json(),
                message=f"Checkpoint {checkpoint_name} restaurado exitosamente"
            )
        else:
            return FunctionResult(
                status=ActionStatus.FAILURE,
                result=None,
                message=f"Error al restaurar checkpoint: {response.status_code} - {response.text}"
            )
    except Exception as e:
        log.error(f"Error en restore_checkpoint: {e}")
        return FunctionResult(
            status=ActionStatus.FAILURE,
            result=None,
            message=f"Error al restaurar checkpoint: {str(e)}"
        )


def analyze_content(content: str, context: str) -> FunctionResult:
    """Analiza un contenido usando Gemini para verificar si cumple con lo esperado.
    
    Args:
        content: El contenido a analizar (por ejemplo, contenido de un archivo)
        context: Contexto de la tarea o instrucciones de verificación
    """
    try:
        # Crear la consulta para Gemini
        prompt = f"""
        Por favor, analiza el siguiente contenido y verifica si cumple con los requisitos especificados.
        
        CONTEXTO/TAREA: {context}
        
        CONTENIDO A ANALIZAR:
        ```
        {content}
        ```
        
        Por favor, proporciona:
        1. Un análisis detallado del contenido
        2. Verificación de que cumple con los requisitos
        3. Cualquier error o mejora posible
        4. Una conclusión clara sobre si el contenido es correcto y completo
        """
        
        # Enviar la consulta a Gemini
        response = client.models.generate_content(
            model="gemini-2.0-flash-001",
            contents=types.Content(
                role="user",
                parts=[types.Part(text=prompt)]
            ),
            config=types.GenerateContentConfig(temperature=0.2)
        )
        
        # Retornar el resultado
        return FunctionResult(
            status=ActionStatus.SUCCESS,
            result=response.text,
            message="Análisis de contenido completado"
        )
    except Exception as e:
        log.error(f"Error en analyze_content: {e}")
        return FunctionResult(
            status=ActionStatus.FAILURE,
            result=None,
            message=f"Error en el análisis de contenido: {str(e)}"
        )


# --- Clase Agent ---

class GeminiAgent:
    def __init__(self, model_name="gemini-2.0-flash-001"):
        """Inicializa un agente basado en Gemini.
        
        Args:
            model_name: Nombre del modelo a utilizar
        """
        self.model_name = model_name
        self.tools = [
            run_command_in_docker,
            get_docker_status,
            create_file_in_docker,
            install_package_in_docker,
            web_search,
            create_checkpoint,
            restore_checkpoint,
            analyze_content,
        ]
        self.current_task = None
        self.conversation_history = []
    
    def _add_to_history(self, role, content):
        """Añade un mensaje al historial de conversación."""
        self.conversation_history.append({
            "role": role,
            "content": content
        })
    
    def generate_plan(self, task_description: str) -> List[Dict[str, Any]]:
        """Genera un plan para completar la tarea usando function calling.
        
        Args:
            task_description: Descripción de la tarea
        
        Returns:
            List[Dict[str, Any]]: Lista de pasos del plan en formato estructurado
        """
        system_prompt = """
        Eres un asistente especializado en planificación de tareas dentro de contenedores Docker. 
        Tu objetivo es crear planes paso a paso detallados y concretos.
        
        IMPORTANTE: NO debes crear nuevos contenedores Docker, ni construir imágenes. 
        Ya existe un contenedor gestionado por Docker Manager con el que debes trabajar.
        
        Las tareas deben ejecutarse dentro del contenedor existente usando 'run_command_in_docker'.
        Para crear archivos usa 'create_file_in_docker'.
        
        IMPORTANTE SOBRE RUTAS DE ARCHIVO:
        - Si NO especificas una ruta absoluta, los archivos se crearán en la raíz del contenedor (/)
        - Usa rutas absolutas siempre que sea posible (/workspace/archivo.txt)
        - El directorio principal de trabajo es /workspace
        
        Cada paso debe ser una acción concreta y específica, enfocada en completar exactamente la tarea solicitada
        dentro del contenedor Docker existente. No añadas pasos innecesarios.
        """
        
        # Definir la declaración de la función para crear un plan
        create_plan_function = {
            "name": "create_docker_task_plan",
            "description": "Crea un plan de pasos detallado para ejecutar una tarea dentro de un contenedor Docker existente.",
            "parameters": {
                "type": "object",
                "properties": {
                    "pasos": {
                        "type": "array",
                        "description": "Lista de pasos ordenados para completar la tarea.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "numero": {
                                    "type": "integer",
                                    "description": "Número de orden del paso."
                                },
                                "titulo": {
                                    "type": "string",
                                    "description": "Título corto y descriptivo para el paso."
                                },
                                "descripcion": {
                                    "type": "string",
                                    "description": "Descripción detallada del paso, incluyendo comandos a ejecutar."
                                }
                            },
                            "required": ["numero", "titulo", "descripcion"]
                        }
                    }
                },
                "required": ["pasos"]
            }
        }
        
        # Configurar herramientas y parámetros para la llamada a la API
        tools = types.Tool(function_declarations=[create_plan_function])
        config = types.GenerateContentConfig(
            system_instruction=system_prompt,
            temperature=0.2,
            tools=[tools],
            tool_config=types.ToolConfig(
                function_calling_config=types.FunctionCallingConfig(
                    mode="ANY",  # Forzar el uso de la función
                    allowed_function_names=["create_docker_task_plan"]
                )
            )
        )
        
        user_prompt = f"""
        Crea un plan simple y directo para realizar la siguiente tarea en el contenedor Docker existente:
        
        {task_description}
        
        IMPORTANTE: Ten en cuenta estas restricciones:
        
        1. NO menciones construir o iniciar contenedores, ya existe uno en ejecución con el que debes trabajar.
        2. NO uses comandos Docker como 'docker build', 'docker run', etc.
        3. Para ejecutar comandos usa la función 'run_command_in_docker()'
        4. Para crear archivos usa la función 'create_file_in_docker()'
        5. Céntrate en pasos prácticos y concretos para completar la tarea.
        6. Usa SIEMPRE rutas absolutas comenzando con / para evitar confusiones.
        7. El directorio principal de trabajo es /workspace
        8. NUNCA añadas pasos para generar reportes o documentación innecesaria.
        9. IMPORTANTE: No necesito que generes el reporte final como el último paso, enfócate solo en la tarea requerida.
        """
        
        try:
            # Llamar a la API con function calling
            response = client.models.generate_content(
                model=self.model_name,
                contents=user_prompt,
                config=config
            )
            
            # Verificar si hay una llamada a función en la respuesta
            if hasattr(response.candidates[0].content.parts[0], 'function_call'):
                function_call = response.candidates[0].content.parts[0].function_call
                
                # Verificar que la función llamada sea la correcta
                if function_call.name == "create_docker_task_plan":
                    # Extraer los pasos de los argumentos de la llamada a función
                    plan_data = function_call.args
                    
                    if "pasos" in plan_data and isinstance(plan_data["pasos"], list):
                        # Convertir a formato diccionario para uso en el frontend
                        structured_steps = []
                        for paso in plan_data["pasos"]:
                            step = {
                                "numero": paso.get("numero", 0),
                                "titulo": paso.get("titulo", "Paso"),
                                "descripcion": paso.get("descripcion", "")
                            }
                            structured_steps.append(step)
                        
                        return structured_steps
            
            # Si no se pudo obtener una respuesta estructurada mediante function calling
            log.warning("No se pudo obtener un plan estructurado mediante function calling")
            return self._extraer_pasos_texto(response.text)
                
        except Exception as e:
            log.error(f"Error al generar plan: {e}")
            return self._crear_plan_basico()
            
    def _crear_plan_basico(self) -> List[Dict[str, Any]]:
        """Crea un plan básico para casos de error."""
        return [
            {"numero": 1, "titulo": "Analizar el entorno", "descripcion": "Examinar el estado actual del contenedor Docker"}, 
            {"numero": 2, "titulo": "Ejecutar la tarea", "descripcion": "Completar la acción solicitada por el usuario"}, 
            {"numero": 3, "titulo": "Verificar resultados", "descripcion": "Comprobar que la tarea se ha completado correctamente"}
        ]
    
    def _extraer_pasos_texto(self, texto: str) -> List[Dict[str, Any]]:
        """Extrae pasos de un texto plano cuando falla la extracción de JSON."""
        import re
        steps = []
        
        # Buscar líneas que parezcan pasos numerados
        step_matches = re.findall(r'\d+\.\s+(.+?)(?=\n\d+\.|$)', texto, re.DOTALL)
        
        for i, content in enumerate(step_matches, 1):
            content = content.strip()
            # Intentar extraer un título del contenido (primera oración o primeros 50 caracteres)
            title_match = re.match(r'^([^.\n]{5,50})[.:]', content)
            
            if title_match:
                title = title_match.group(1).strip()
                description = content[len(title_match.group(0)):].strip()
            else:
                # Si no hay un título claro, usar los primeros 40 caracteres
                title = content[:40].strip()
                if len(content) > 40:
                    title += "..."
                description = content
            
            step = {
                "numero": i,
                "titulo": title,
                "descripcion": description
            }
            
            steps.append(step)
        
        return steps if steps else self._crear_plan_basico()
        
    def create_task(self, task_description: str) -> AgentTask:
        """Crea una nueva tarea para el agente.
        
        Args:
            task_description: Descripción de la tarea a realizar
        
        Returns:
            AgentTask: La tarea creada
        """
        import uuid
        task_id = str(uuid.uuid4())
        
        self.current_task = AgentTask(
            id=task_id,
            description=task_description,
            status="planning"
        )
        
        # Generar un plan para la tarea
        plan = self.generate_plan(task_description)
        self.current_task.plan = plan
        
        return self.current_task
    
    def execute_plan_step(self, step_index: int = None, user_feedback: str = None) -> Dict[str, Any]:
        """Ejecuta un paso específico del plan o el siguiente paso pendiente.
        
        Args:
            step_index: Índice del paso a ejecutar (opcional)
            user_feedback: Retroalimentación del usuario sobre el paso anterior (opcional)
        
        Returns:
            Dict: Resultado de la ejecución del paso
        """
        if not self.current_task:
            return {
                "status": "error",
                "message": "No hay una tarea activa. Crea una tarea primero."
            }
        
        # Si se proporciona retroalimentación del usuario, añadirla al historial
        if user_feedback:
            self._add_to_history("user", user_feedback)
        
        # Determinar el paso a ejecutar
        if step_index is not None:
            if step_index < 0 or step_index >= len(self.current_task.plan):
                return {
                    "status": "error",
                    "message": f"Índice de paso inválido: {step_index}. El plan tiene {len(self.current_task.plan)} pasos."
                }
            self.current_task.current_step = step_index
        
        # Verificar si ya se completaron todos los pasos
        if self.current_task.current_step >= len(self.current_task.plan):
            self.current_task.status = "completed"
            return {
                "status": "completed",
                "message": "Todos los pasos del plan han sido completados.",
                "task": self.current_task
            }
        
        # Obtener el paso actual
        current_step_description = self.current_task.plan[self.current_task.current_step]
        
        # Verificar si es el último paso (verificación/reporte)
        is_last_step = self.current_task.current_step == len(self.current_task.plan) - 1
        
        # Preparar el mensaje para el modelo
        system_prompt = """
        Eres un agente autónomo especializado en realizar tareas utilizando un contenedor Docker que YA EXISTE.
        
        IMPORTANTE: 
        1. NO debes crear nuevos contenedores Docker, ni construir imágenes.
        2. Ya existe un contenedor gestionado por Docker Manager al que tienes acceso directo.
        3. El contenedor ya está corriendo, no necesitas iniciarlo.
        4. No intentes instalar Docker, ya está instalado y funcionando.
        
        RUTAS DE ARCHIVO:
        1. Si no especificas una ruta absoluta, los archivos se crearán/accederán en la raíz (/)
        2. Siempre usa rutas absolutas comenzando con / para evitar confusiones
        3. El directorio de trabajo recomendado es /workspace
        
        Para interactuar con el contenedor Docker existente, usa las siguientes funciones:
        
        1. run_command_in_docker(command: str) - Ejecuta un comando directamente en el contenedor existente
        2. get_docker_status() - Obtiene el estado actual del contenedor
        3. create_file_in_docker(file_content: str, file_path: str) - Crea un archivo en el contenedor
        4. install_package_in_docker(package_name: str) - Instala un paquete en el contenedor
        5. web_search(search_query: str) - Realiza una búsqueda web para obtener información
        6. create_checkpoint(name: str = None) - Crea un checkpoint del estado actual
        7. restore_checkpoint(checkpoint_name: str) - Restaura un checkpoint previo
        8. analyze_content(content: str, context: str) - Analiza contenido usando Gemini para verificar si cumple con lo esperado
        
        Analiza el paso actual del plan y utiliza la función más apropiada para realizar la acción necesaria.
        NO intentes ejecutar comandos que usen Docker directamente como 'docker build', 'docker run', etc.
        """
        
        # Si es el último paso (verificación/reporte), añadir instrucciones específicas
        if is_last_step:
            system_prompt += """
            INSTRUCCIONES PARA VERIFICACIÓN Y REPORTE FINAL:
            
            1. Verifica primero si los archivos necesarios existen usando comandos como 'ls -la'
            2. Examina el contenido de los archivos generados usando comandos como 'cat'
            3. Comprueba que el contenido coincide con lo esperado
            4. Genera un reporte completo que incluya:
               - Resumen de la tarea realizada
               - Análisis del contenido de los archivos generados
               - Confirmación de que la tarea se ha completado con éxito
               - Sugerencias o mejoras posibles (si aplica)
            
            El reporte debe ser detallado pero conciso, proporcionando una visión clara 
            del resultado y validando que se han cumplido los requisitos de la tarea.
            """
        
        # Construir el mensaje del usuario con el contexto de la tarea y el paso actual
        task_context = f"""
        TAREA: {self.current_task.description}
        
        PLAN:
        {chr(10).join([f"{i+1}. {step}" for i, step in enumerate(self.current_task.plan)])}
        
        PASO ACTUAL ({self.current_task.current_step + 1}/{len(self.current_task.plan)}):
        {current_step_description}
        
        Por favor, realiza este paso utilizando las funciones disponibles.
        """
        
        try:
            # Generar la respuesta utilizando function calling
            response = client.models.generate_content(
                model=self.model_name,
                contents=task_context,
                config=types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    temperature=0.2,
                    tools=self.tools,
                )
            )
            
            # Si hay una llamada a función, ejecutarla
            if response.function_calls:
                function_call = response.function_calls[0]
                function_name = function_call.name
                function_args = function_call.args
                
                # Encontrar la función en las herramientas
                for tool in self.tools:
                    if tool.__name__ == function_name:
                        # Ejecutar la función con los argumentos
                        result = tool(**function_args)
                        
                        # Registrar el resultado en el historial
                        self._add_to_history(
                            "function", 
                            {
                                "name": function_name,
                                "args": function_args,
                                "result": result.dict() if hasattr(result, "dict") else str(result)
                            }
                        )
                        
                        # Actualizar el estado de la tarea
                        self.current_task.current_step += 1
                        
                        return {
                            "status": "success",
                            "step_index": self.current_task.current_step - 1,
                            "step_description": current_step_description,
                            "function_called": function_name,
                            "function_args": function_args,
                            "result": result.dict() if hasattr(result, "dict") else str(result),
                            "next_step": self.current_task.plan[self.current_task.current_step] if self.current_task.current_step < len(self.current_task.plan) else None,
                            "task_status": "in_progress" if self.current_task.current_step < len(self.current_task.plan) else "completed"
                        }
            
            # Si no hay llamada a función, devolver el texto de respuesta
            self._add_to_history("assistant", response.text)
            
            return {
                "status": "waiting_for_input",
                "step_index": self.current_task.current_step,
                "step_description": current_step_description,
                "message": response.text,
                "task_status": "waiting_for_input"
            }
            
        except Exception as e:
            log.error(f"Error al ejecutar paso del plan: {e}")
            return {
                "status": "error",
                "step_index": self.current_task.current_step,
                "step_description": current_step_description,
                "message": f"Error al ejecutar paso: {str(e)}",
                "task_status": "error"
            }


# --- Ejemplo de uso ---

if __name__ == "__main__":
    # Verificar si se ha configurado la API key
    if not GEMINI_API_KEY:
        print("ERROR: No se ha configurado la API key de Google Genai. Configura la variable de entorno GOOGLE_API_KEY.")
        exit(1)
    
    # Crear un agente
    agent = GeminiAgent()
    
    # Crear una tarea
    task_description = "Crea un servidor web simple en Python utilizando Flask que muestre un mensaje de bienvenida"
    task = agent.create_task(task_description)
    
    print(f"Tarea creada: {task.id}")
    print("Plan generado:")
    for i, step in enumerate(task.plan):
        print(f"{i+1}. {step}")
    
    # Ejecutar los pasos del plan (en un caso real, se esperaría la validación del usuario entre pasos)
    while task.current_step < len(task.plan):
        print(f"\nEjecutando paso {task.current_step + 1}: {task.plan[task.current_step]}")
        result = agent.execute_plan_step()
        
        print(f"Resultado: {result['status']}")
        if 'function_called' in result:
            print(f"Función llamada: {result['function_called']}")
            print(f"Argumentos: {result['function_args']}")
            print(f"Resultado: {result['result']}")
        elif 'message' in result:
            print(f"Mensaje: {result['message']}")
        
        # En una aplicación real, aquí se pediría confirmación al usuario
        input("Presiona Enter para continuar con el siguiente paso...")
    
    print("\nTarea completada!") 