import os
import sys
import argparse
import time
import json
from agent import GeminiAgent, GEMINI_API_KEY, ActionStatus

def print_banner():
    """Imprime un banner con el nombre del agente."""
    print("\n" + "=" * 60)
    print("                    GEMINI DOCKER AGENT")
    print("=" * 60 + "\n")

def print_result(result):
    """Imprime el resultado de un paso de manera formateada."""
    print("\n" + "-" * 50)
    
    if result['status'] == 'success':
        print(f"✅ Paso completado: {result['step_description']}")
        print(f"\nFunción ejecutada: {result['function_called']}")
        print(f"Argumentos: {result['function_args']}")
        
        # Formatear el resultado según sea necesario
        if isinstance(result['result'], dict):
            if 'status' in result['result']:
                status = result['result']['status']
                message = result['result'].get('message', '')
                print(f"\nEstado: {status}")
                if message:
                    print(f"Mensaje: {message}")
            else:
                print("\nResultado:")
                for key, value in result['result'].items():
                    print(f"  {key}: {value}")
        else:
            print(f"\nResultado: {result['result']}")
            
    elif result['status'] == 'waiting_for_input':
        print("⏳ Esperando input del usuario")
        print(f"\nMensaje: {result['message']}")
    
    elif result['status'] == 'completed':
        print("🎉 Tarea completada!")
        print(f"\nMensaje: {result['message']}")
    
    elif result['status'] == 'error':
        print("❌ Error durante la ejecución")
        print(f"\nMensaje de error: {result['message']}")
    
    print("-" * 50 + "\n")

def verify_step_execution(result):
    """
    Verifica de forma estructurada si un paso se ejecutó correctamente.
    
    Args:
        result: El resultado de la ejecución del paso
        
    Returns:
        dict: Un diccionario con la evaluación del paso:
            - success: bool, indica si el paso tuvo éxito
            - message: str, mensaje describiendo el resultado
            - should_retry: bool, indica si se debe reintentar el paso
    """
    # Por defecto, asumimos éxito basado en el status del resultado
    success = result['status'] == 'success'
    message = "Paso completado correctamente"
    should_retry = False
    
    # Verificar si hay errores explícitos
    if result['status'] == 'error':
        success = False
        message = f"Error: {result.get('message', 'Error desconocido')}"
        should_retry = True
    
    # Verificar si está esperando input (consideramos que necesita intervención)
    elif result['status'] == 'waiting_for_input':
        # Para modo autónomo, consideramos que no necesita input realmente y continuamos
        success = True
        message = "Paso requiere intervención pero continuamos automáticamente"
        should_retry = False
    
    # Verificar el contenido del resultado para detectar errores implícitos
    elif 'result' in result:
        # Si el resultado contiene un objeto con 'status'
        if isinstance(result['result'], dict) and 'status' in result['result']:
            # Si es un ActionStatus como cadena o enum
            status_value = result['result']['status']
            if isinstance(status_value, str) and status_value.lower() == 'failure':
                success = False
                message = f"Error implícito en el resultado: {result['result'].get('message', 'Error no especificado')}"
                should_retry = True
            # Si el resultado tiene un indicador de error explícito
            elif 'error' in result['result'] and result['result']['error']:
                success = False
                message = f"Error indicado en el resultado: {result['result'].get('error_message', 'Error no especificado')}"
                should_retry = True
    
    return {
        "success": success,
        "message": message,
        "should_retry": should_retry
    }

def handle_error_auto_recovery(agent, result, task, current_step):
    """Maneja errores e intenta recuperarse automáticamente."""
    print("\n🔄 Intentando recuperación automática del error...")
    
    # Verificar el tipo de error para aplicar estrategias específicas
    error_message = result.get('message', '')
    
    # Opciones de recuperación por tipo de error
    if "No such file or directory" in error_message:
        print("El error parece estar relacionado con un archivo o directorio que no existe.")
        recovery_result = agent.execute_plan_step(current_step, 
                                                "Error: Archivo o directorio no encontrado. " +
                                                "Por favor, crea los directorios necesarios y vuelve a intentarlo.")
    elif "permission denied" in error_message.lower():
        print("El error parece estar relacionado con permisos insuficientes.")
        recovery_result = agent.execute_plan_step(current_step, 
                                                "Error: Problema de permisos. " +
                                                "Por favor, verifica los permisos y ajústalos si es necesario.")
    elif "command not found" in error_message.lower():
        print("El error parece estar relacionado con un comando no disponible.")
        recovery_result = agent.execute_plan_step(current_step, 
                                                "Error: Comando no encontrado. " +
                                                "Por favor, verifica que el software necesario esté instalado.")
    else:
        # Estrategia genérica: pedir al agente que diagnostique y resuelva
        print("Solicitando diagnóstico automático del problema...")
        recovery_result = agent.execute_plan_step(current_step,
                                                f"Hubo un error: {error_message}. " +
                                                "Por favor, diagnostica el problema y propón una solución alternativa.")
    
    print_result(recovery_result)
    return recovery_result

