import os
import json
import time
import uuid
import logging
from typing import List, Dict, Any, Optional, Callable, Union
from fastapi import FastAPI, HTTPException, BackgroundTasks, Depends, Query
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from agent import (
    GeminiAgent, AgentTask, ActionStatus, FunctionResult,
    run_command_in_docker, create_file_in_docker, install_package_in_docker,
    web_search, create_checkpoint, restore_checkpoint, analyze_content,
    search_files_in_docker, search_in_files_docker, edit_file_lines_in_docker,
    edit_file_content_in_docker, edit_file_block_in_docker, chmod_path_in_docker,
    list_files_in_docker, read_file_from_docker, delete_path_in_docker,
    install_dependencies_in_docker, get_container_stats, get_container_logs,
    reset_container
)

# Configuración de logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
log = logging.getLogger(__name__)

# Modelo de Gemini por defecto usando la variable de entorno o un valor predeterminado
DEFAULT_MODEL = os.getenv("DEFAULT_MODEL", "gemini-2.5-flash-preview-04-17")

# Diccionario para almacenar tareas e instanceas de agente
agent_tasks = {}
agent_instances = {}

# Crear la aplicación FastAPI
app = FastAPI(
    title="FlowCode API - Agente Gemini Docker",
    description="API para interactuar con el agente de IA Gemini que gestiona contenedores Docker",
    version="1.1.0",
)

# Configurar CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Permitir todos los orígenes
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Modelos de datos ---
class TaskCreateRequest(BaseModel):
    description: str = Field(..., description="Descripción de la tarea a realizar")
    model: Optional[str] = Field(DEFAULT_MODEL, description="Modelo de Gemini a utilizar")
    auto_execute: Optional[bool] = Field(False, description="Ejecutar automáticamente el primer paso")

class TaskCreateResponse(BaseModel):
    task_id: str = Field(..., description="ID único de la tarea creada")
    description: str = Field(..., description="Descripción de la tarea")
    plan: List[Dict[str, Any]] = Field(..., description="Plan generado para la tarea")
    status: str = Field(..., description="Estado actual de la tarea")
    model: str = Field(..., description="Modelo de Gemini utilizado")

class TaskStepRequest(BaseModel):
    feedback: Optional[str] = Field(None, description="Retroalimentación opcional para el agente")
    auto_recover: Optional[bool] = Field(True, description="Intentar recuperación automática en caso de error")
    max_retries: Optional[int] = Field(3, description="Número máximo de reintentos en caso de error")

class TaskStepResponse(BaseModel):
    task_id: str = Field(..., description="ID de la tarea")
    step_index: int = Field(..., description="Índice del paso ejecutado")
    step_description: Dict[str, Any] = Field(..., description="Descripción del paso ejecutado")
    status: str = Field(..., description="Estado de la ejecución del paso")
    result: Dict[str, Any] = Field(..., description="Resultado detallado de la ejecución")
    next_step: Optional[Dict[str, Any]] = Field(None, description="Descripción del siguiente paso a ejecutar")
    task_status: str = Field(..., description="Estado general de la tarea")
    retries: Optional[int] = Field(0, description="Número de reintentos realizados (si aplica)")
    recovery_strategy: Optional[str] = Field(None, description="Estrategia de recuperación aplicada (si aplica)")

class TaskListResponse(BaseModel):
    tasks: List[Dict[str, Any]] = Field(..., description="Lista de tareas disponibles")

class SearchFilesRequest(BaseModel):
    pattern: str = Field(..., description="Patrón de búsqueda (ej: *.py)")
    base_path: Optional[str] = Field("/workspace", description="Directorio base para la búsqueda")

class SearchInFilesRequest(BaseModel):
    query: str = Field(..., description="Texto a buscar dentro de los archivos")
    base_path: Optional[str] = Field("/workspace", description="Directorio base para la búsqueda")

class EditFileRequest(BaseModel):
    container_path: str = Field(..., description="Ruta del archivo en el contenedor")
    content: Optional[str] = Field(None, description="Nuevo contenido completo (para reemplazo total)")
    start_line: Optional[int] = Field(None, description="Línea inicial a reemplazar (para edición por líneas)")
    end_line: Optional[int] = Field(None, description="Línea final a reemplazar (para edición por líneas)")
    new_content: Optional[str] = Field(None, description="Nuevo contenido para las líneas seleccionadas")
    search_block: Optional[str] = Field(None, description="Bloque de texto a buscar (para edición de bloques)")
    replacement_block: Optional[str] = Field(None, description="Bloque de texto de reemplazo (para edición de bloques)")
    mode: Optional[str] = Field("replace", description="Modo de edición: replace, smart (con manejo de indentación)")

