"""
Módulo para manejar la ejecución estructurada de pasos del plan utilizando Gemini API.
Este archivo complementa la implementación principal del agente con funcionalidades 
de respuestas estructuradas y mejor contexto para la ejecución de pasos.
"""

import os
import logging
import json
import uuid
from typing import Dict, List, Any, Optional, Union
from pydantic import BaseModel

import google.generativeai as genai
from google.ai import generativelanguage as glm
from google.generativeai import types

# Configurar logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
log = logging.getLogger(__name__)

# Esquema para la respuesta estructurada
class StepActionResult(BaseModel):
    """Modelo para la respuesta estructurada de la API de Gemini."""
    action_type: str  # Tipo de acción: command, file_creation, package_install, etc.
    function_name: str  # Nombre de la función a llamar
    function_args: Dict[str, Any]  # Argumentos para la función
    reasoning: str  # Razonamiento detrás de la acción
    expected_outcome: str  # Resultado esperado de la acción

class StructuredGeminiAgent:
    """Extensión para ejecutar pasos con Gemini usando respuestas estructuradas JSON."""
    
    @staticmethod
    def enhance_execution_context(task, current_step_index, conversation_history, tools_info=None):
        """
        Mejora el contexto para la ejecución de un paso, incluyendo información de pasos 
        anteriores y futuros.
        
        Args:
            task: La tarea actual con su plan
            current_step_index: Índice del paso actual
            conversation_history: Historial de la conversación para referencia
            tools_info: Información sobre las herramientas disponibles
            
        Returns:
            tuple: (task_context, system_prompt)
        """
        # Obtener el paso actual
        current_step_description = task.plan[current_step_index]
        
        # Verificar si es el último paso (verificación/reporte)
        is_last_step = current_step_index == len(task.plan) - 1
        
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
            """
        
        # Generar contexto enriquecido con información de pasos anteriores y futuros
        # =====================================================================
        
        # Generar contexto de pasos anteriores ya ejecutados (si existen)
        previous_steps_context = ""
        if current_step_index > 0:
            previous_steps_context = "\nPASOS COMPLETADOS ANTERIORMENTE:\n"
            for i in range(current_step_index):
                step_info = task.plan[i]
                step_title = step_info.get('titulo', f"Paso {i+1}") if isinstance(step_info, dict) else f"Paso {i+1}"
                step_desc = step_info.get('descripcion', str(step_info)) if isinstance(step_info, dict) else str(step_info)
                
                # Buscar en el historial información sobre cómo se ejecutó este paso
                step_execution_info = ""
                for entry in reversed(conversation_history):
                    if entry['role'] == 'function' and entry.get('content', {}).get('name', '') == 'run_command_in_docker':
                        step_execution_info = f"Comando ejecutado: {entry['content'].get('args', {}).get('command', 'N/A')}\n"
                        step_execution_info += f"Resultado: {str(entry['content'].get('result', 'N/A'))[:200]}..."
                        break
                
                previous_steps_context += f"{i+1}. {step_title}\n   {step_desc}\n   {step_execution_info}\n"
        
        # Generar contexto de pasos futuros (si existen)
        future_steps_context = ""
        if current_step_index < len(task.plan) - 1:
            future_steps_context = "\nPASOS PENDIENTES DESPUÉS DE ESTE:\n"
            for i in range(current_step_index + 1, len(task.plan)):
                step_info = task.plan[i]
                step_title = step_info.get('titulo', f"Paso {i+1}") if isinstance(step_info, dict) else f"Paso {i+1}"
                step_desc = step_info.get('descripcion', str(step_info)) if isinstance(step_info, dict) else str(step_info)
                future_steps_context += f"{i+1}. {step_title}\n   {step_desc}\n"
                
        # Construir el mensaje con el contexto completo
        current_step_title = current_step_description.get('titulo', '') if isinstance(current_step_description, dict) else f"Paso {current_step_index + 1}"
        current_step_desc = current_step_description.get('descripcion', current_step_description) if isinstance(current_step_description, dict) else current_step_description
        
        task_context = f"""
        TAREA ACTUAL: {task.description}
        
        PLAN COMPLETO:
        {chr(10).join([f"{i+1}. {step.get('titulo', step) if isinstance(step, dict) else step}" for i, step in enumerate(task.plan)])}
        {previous_steps_context}
        PASO ACTUAL ({current_step_index + 1}/{len(task.plan)}):
        {current_step_title}  
        {current_step_desc}
        {future_steps_context}
        
        Por favor, realiza el PASO ACTUAL utilizando las funciones disponibles.
        Planifica considerando los pasos futuros para que tu implementación sea compatible con ellos.
        """
        
        return task_context, system_prompt
    
    @staticmethod
    def execute_with_structured_output(model_name, task_context, system_prompt, tools, api_key=None, client=None):
        """
        Ejecuta un paso utilizando la API de Gemini con respuesta estructurada.
        
        Args:
            model_name: Nombre del modelo de Gemini a utilizar
            task_context: Contexto de la tarea para el modelo
            system_prompt: Instrucción del sistema para el modelo
            tools: Lista de herramientas disponibles para el agente
            api_key: Clave API de Gemini (opcional si se proporciona client)
            client: Cliente de Gemini ya inicializado (opcional)
            
        Returns:
            dict: Resultado estructurado de la ejecución del paso con:
                - status: success, error, etc.
                - function_call: información sobre la función llamada (si existe)
                - reasoning: razonamiento detrás de la acción
                - expected_outcome: resultado esperado
                - result: resultado de la ejecución (si corresponde)
        """
        try:
            # Usar el cliente proporcionado o crear uno nuevo
            if client is None:
                if api_key is None:
                    api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
                if not api_key:
                    raise ValueError("Se requiere API key para Gemini")
                client = genai.Client(api_key=api_key)
            
            # Configurar la solicitud para obtener respuesta estructurada
            response = client.models.generate_content(
                model=model_name,
                contents=task_context,
                config=types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    temperature=0.2,
                    response_mime_type="application/json",
                    response_schema=StepActionResult,
                )
            )

            # Intentar extraer la respuesta estructurada
            if hasattr(response, 'parsed') and response.parsed:
                action_data = response.parsed
                log.info(f"Respuesta estructurada obtenida correctamente: {action_data}")
                
                return {
                    "status": "structured_response",
                    "action_data": {
                        "action_type": action_data.action_type,
                        "function_name": action_data.function_name, 
                        "function_args": action_data.function_args,
                        "reasoning": action_data.reasoning,
                        "expected_outcome": action_data.expected_outcome
                    }
                }
            
            # Intentar extraer function calls si la respuesta estructurada no está disponible
            log.warning("Respuesta estructurada no disponible, verificando function calls")
            if hasattr(response, 'function_calls') and response.function_calls:
                function_call = response.function_calls[0]
                return {
                    "status": "function_call",
                    "function_call": {
                        "name": function_call.name,
                        "args": function_call.args
                    }
                }
            
            # Si no hay ninguna forma de extraer información estructurada, devolver el texto
            log.warning("No se pudo obtener respuesta estructurada ni function calls")
            return {
                "status": "text_response",
                "text": response.text,
                "message": "No se pudo obtener una estructura para la respuesta"
            }
                
        except Exception as e:
            log.error(f"Error al generar respuesta estructurada: {e}")
            return {
                "status": "error",
                "message": f"Error al generar respuesta estructurada: {str(e)}"
            }
            
    @staticmethod
    def execute_step(task, step_index, tools, conversation_history, model_name="gemini-2.0-flash", client=None):
        """
        Ejecuta un paso específico del plan con contexto enriquecido y respuesta estructurada.
        
        Args:
            task: La tarea actual con su plan
            step_index: Índice del paso a ejecutar
            tools: Lista de herramientas disponibles
            conversation_history: Historial de la conversación
            model_name: Nombre del modelo a utilizar
            client: Cliente de Gemini (opcional)
            
        Returns:
            Dict: Resultado de la ejecución del paso
        """
        # Generar contexto enriquecido para el paso
        task_context, system_prompt = StructuredGeminiAgent.enhance_execution_context(
            task, step_index, conversation_history
        )
        
        # Ejecutar el paso con output estructurado
        execution_result = StructuredGeminiAgent.execute_with_structured_output(
            model_name, task_context, system_prompt, tools, client=client
        )
        
        if execution_result["status"] == "structured_response":
            # Encontrar y ejecutar la función correspondiente
            action_data = execution_result["action_data"]
            function_name = action_data["function_name"]
            function_args = action_data["function_args"]
            
            # Buscar la función entre las herramientas disponibles
            for tool in tools:
                if tool.__name__ == function_name:
                    try:
                        # Ejecutar la función
                        result = tool(**function_args)
                        
                        # Procesar el resultado
                        return {
                            "status": "success",
                            "step_index": step_index,
                            "function_called": function_name,
                            "function_args": function_args,
                            "reasoning": action_data["reasoning"],
                            "expected_outcome": action_data["expected_outcome"],
                            "result": result.dict() if hasattr(result, "dict") else str(result),
                            "execution_complete": True
                        }
                    except Exception as e:
                        return {
                            "status": "error",
                            "step_index": step_index,
                            "message": f"Error al ejecutar la función {function_name}: {str(e)}",
                            "execution_complete": False
                        }
            
            # Si no se encuentra la función
            return {
                "status": "error",
                "step_index": step_index,
                "message": f"Función {function_name} no encontrada entre las herramientas disponibles",
                "execution_complete": False
            }
        
        elif execution_result["status"] == "function_call":
            # Procesar función llamada a través del mecanismo tradicional
            function_call = execution_result["function_call"]
            function_name = function_call["name"]
            function_args = function_call["args"]
            
            # Buscar la función entre las herramientas disponibles
            for tool in tools:
                if tool.__name__ == function_name:
                    try:
                        # Ejecutar la función
                        result = tool(**function_args)
                        
                        # Procesar el resultado
                        return {
                            "status": "success",
                            "step_index": step_index,
                            "function_called": function_name,
                            "function_args": function_args,
                            "result": result.dict() if hasattr(result, "dict") else str(result),
                            "execution_complete": True
                        }
                    except Exception as e:
                        return {
                            "status": "error",
                            "step_index": step_index,
                            "message": f"Error al ejecutar la función {function_name}: {str(e)}",
                            "execution_complete": False
                        }
            
            # Si no se encuentra la función
            return {
                "status": "error",
                "step_index": step_index,
                "message": f"Función {function_name} no encontrada entre las herramientas disponibles",
                "execution_complete": False
            }
        
        elif execution_result["status"] == "text_response":
            # Devolver respuesta de texto cuando no se pudo obtener estructura
            return {
                "status": "waiting_for_input",
                "step_index": step_index,
                "message": execution_result["text"],
                "execution_complete": False
            }
        
        else:
            # Manejar errores
            return {
                "status": "error",
                "step_index": step_index,
                "message": execution_result.get("message", "Error desconocido al ejecutar el paso"),
                "execution_complete": False
            }