def run_interactive_session():
    """Ejecuta una sesión interactiva con el agente."""
    print_banner()
    
    # Verificar que la API key está configurada
    if not GEMINI_API_KEY:
        print("ERROR: No se ha configurado la API key de Google Genai.")
        print("Configura la variable de entorno GOOGLE_API_KEY o añádela en un archivo .env")
        return
    
    # Crear el agente
    agent = GeminiAgent()
    
    print("Bienvenido al Gemini Docker Agent CLI.")
    print("Este agente puede ayudarte a realizar tareas en un contenedor Docker.")
    print("Describe la tarea que quieres realizar:\n")
    
    task_description = input("> ")
    print("\nGenerando plan para la tarea...")
    
    # Crear la tarea
    task = agent.create_task(task_description)
    
    print("\n📋 Plan generado:")
    for i, step in enumerate(task.plan):
        # Manejar tanto strings como diccionarios
        if isinstance(step, dict):
            print(f"  {i+1}. {step.get('titulo', 'Paso')}: {step.get('descripcion', '')}")
        else:
            print(f"  {i+1}. {step}")
    
    print("\n¿Proceder con la ejecución del plan? (s/n)")
    proceed = input("> ").strip().lower()
    
    if proceed != 's':
        print("Operación cancelada.")
        return
    
    print("\n🚀 Ejecutando plan automáticamente. No se detendrá para pedir feedback.")
    
    # Ejecutar los pasos del plan automáticamente
    while task.current_step < len(task.plan):
        current_step = task.current_step
        current_step_desc = task.plan[current_step]
        
        print(f"\n🔄 Ejecutando paso {current_step + 1}/{len(task.plan)}:")
        if isinstance(current_step_desc, dict):
            print(f"  {current_step_desc.get('titulo', 'Paso')}: {current_step_desc.get('descripcion', '')}")
        else:
            print(f"  {current_step_desc}")
        
        # Ejecutar el paso
        result = agent.execute_plan_step()
        print_result(result)
        
        # Verificar el resultado de manera estructurada
        verification = verify_step_execution(result)
        
        # Contador de intentos para el paso actual
        retry_count = 0
        max_retries = 2  # Máximo número de reintentos por paso
        
        # Reintentar si es necesario y no hemos excedido el máximo
        while not verification["success"] and verification["should_retry"] and retry_count < max_retries:
            retry_count += 1
            print(f"\n⚠️ Verificación fallida: {verification['message']}")
            print(f"🔄 Reintentando paso {current_step + 1} (intento {retry_count + 1}/{max_retries + 1})...")
            
            # Recuperación automática
            recovery_result = handle_error_auto_recovery(agent, result, task, current_step)
            print_result(recovery_result)
            
            # Verificar el resultado de la recuperación
            verification = verify_step_execution(recovery_result)
            result = recovery_result  # Actualizar el resultado para el siguiente ciclo
            
            # Si tuvo éxito, salir del ciclo de reintentos
            if verification["success"]:
                print("✅ Paso recuperado exitosamente")
                break
        
        # Si después de todos los reintentos sigue fallando, decidir si continuar
        if not verification["success"]:
            print(f"\n⚠️ El paso {current_step + 1} ha fallado después de {retry_count + 1} intentos.")
            print("Continuando con el siguiente paso...")
        
        # Avanzar al siguiente paso independientemente del resultado
        task.current_step += 1
    
    print("\n✨ Todos los pasos del plan han sido completados.")
    print("Tarea finalizada exitosamente.")