class ChmodRequest(BaseModel):
    container_path: str = Field(..., description="Ruta del archivo o directorio en el contenedor")
    mode: str = Field(..., description="Permisos a aplicar (ej: 755, u+x)")

class InstallDependenciesRequest(BaseModel):
    dependencies_content: str = Field(..., description="Contenido del archivo de dependencias")
    dep_type: str = Field("pip", description="Tipo de dependencias: pip o apt")

# --- Funciones auxiliares ---
async def handle_auto_recovery(agent_instance, result, task_data, max_retries=3):
    """Maneja la recuperación automática en caso de error en la ejecución de un paso."""
    
    step_index = task_data.get("current_step")
    retries = task_data.get("retries", {})
    recovery_strategy = None
    
    # Si el resultado es exitoso, no necesitamos recuperación
    if result.get("status") != "FAILURE" or retries >= max_retries:
        return result, retries, recovery_strategy
    
    log.info(f"Iniciando recuperación automática para la tarea {task_data.get('id')}, paso {step_index}, intento {retries+1}")
    
    # Analizar el error para determinar la estrategia
    error_message = result.get("message", "").lower()
    result_data = result.get("result", {})
    
    # Estrategias de recuperación basadas en patrones de error comunes
    if "no such file or directory" in error_message:
        recovery_strategy = "Creación de directorio o archivo faltante"
        # Intentar crear el directorio si parece faltar
        path_match = re.search(r"'([^']+)'", error_message)
        if path_match:
            path = path_match.group(1)
            dir_path = os.path.dirname(path)
            recovery_prompt = f"El archivo o directorio {path} no existe. Voy a crear el directorio {dir_path} primero y luego reintentar la operación."
        else:
            recovery_prompt = "Se detectó un error de 'archivo o directorio no encontrado'. Crea los directorios necesarios e intenta nuevamente."
    
    elif "permission denied" in error_message:
        recovery_strategy = "Corrección de permisos"
        recovery_prompt = "Hay un problema de permisos. Intenta cambiar los permisos del archivo o directorio relevante con chmod y luego reintentar."
    
    elif "command not found" in error_message:
        recovery_strategy = "Instalación de dependencia"
        # Extraer el comando que falta
        cmd_match = re.search(r"command not found: ([a-zA-Z0-9\-_]+)", error_message)
        command = cmd_match.group(1) if cmd_match else "el comando requerido"
        recovery_prompt = f"El comando '{command}' no está disponible. Intenta instalar el paquete necesario y luego reintentar."
    
    elif "could not find" in error_message or "no module named" in error_message.lower():
        recovery_strategy = "Instalación de dependencia"
        recovery_prompt = "Falta una dependencia o módulo. Instala la dependencia necesaria antes de continuar."
    
    else:
        recovery_strategy = "Diagnóstico general"
        recovery_prompt = "Se ha encontrado un error. Analiza el problema, propón una solución e intenta un enfoque alternativo."
    
    # Ejecutar el paso nuevamente con el contexto de recuperación
    retries += 1
    task_data["retries"] = task_data.get("retries", {})
    task_data["retries"][str(step_index)] = retries
    
    log.info(f"Aplicando estrategia de recuperación: {recovery_strategy}")
    recovery_result = agent_instance.execute_plan_step(step_index, recovery_prompt)
    recovery_result["retries"] = retries
    recovery_result["recovery_strategy"] = recovery_strategy
    
    return recovery_result, retries, recovery_strategy

