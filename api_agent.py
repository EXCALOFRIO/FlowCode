import os
import uuid
from typing import Dict, List, Optional, Any
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from agent import GeminiAgent, GEMINI_API_KEY

# Verificar que la API key está configurada
if not GEMINI_API_KEY:
    print("ADVERTENCIA: No se ha configurado la API key de Google Genai.")
    print("Configura la variable de entorno GOOGLE_API_KEY o añádela en un archivo .env")

# Inicializar la aplicación FastAPI
app = FastAPI(
    title="Gemini Docker Agent API",
    description="API para interactuar con un agente de IA basado en Gemini para gestionar tareas en Docker",
    version="1.0.0"
)

# Configurar CORS para permitir peticiones desde cualquier origen (para desarrollo)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Almacén de tareas en memoria
# En una aplicación real, se usaría una base de datos
tasks_store = {}

# Instancia global del agente
agent = GeminiAgent()

# --- Modelos de datos para la API ---

class TaskCreateRequest(BaseModel):
    description: str = Field(..., description="Descripción de la tarea a realizar")

class TaskCreateResponse(BaseModel):
    task_id: str = Field(..., description="ID único de la tarea creada")
    description: str = Field(..., description="Descripción de la tarea")
    plan: List[str] = Field(..., description="Plan generado para la tarea")
    status: str = Field(..., description="Estado actual de la tarea")

class TaskStepRequest(BaseModel):
    feedback: Optional[str] = Field(None, description="Retroalimentación opcional para el agente")

class TaskStepResponse(BaseModel):
    task_id: str = Field(..., description="ID de la tarea")
    step_index: int = Field(..., description="Índice del paso ejecutado")
    step_description: str = Field(..., description="Descripción del paso ejecutado")
    status: str = Field(..., description="Estado de la ejecución del paso")
    result: Dict[str, Any] = Field(..., description="Resultado detallado de la ejecución")
    next_step: Optional[str] = Field(None, description="Descripción del siguiente paso a ejecutar")
    task_status: str = Field(..., description="Estado general de la tarea")

class TaskListResponse(BaseModel):
    tasks: List[Dict[str, Any]] = Field(..., description="Lista de tareas disponibles")

# --- Endpoints de la API ---