def execute_single_task(task_description, autonomo=False):
    """Ejecuta una tarea de forma completamente autónoma sin interacción del usuario."""
    print_banner()
    
    # Verificar que la API key está configurada
    if not GEMINI_API_KEY:
        print("ERROR: No se ha configurado la API key de Google Genai.")
        print("Configura la variable de entorno GOOGLE_API_KEY o añádala en un archivo .env")
        return
    
    # Crear el agente
    agent = GeminiAgent()
    
    print(f"Ejecutando tarea: {task_description}")
    print("Generando plan...")
    
    # Crear la tarea
    task = agent.create_task(task_description)
    
    print("\n📋 Plan generado:")
    for i, step in enumerate(task.plan):
        if isinstance(step, dict):
            print(f"  {i+1}. {step.get('titulo', 'Paso')}: {step.get('descripcion', '')}")
        else:
            print(f"  {i+1}. {step}")
    
    if not autonomo:
        print("\n¿Proceder con la ejecución del plan? (s/n)")
        proceed = input("> ").strip().lower()
        
        if proceed != 's':
            print("Operación cancelada.")
            return
    else:
        print("\nEjecutando plan en modo completamente autónomo...")
    
    print("\nIniciando ejecución automática sin feedback entre pasos...")
    
    # Ejecutar los pasos del plan de forma completamente autónoma
    while task.current_step < len(task.plan):
        if task.current_step >= len(task.plan):
            break
            
        current_step = task.current_step
        current_step_desc = task.plan[current_step]
        
        print(f"\n🔄 Ejecutando paso {current_step + 1}/{len(task.plan)}:")
        if isinstance(current_step_desc, dict):
            print(f"  {current_step_desc.get('titulo', 'Paso')}: {current_step_desc.get('descripcion', '')}")
        else:
            print(f"  {current_step_desc}")
        
        # Ejecutar el paso    
        result = agent.execute_plan_step()
        print_result(result)
        
        # Verificar el resultado de manera estructurada
        verification = verify_step_execution(result)
        
        # Contador de intentos para el paso actual
        retry_count = 0
        max_retries = 2  # Máximo número de reintentos por paso
        
        # Reintentar si es necesario y no hemos excedido el máximo
        while not verification["success"] and verification["should_retry"] and retry_count < max_retries:
            retry_count += 1
            print(f"\n⚠️ Verificación fallida: {verification['message']}")
            print(f"🔄 Reintentando paso {current_step + 1} (intento {retry_count + 1}/{max_retries + 1})...")
            
            # Recuperación automática
            recovery_result = handle_error_auto_recovery(agent, result, task, current_step)
            print_result(recovery_result)
            
            # Verificar el resultado de la recuperación
            verification = verify_step_execution(recovery_result)
            result = recovery_result  # Actualizar el resultado para el siguiente ciclo
            
            # Si tuvo éxito, salir del ciclo de reintentos
            if verification["success"]:
                print("✅ Paso recuperado exitosamente")
                break
        
        # Si después de todos los reintentos sigue fallando, decidir si continuar
        if not verification["success"]:
            print(f"\n⚠️ El paso {current_step + 1} ha fallado después de {retry_count + 1} intentos.")
            print("Continuando con el siguiente paso...")
        
        # Si estaba esperando input, resolver automáticamente
        if result['status'] == 'waiting_for_input':
            print("🤖 Resolviendo solicitud de input automáticamente...")
            auto_result = agent.execute_plan_step(current_step, 
                                               "Continúa con el plan automáticamente. Toma la decisión más segura y razonable.")
            print_result(auto_result)
        
        # Avanzar al siguiente paso independientemente del resultado
        task.current_step += 1
    
    if task.current_step >= len(task.plan):
        print("\n✨ Todos los pasos del plan han sido completados.")
        print("Tarea finalizada exitosamente.")
    else:
        print("\n⚠️ La ejecución no pudo completar todos los pasos.")
        print(f"Progreso: {task.current_step}/{len(task.plan)} pasos completados.")

def main():
    parser = argparse.ArgumentParser(description="Gemini Docker Agent CLI")
    
    # Argumentos
    parser.add_argument("--task", "-t", type=str, help="Descripción de la tarea a realizar")
    parser.add_argument("--interactive", "-i", action="store_true", help="Ejecutar en modo interactivo (solo aprobación del plan)")
    parser.add_argument("--autonomo", "-a", action="store_true", help="Ejecutar en modo completamente autónomo (sin aprobación del plan)")
    
    args = parser.parse_args()
    
    # Si no se proporcionan argumentos, mostrar ayuda
    if len(sys.argv) == 1:
        parser.print_help()
        return
    
    # Ejecutar en el modo seleccionado
    if args.interactive:
        run_interactive_session()
    elif args.autonomo and args.task:
        # Ejecutar en modo completamente autónomo (sin pedir aprobación)
        execute_single_task(args.task, autonomo=True)
    elif args.task:
        # Ejecutar con aprobación del plan pero sin feedback entre pasos
        execute_single_task(args.task, autonomo=False)
    else:
        print("ERROR: Debes proporcionar una tarea o usar el modo interactivo.")
        parser.print_help()

if __name__ == "__main__":
    main() 