# --- Endpoints de la API ---
@app.post("/tasks", response_model=TaskCreateResponse, tags=["Tareas"])
async def create_task(task_request: TaskCreateRequest, background_tasks: BackgroundTasks):
    """
    Crea una nueva tarea para el agente.
    
    - **description**: Descripción de la tarea a realizar
    - **model**: (Opcional) Modelo de Gemini a utilizar
    - **auto_execute**: (Opcional) Ejecutar automáticamente el primer paso
    
    Retorna el ID de la tarea y el plan generado.
    """
    
    try:
        agent = GeminiAgent(model_name=task_request.model)
        task = agent.create_task(task_request.description)
        
        # Convertir el plan a una lista de diccionarios
        plan_dict = []
        for idx, step in enumerate(task.plan):
            if isinstance(step, dict):
                step_dict = step
            else:
                step_dict = {"step": step}
            step_dict["step_index"] = idx
            plan_dict.append(step_dict)
        
        # Guardar la tarea y el agente para su uso posterior
        agent_tasks[task.id] = {
            "id": task.id,
            "description": task.description,
            "plan": plan_dict,
            "current_step": 0,
            "status": "pending",
            "model": task_request.model,
            "conversation_history": task.conversation_history,
            "created_at": time.time()
        }
        agent_instances[task.id] = agent
        
        # Si auto_execute es True, ejecutar el primer paso en segundo plano
        if task_request.auto_execute:
            background_tasks.add_task(
                lambda: agent_instances[task.id].execute_plan_step(0)
            )
        
        return {
            "task_id": task.id,
            "description": task.description,
            "plan": plan_dict,
            "status": "pending",
            "model": task_request.model
        }
    
    except Exception as e:
        log.error(f"Error al crear tarea: {e}")
        raise HTTPException(status_code=500, detail=f"Error al crear tarea: {str(e)}")

@app.get("/tasks", response_model=TaskListResponse, tags=["Tareas"])
async def list_tasks():
    """
    Lista todas las tareas disponibles.
    
    Retorna una lista de tareas con sus detalles básicos.
    """
    
    tasks_list = []
    for task_id, task_data in agent_tasks.items():
        tasks_list.append({
            "task_id": task_id,
            "description": task_data.get("description", ""),
            "status": task_data.get("status", "unknown"),
            "current_step": task_data.get("current_step", 0),
            "total_steps": len(task_data.get("plan", [])),
            "model": task_data.get("model", DEFAULT_MODEL),
            "created_at": task_data.get("created_at", 0)
        })
    
    # Ordenar por fecha de creación (más reciente primero)
    tasks_list.sort(key=lambda x: x.get("created_at", 0), reverse=True)
    
    return {"tasks": tasks_list}

@app.get("/tasks/{task_id}", tags=["Tareas"])
async def get_task(task_id: str):
    """
    Obtiene los detalles de una tarea específica.
    
    - **task_id**: ID de la tarea
    
    Retorna todos los detalles de la tarea, incluyendo su plan y estado actual.
    """
    
    if task_id not in agent_tasks:
        raise HTTPException(status_code=404, detail=f"Tarea {task_id} no encontrada")
    
    task_data = agent_tasks[task_id]
    
    # Obtener información adicional del estado actual
    current_step = task_data.get("current_step", 0)
    total_steps = len(task_data.get("plan", []))
    progress = int((current_step / total_steps) * 100) if total_steps > 0 else 0
    
    response = {
        "task_id": task_id,
        "description": task_data.get("description", ""),
        "plan": task_data.get("plan", []),
        "current_step": current_step,
        "total_steps": total_steps,
        "progress": progress,
        "status": task_data.get("status", "unknown"),
        "model": task_data.get("model", DEFAULT_MODEL),
        "created_at": task_data.get("created_at", 0),
        "conversation_history": [
            {
                "role": entry.get("role", ""),
                "content_summary": str(entry.get("content", ""))[:100] + "..." if len(str(entry.get("content", ""))) > 100 else str(entry.get("content", "")),
                "timestamp": entry.get("timestamp", 0)
            }
            for entry in task_data.get("conversation_history", [])
        ]
    }
    
    # Añadir información sobre reintentos si existe
    if "retries" in task_data:
        response["retries"] = task_data["retries"]
    
    return response