@app.post("/tasks", response_model=TaskCreateResponse, tags=["Tareas"])
async def create_task(task_request: TaskCreateRequest, background_tasks: BackgroundTasks):
    """Crea una nueva tarea para el agente."""
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=503, detail="No se ha configurado la API key de Google Genai")
    
    try:
        # Crear la tarea con el agente
        task = agent.create_task(task_request.description)
        
        # Guardar la tarea en el almacén
        tasks_store[task.id] = {
            "id": task.id,
            "description": task.description,
            "plan": task.plan,
            "current_step": task.current_step,
            "status": task.status,
            "agent_instance": agent  # Guardar la instancia del agente para esta tarea
        }
        
        return {
            "task_id": task.id,
            "description": task.description,
            "plan": task.plan,
            "status": task.status
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al crear la tarea: {str(e)}")

@app.get("/tasks", response_model=TaskListResponse, tags=["Tareas"])
async def list_tasks():
    """Lista todas las tareas disponibles."""
    task_list = []
    
    for task_id, task_data in tasks_store.items():
        task_list.append({
            "id": task_id,
            "description": task_data["description"],
            "status": task_data["status"],
            "current_step": task_data["current_step"],
            "total_steps": len(task_data["plan"])
        })
    
    return {"tasks": task_list}

@app.get("/tasks/{task_id}", tags=["Tareas"])
async def get_task(task_id: str):
    """Obtiene los detalles de una tarea específica."""
    if task_id not in tasks_store:
        raise HTTPException(status_code=404, detail="Tarea no encontrada")
    
    task_data = tasks_store[task_id]
    
    # Obtener los resultados de los pasos ejecutados
    agent_instance = task_data["agent_instance"]
    step_results = {}
    
    # Extraer los resultados de los pasos ejecutados del historial de conversación
    if hasattr(agent_instance, 'current_task') and agent_instance.current_task:
        for i, msg in enumerate(agent_instance.current_task.conversation_history):
            if msg.get('role') == 'function':
                # Obtener el índice del paso a partir del resultado
                if isinstance(msg.get('content'), dict):
                    if 'step_index' in msg['content'].get('result', {}):
                        step_index = msg['content']['result']['step_index']
                        step_results[step_index] = msg['content']['result']
                    
                    # También buscar en el contenido directo del mensaje
                    if isinstance(msg['content'], dict) and 'result' in msg['content']:
                        content_data = msg['content']
                        if 'step_index' in content_data:
                            step_index = content_data['step_index']
                            step_results[step_index] = content_data
    
    # Excluir la instancia del agente de la respuesta
    response_data = {k: v for k, v in task_data.items() if k != "agent_instance"}
    
    # Añadir los resultados de los pasos a la respuesta
    response_data["step_results"] = step_results
    
    return response_data

@app.post("/tasks/{task_id}/steps", response_model=TaskStepResponse, tags=["Pasos"])
async def execute_step(task_id: str, step_request: Optional[TaskStepRequest] = None):
    """Ejecuta el siguiente paso de una tarea específica."""
    if task_id not in tasks_store:
        raise HTTPException(status_code=404, detail="Tarea no encontrada")
    
    task_data = tasks_store[task_id]
    
    # Verificar si la tarea ya está completada
    if task_data["status"] == "completed":
        raise HTTPException(status_code=400, detail="La tarea ya ha sido completada")
    
    # Obtener la instancia del agente para esta tarea
    agent_instance = task_data["agent_instance"]
    
    try:
        # Ejecutar el siguiente paso
        feedback = step_request.feedback if step_request else None
        result = agent_instance.execute_plan_step(user_feedback=feedback)
        
        # Actualizar el estado de la tarea en el almacén
        task_data["current_step"] = agent_instance.current_task.current_step
        task_data["status"] = agent_instance.current_task.status
        
        # Construir la respuesta
        response = {
            "task_id": task_id,
            "step_index": result.get("step_index", task_data["current_step"] - 1),
            "step_description": result.get("step_description", ""),
            "status": result.get("status", "unknown"),
            "result": result,
            "next_step": result.get("next_step"),
            "task_status": task_data["status"]
        }
        
        return response
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al ejecutar el paso: {str(e)}")

@app.delete("/tasks/{task_id}", tags=["Tareas"])
async def delete_task(task_id: str):
    """Elimina una tarea específica."""
    if task_id not in tasks_store:
        raise HTTPException(status_code=404, detail="Tarea no encontrada")
    
    # Eliminar la tarea del almacén
    del tasks_store[task_id]
    
    return JSONResponse({"detail": f"Tarea {task_id} eliminada correctamente"})

@app.post("/tasks/{task_id}/reset", tags=["Tareas"])
async def reset_task(task_id: str):
    """Reinicia una tarea desde el primer paso."""
    if task_id not in tasks_store:
        raise HTTPException(status_code=404, detail="Tarea no encontrada")
    
    task_data = tasks_store[task_id]
    
    # Crear una nueva instancia del agente
    new_agent = GeminiAgent()
    
    # Crear una nueva tarea con la misma descripción
    task = new_agent.create_task(task_data["description"])
    
    # Actualizar la tarea en el almacén
    tasks_store[task_id] = {
        "id": task_id,  # Mantener el mismo ID
        "description": task.description,
        "plan": task.plan,
        "current_step": task.current_step,
        "status": task.status,
        "agent_instance": new_agent
    }
    
    return {
        "task_id": task_id,
        "description": task.description,
        "plan": task.plan,
        "status": task.status,
        "message": "Tarea reiniciada correctamente"
    }

# --- Punto de entrada ---

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001) 