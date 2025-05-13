import os
import sys
import argparse
import time
from agent import GeminiAgent, GEMINI_API_KEY

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
        print(f"  {i+1}. {step}")
    
    print("\n¿Proceder con la ejecución del plan? (s/n)")
    proceed = input("> ").strip().lower()
    
    if proceed != 's':
        print("Operación cancelada.")
        return
    
    # Ejecutar los pasos del plan
    while task.current_step < len(task.plan):
        current_step = task.current_step
        current_step_desc = task.plan[current_step]
        
        print(f"\n🔄 Ejecutando paso {current_step + 1}/{len(task.plan)}: {current_step_desc}")
        result = agent.execute_plan_step()
        
        print_result(result)
        
        # Si el resultado es 'success', ya se avanzó automáticamente al siguiente paso
        # Solo se pide feedback si estamos esperando input del usuario
        if result['status'] == 'waiting_for_input':
            print("¿Proporcionar retroalimentación o continuar? (Presiona Enter para continuar o escribe un mensaje)")
            feedback = input("> ")
            
            if feedback.strip():
                # Si se proporcionó retroalimentación, ejecutar el mismo paso nuevamente con la retroalimentación
                print("\nEjecutando paso nuevamente con retroalimentación...")
                result = agent.execute_plan_step(step_index=current_step, user_feedback=feedback)
                print_result(result)
            else:
                # Si no hay retroalimentación, avanzar manualmente al siguiente paso
                task.current_step += 1
        
        elif result['status'] == 'error':
            print("¿Continuar con el siguiente paso a pesar del error? (s/n)")
            cont = input("> ").strip().lower()
            
            if cont != 's':
                print("Ejecución del plan detenida.")
                return
            else:
                # Avanzar manualmente al siguiente paso en caso de error si el usuario lo confirma
                task.current_step += 1
    
    print("\n✨ Todos los pasos del plan han sido completados.")
    print("Tarea finalizada exitosamente.")

def execute_single_task(task_description):
    """Ejecuta una tarea sin interacción del usuario entre pasos."""
    print_banner()
    
    # Verificar que la API key está configurada
    if not GEMINI_API_KEY:
        print("ERROR: No se ha configurado la API key de Google Genai.")
        print("Configura la variable de entorno GOOGLE_API_KEY o añádela en un archivo .env")
        return
    
    # Crear el agente
    agent = GeminiAgent()
    
    print(f"Ejecutando tarea: {task_description}")
    print("Generando plan...")
    
    # Crear la tarea
    task = agent.create_task(task_description)
    
    print("\n📋 Plan generado:")
    for i, step in enumerate(task.plan):
        print(f"  {i+1}. {step}")
    
    print("\nIniciando ejecución automática...")
    
    # Ejecutar los pasos del plan
    all_success = True
    for i in range(len(task.plan)):
        if task.current_step >= len(task.plan):
            break
            
        current_step = task.current_step
        current_step_desc = task.plan[current_step]
        
        print(f"\n🔄 Ejecutando paso {current_step + 1}/{len(task.plan)}: {current_step_desc}")
        result = agent.execute_plan_step()
        
        print_result(result)
        
        # Si hay un error o se requiere input, detener la ejecución automática
        if result['status'] not in ['success', 'completed']:
            all_success = False
            print("❌ Se ha encontrado un problema durante la ejecución automática.")
            print("Para continuar, ejecuta el agente en modo interactivo.")
            break
    
    if all_success:
        print("\n✨ Todos los pasos del plan han sido completados.")
        print("Tarea finalizada exitosamente.")
    else:
        print("\n⚠️ La ejecución automática no pudo completar todos los pasos.")
        print("Algunos pasos requieren intervención manual.")

def main():
    parser = argparse.ArgumentParser(description="Gemini Docker Agent CLI")
    
    # Argumentos
    parser.add_argument("--task", "-t", type=str, help="Descripción de la tarea a realizar")
    parser.add_argument("--interactive", "-i", action="store_true", help="Ejecutar en modo interactivo")
    
    args = parser.parse_args()
    
    # Si no se proporcionan argumentos, mostrar ayuda
    if len(sys.argv) == 1:
        parser.print_help()
        return
    
    # Ejecutar en modo interactivo o con una tarea específica
    if args.interactive:
        run_interactive_session()
    elif args.task:
        execute_single_task(args.task)
    else:
        print("ERROR: Debes proporcionar una tarea o usar el modo interactivo.")
        parser.print_help()

if __name__ == "__main__":
    main() 