@app.post("/tasks/{task_id}/steps", response_model=TaskStepResponse, tags=["Pasos"])
async def execute_step(task_id: str, step_request: Optional[TaskStepRequest] = None):
    """
    Ejecuta el siguiente paso de una tarea o un paso específico.
    
    - **task_id**: ID de la tarea
    - **feedback**: (Opcional) Retroalimentación para el agente
    - **auto_recover**: (Opcional) Intentar recuperación automática en caso de error
    - **max_retries**: (Opcional) Número máximo de reintentos en caso de error
    
    Retorna el resultado de la ejecución del paso.
    """
    
    if task_id not in agent_tasks or task_id not in agent_instances:
        raise HTTPException(status_code=404, detail=f"Tarea {task_id} no encontrada")
    
    step_request = step_request or TaskStepRequest()
    task_data = agent_tasks[task_id]
    agent = agent_instances[task_id]
    
    # Obtener el índice del paso actual
    current_step = task_data.get("current_step", 0)
    
    try:
        # Ejecutar el paso
        result = agent.execute_plan_step(current_step, step_request.feedback)
        
        # Manejar recuperación automática si está habilitada y el paso falló
        if step_request.auto_recover and result.get("status") == "FAILURE":
            result, retries, recovery_strategy = await handle_auto_recovery(
                agent, result, task_data, step_request.max_retries
            )
            result["retries"] = retries
            result["recovery_strategy"] = recovery_strategy
        
        # Actualizar el estado de la tarea
        task_data["current_step"] = current_step + 1 if result.get("status") != "FAILURE" else current_step
        task_data["status"] = "completed" if task_data["current_step"] >= len(task_data.get("plan", [])) else "in_progress"
        if result.get("status") == "FAILURE":
            task_data["status"] = "failed"
        
        # Actualizar la conversación
        agent_tasks[task_id] = task_data
        
        # Preparar la respuesta
        step_description = task_data.get("plan", [])[current_step] if current_step < len(task_data.get("plan", [])) else {}
        next_step = task_data.get("plan", [])[task_data["current_step"]] if task_data["current_step"] < len(task_data.get("plan", [])) else None
        
        response = {
            "task_id": task_id,
            "step_index": current_step,
            "step_description": step_description,
            "status": result.get("status", "UNKNOWN"),
            "result": result,
            "next_step": next_step,
            "task_status": task_data["status"],
            "retries": result.get("retries", 0),
            "recovery_strategy": result.get("recovery_strategy")
        }
        
        return response
    
    except Exception as e:
        log.error(f"Error al ejecutar paso {current_step} de la tarea {task_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Error al ejecutar paso: {str(e)}")

@app.delete("/tasks/{task_id}", tags=["Tareas"])
async def delete_task(task_id: str):
    """
    Elimina una tarea.
    
    - **task_id**: ID de la tarea a eliminar
    
    Retorna un mensaje de confirmación.
    """
    
    if task_id not in agent_tasks:
        raise HTTPException(status_code=404, detail=f"Tarea {task_id} no encontrada")
    
    del agent_tasks[task_id]
    if task_id in agent_instances:
        del agent_instances[task_id]
    
    return {"message": f"Tarea {task_id} eliminada correctamente"}

@app.post("/tasks/{task_id}/reset", tags=["Tareas"])
async def reset_task(task_id: str):
    """
    Reinicia una tarea a su estado inicial.
    
    - **task_id**: ID de la tarea a reiniciar
    
    Retorna la tarea reiniciada.
    """
    
    if task_id not in agent_tasks or task_id not in agent_instances:
        raise HTTPException(status_code=404, detail=f"Tarea {task_id} no encontrada")
    
    task_data = agent_tasks[task_id]
    
    # Reiniciar la tarea
    task_data["current_step"] = 0
    task_data["status"] = "pending"
    if "retries" in task_data:
        task_data["retries"] = {}
    
    agent_tasks[task_id] = task_data
    
    # Reiniciar la conversación en el agente
    agent = agent_instances[task_id]
    agent_instance = GeminiAgent(model_name=task_data.get("model", DEFAULT_MODEL))
    task = agent_instance.create_task(task_data["description"])
    agent_instances[task_id] = agent_instance
    
    return {
        "task_id": task_id,
        "description": task_data["description"],
        "plan": task_data["plan"],
        "current_step": 0,
        "status": "pending",
        "message": "Tarea reiniciada correctamente"
    }

# --- Endpoints adicionales para acceso directo a las funciones del agente ---

@app.post("/docker/search/files", tags=["Docker - Búsqueda"])
async def search_files(request: SearchFilesRequest):
    """
    Busca archivos por patrón en el contenedor Docker.
    
    - **pattern**: Patrón de búsqueda (ej: *.py, *.js)
    - **base_path**: (Opcional) Directorio base para la búsqueda
    
    Retorna una lista de archivos que coinciden con el patrón.
    """
    
    result = search_files_in_docker(request.pattern, request.base_path)
    
    if result.status == ActionStatus.SUCCESS:
        return result.result
    else:
        raise HTTPException(status_code=400, detail=result.message)

@app.post("/docker/search/content", tags=["Docker - Búsqueda"])
async def search_in_files(request: SearchInFilesRequest):
    """
    Busca texto dentro de archivos en el contenedor Docker.
    
    - **query**: Texto a buscar en los archivos
    - **base_path**: (Opcional) Directorio base para la búsqueda
    
    Retorna las coincidencias encontradas en los archivos.
    """
    
    result = search_in_files_docker(request.query, request.base_path)
    
    if result.status == ActionStatus.SUCCESS:
        return result.result
    else:
        raise HTTPException(status_code=400, detail=result.message)

@app.post("/docker/files/edit", tags=["Docker - Archivos"])
async def edit_file(request: EditFileRequest):
    """
    Edita un archivo en el contenedor Docker.
    
    - **container_path**: Ruta del archivo en el contenedor
    - **content**: (Opcional) Nuevo contenido completo para el archivo
    - **start_line**: (Opcional) Línea inicial a reemplazar
    - **end_line**: (Opcional) Línea final a reemplazar
    - **new_content**: (Opcional) Nuevo contenido para las líneas seleccionadas
    - **search_block**: (Opcional) Bloque de texto a buscar
    - **replacement_block**: (Opcional) Bloque de texto de reemplazo
    - **mode**: (Opcional) Modo de edición (replace, smart)
    
    Retorna el resultado de la operación de edición.
    """
    
    # Determinar qué tipo de edición realizar
    if request.content is not None:
        # Edición de archivo completo
        result = edit_file_content_in_docker(request.container_path, request.content, request.mode)
    elif request.start_line is not None and request.end_line is not None and request.new_content is not None:
        # Edición por líneas
        result = edit_file_lines_in_docker(request.container_path, request.start_line, request.end_line, request.new_content)
    elif request.search_block is not None and request.replacement_block is not None:
        # Edición por bloques
        result = edit_file_block_in_docker(request.container_path, request.search_block, request.replacement_block)
    else:
        raise HTTPException(status_code=400, detail="Parámetros insuficientes para realizar la edición")
    
    if result.status == ActionStatus.SUCCESS:
        return result.result
    else:
        raise HTTPException(status_code=400, detail=result.message)

@app.post("/docker/files/chmod", tags=["Docker - Archivos"])
async def change_permissions(request: ChmodRequest):
    """
    Cambia los permisos de un archivo o directorio en el contenedor Docker.
    
    - **container_path**: Ruta del archivo o directorio
    - **mode**: Permisos a aplicar (ej: 755, u+x)
    
    Retorna el resultado de la operación.
    """
    
    result = chmod_path_in_docker(request.container_path, request.mode)
    
    if result.status == ActionStatus.SUCCESS:
        return result.result
    else:
        raise HTTPException(status_code=400, detail=result.message)

@app.post("/docker/dependencies/install", tags=["Docker - Dependencias"])
async def install_dependencies(request: InstallDependenciesRequest):
    """
    Instala dependencias desde un archivo en el contenedor Docker.
    
    - **dependencies_content**: Contenido del archivo de dependencias
    - **dep_type**: Tipo de dependencias (pip o apt)
    
    Retorna el resultado de la operación.
    """
    
    result = install_dependencies_in_docker(request.dependencies_content, request.dep_type)
    
    if result.status == ActionStatus.SUCCESS:
        return result.result
    else:
        raise HTTPException(status_code=400, detail=result.message)

@app.get("/docker/stats", tags=["Docker - Información"])
async def get_stats():
    """
    Obtiene estadísticas de uso de recursos del contenedor Docker.
    
    Retorna información sobre CPU, memoria y red.
    """
    
    result = get_container_stats()
    
    if result.status == ActionStatus.SUCCESS:
        return result.result
    else:
        raise HTTPException(status_code=400, detail=result.message)

@app.get("/docker/logs", tags=["Docker - Información"])
async def get_logs(tail: int = Query(100, description="Número de líneas de log a obtener")):
    """
    Obtiene los logs recientes del contenedor Docker.
    
    - **tail**: (Opcional) Número de líneas de log a obtener
    
    Retorna las líneas de log del contenedor.
    """
    
    result = get_container_logs(tail)
    
    if result.status == ActionStatus.SUCCESS:
        return {"logs": result.result, "lines": tail}
    else:
        raise HTTPException(status_code=400, detail=result.message)

@app.post("/docker/reset", tags=["Docker - Control"])
async def reset():
    """
    Reinicia el contenedor Docker.
    
    Retorna el estado del contenedor después del reinicio.
    """
    
    result = reset_container()
    
    if result.status == ActionStatus.SUCCESS:
        return result.result
    else:
        raise HTTPException(status_code=400, detail=result.message)

# --- Punto de entrada principal ---
if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("API_PORT", 8001))
    uvicorn.run(app, host="0.0.0.0", port=port) 