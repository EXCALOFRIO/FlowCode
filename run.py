#!/usr/bin/env python3
"""
Script principal para ejecutar el agente de Gemini Docker.
Este script permite iniciar los diferentes componentes del sistema.
"""

import os
import sys
import argparse
import logging
import subprocess
import time

from dotenv import load_dotenv

# Configurar logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
log = logging.getLogger(__name__)

# Cargar variables de entorno
load_dotenv()

def check_requirements():
    """Verifica que se cumplen todos los requisitos para ejecutar el sistema."""
    # Verificar API key
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        log.warning("⚠️ No se ha configurado la API key de Google Gemini.")
        log.warning("Configure la variable de entorno GOOGLE_API_KEY o añádala en un archivo .env")
        # Decidimos no abortar si no hay API key, ya que algunos componentes (como Docker Manager)
        # podrían no necesitarla directamente. Pero se advierte al usuario.
        # return False # Comentado para permitir la ejecución sin API key para ciertos componentes.
        
    # Puedes añadir otras verificaciones aquí, como la existencia de directorios clave.
    
    return True

def run_docker_manager():
    """Ejecuta el Docker Manager (componente de backend)."""
    log.info("Iniciando Docker Manager...")
    try:
        # Usamos Popen para que se ejecute en segundo plano respecto a este script
        # La salida del subproceso se dirigirá a la consola principal
        process = subprocess.Popen([sys.executable, "docker_manager_app.py"])
        return process
    except FileNotFoundError:
        log.error(f"Error: No se encontró el script 'docker_manager_app.py'. Asegúrate de estar en el directorio correcto.")
        return None
    except Exception as e:
        log.error(f"Error al iniciar Docker Manager: {e}")
        return None

def run_api_agent():
    """Ejecuta el API Agent (componente de backend)."""
    log.info("Iniciando API Agent...")
    try:
        # Usamos Popen para que se ejecute en segundo plano respecto a este script
         # La salida del subproceso se dirigirá a la consola principal
        process = subprocess.Popen([sys.executable, "run_backend.py"])
        return process
    except FileNotFoundError:
        log.error(f"Error: No se encontró el script 'run_backend.py'. Asegúrate de estar en el directorio correcto.")
        return None
    except Exception as e:
        log.error(f"Error al iniciar API Agent: {e}")
        return None

def run_cli_agent(task=None, interactive=False, autonomo=False):
    """Ejecuta el CLI Agent."""
    log.info("Iniciando CLI Agent...")
    command = [sys.executable, "cli_agent.py"]
    
    if interactive:
        log.info("...en modo interactivo.")
        command.append("--interactive")
    elif autonomo and task:
        log.info(f"...en modo autónomo para tarea: {task}")
        command.extend(["--autonomo", "--task", task])
    elif task:
        log.info(f"...para tarea: {task}")
        command.extend(["--task", task])
    else:
        log.warning("Se requiere una tarea para el CLI Agent o el modo interactivo")
        return None # No iniciar si no hay argumentos válidos para CLI

    try:
        # Usamos Popen para que se ejecute en segundo plano respecto a este script
         # La salida del subproceso se dirigirá a la consola principal
        process = subprocess.Popen(command)
        return process
    except FileNotFoundError:
        log.error(f"Error: No se encontró el script 'cli_agent.py'. Asegúrate de estar en el directorio correcto.")
        return None
    except Exception as e:
        log.error(f"Error al iniciar CLI Agent: {e}")
        return None

def run_frontend():
    """Ejecuta el Frontend con 'npm run dev' usando shell=True."""
    frontend_dir = "./frontend"
    
    if not os.path.isdir(frontend_dir):
        log.error(f"El directorio del frontend '{frontend_dir}' no existe.")
        log.error("Asegúrate de que el directorio './frontend' exista en la misma ubicación que run.py")
        return None
    
    log.info(f"Iniciando Frontend desde {frontend_dir} con 'npm run dev' (usando shell=True)...")
    
    try:
        # Usamos Popen con shell=True.
        # Esto ejecuta el comando dentro del shell por defecto del sistema,
        # lo que ayuda a encontrar comandos como 'npm' si están en el PATH del shell.
        # Cuando shell=True, el comando debe ser una cadena única.
        command_string = "npm run dev"
        
        process = subprocess.Popen(
            command_string, # Comando como cadena
            cwd=frontend_dir, # Establece el directorio de trabajo
            shell=True # <-- Esto es el cambio clave
            # Nota: shell=True puede tener implicaciones de seguridad si 'command_string'
            # incluyera entrada del usuario no sanitizada. Para un comando fijo como este, es seguro.
            # La salida del subproceso se dirigirá a la consola principal
        )
        log.info(f"Proceso del frontend iniciado con PID: {process.pid}")
        log.info("Es posible que la salida detallada de 'npm run dev' aparezca aquí.")
        return process
    except FileNotFoundError:
        # Este FileNotFoundError aquí es menos probable con shell=True,
        # ya que el shell mismo busca el comando. Pero se mantiene por si acaso.
        log.error("⚠️ Error: El shell o el comando 'npm' no fueron encontrados.")
        log.error("Asegúrate de que tu shell (ej: bash, cmd) y Node.js/npm estén instalados y en el PATH.")
        return None
    except Exception as e:
        log.error(f"⚠️ Error al iniciar el frontend (shell=True): {e}")
        return None


def run_all(task=None, interactive=False, autonomo=False):
    """Ejecuta todos los componentes del sistema (Backend y Frontend)."""
    log.info("Iniciando todos los componentes (Docker Manager, API Agent, Frontend y CLI Agent si aplica)...")
    processes = []
    
    # --- Iniciar Backend ---
    # 1. Docker Manager
    docker_manager = run_docker_manager()
    if docker_manager: # Añadir a la lista solo si se inició correctamente
        processes.append(docker_manager)
        
    log.info("Esperando un momento para que Docker Manager inicie...")
    time.sleep(3) # Dar tiempo para que Docker Manager inicie (ajustar si es necesario)
    
    # 2. API Agent
    api_agent = run_api_agent()
    if api_agent: # Añadir a la lista solo si se inició correctamente
        processes.append(api_agent)
        
    log.info("Esperando un momento para que API Agent inicie...")
    time.sleep(2) # Dar tiempo para que API Agent inicie (ajustar si es necesario)
    
    # --- Iniciar Frontend ---
    frontend_process = run_frontend()
    if frontend_process: # Añadir a la lista solo si se inició correctamente
        processes.append(frontend_process)
        
    # --- Iniciar CLI Agent (si se solicita) ---
    if interactive or task:
        cli_agent = run_cli_agent(task, interactive, autonomo)
        if cli_agent: # Añadir a la lista solo si se inició correctamente
            processes.append(cli_agent)
    else:
         log.info("CLI Agent no solicitado en este inicio --all.")

    # --- Esperar a que todos los procesos terminen ---
    # Este script principal esperará hasta que reciba Ctrl+C o todos los procesos terminen
    # por sí solos (lo cual es poco probable para el frontend y el backend API).
    
    # pequeña pausa antes de entrar en el bucle de espera
    time.sleep(1) 
    
    log.info("Todos los componentes solicitados iniciados. Presiona Ctrl+C para detener.")
    
    # Eliminar procesos que no se iniciaron correctamente (son None en la lista)
    running_processes = [p for p in processes if p is not None]

    if not running_processes:
        log.error("Ningún proceso pudo iniciarse. Abortando.")
        return # Salir de la función si no hay procesos corriendo

    try:
        # Bucle principal: esperar a que todos los procesos hijos terminen
        # wait() bloquea hasta que el proceso hijo termina.
        # Si tenemos múltiples procesos, este bucle espera secuencialmente.
        # Una alternativa sería usar poll() en un bucle while True,
        # pero wait() en un bucle es más simple para este caso.
        
        # Nota: Esto esperará a que cada proceso termine *en el orden* en que fueron añadidos.
        # Si un proceso como el backend API o frontend (que se espera que corran indefinidamente)
        # terminan inesperadamente, wait() devolverá y el script continuará.
        # Para una supervisión más robusta, se necesitaría un enfoque diferente (polling, supervisores).
        # Pero para una simple ejecución de "iniciar y esperar Ctrl+C", este bucle funciona.
        
        # Esperar a que todos los procesos *terminen* (esto solo ocurrirá si fallan)
        # La interrupción con Ctrl+C se maneja en el 'except'.
        for p in running_processes:
            try:
                p.wait()
                log.info(f"Proceso con PID {p.pid} ha terminado (return code {p.returncode}).")
            except Exception as e:
                 log.error(f"Error esperando proceso con PID {p.pid}: {e}")


    except KeyboardInterrupt:
        # Manejar Ctrl+C: intentar terminar todos los procesos hijos
        log.info("\nRecibido Ctrl+C. Intentando terminar procesos...")
        for p in running_processes:
            try:
                if p.poll() is None: # Solo intentar terminar si el proceso aún está corriendo
                    log.info(f"Terminando proceso con PID {p.pid}...")
                    # Usar terminate() o kill() dependiendo del proceso.
                    # Para procesos como npm run dev, terminate() (SIGTERM) suele ser más limpio.
                    # Si no responde, kill() (SIGKILL).
                    p.terminate() 
            except Exception as e:
                 log.error(f"Error al intentar terminar proceso con PID {p.pid}: {e}")


        # Dar un tiempo para que terminen limpiamente
        time.sleep(5)

        # Si después de 5 segundos aún hay procesos corriendo, matarlos
        log.info("Verificando procesos restantes...")
        for p in running_processes:
            try:
                if p.poll() is None: # Si aún está corriendo
                    log.warning(f"Proceso con PID {p.pid} no terminó, matando...")
                    p.kill() # Envía SIGKILL
                else:
                     log.info(f"Proceso con PID {p.pid} terminó.")
            except Exception as e:
                 log.error(f"Error al intentar matar proceso con PID {p.pid}: {e}")

        log.info("Todos los procesos gestionados. Saliendo.")
        # Es buena práctica salir explícitamente después de manejar Ctrl+C
        sys.exit(0) 
        
    # Si el script llega aquí sin KeyboardInterrupt, significa que todos los procesos
    # en running_processes terminaron por sí solos.
    log.info("Todos los procesos iniciados han finalizado por sí solos.")


def main():
    """Función principal."""
    parser = argparse.ArgumentParser(description="Ejecuta el agente de Gemini Docker y sus componentes.")
    
    # Argumentos generales
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--docker-manager", action="store_true", help="Ejecutar solo Docker Manager")
    group.add_argument("--api", action="store_true", help="Ejecutar solo API Agent (Backend)")
    group.add_argument("--cli", action="store_true", help="Ejecutar solo CLI Agent")
    group.add_argument("--frontend", action="store_true", help="Ejecutar solo Frontend") # Añadido
    group.add_argument("--all", action="store_true", help="Ejecutar todos los componentes (Docker Manager, API Agent, Frontend y CLI si aplica)")
    
    # Argumentos para CLI Agent
    parser.add_argument("--task", "-t", type=str, help="Tarea para el CLI Agent cuando se usa --cli o --all")
    parser.add_argument("--interactive", "-i", action="store_true", help="Ejecutar CLI Agent en modo interactivo cuando se usa --cli o --all")
    parser.add_argument("--autonomo", "-a", action="store_true", help="Ejecutar CLI Agent en modo completamente autónomo (requiere --task) cuando se usa --cli o --all")
    
    # Modelo Gemini
    parser.add_argument("--model", type=str, help="Modelo de Gemini a utilizar (sobrescribe la variable DEFAULT_MODEL)", default=os.getenv("DEFAULT_MODEL", "gemini-2.5-flash-preview-04-17"))
    
    args = parser.parse_args()
    
    # Configurar modelo en variable de entorno para que los subprocesos lo hereden
    os.environ["DEFAULT_MODEL"] = args.model
    log.info(f"Usando modelo: {args.model}")
    
    # Verificar requisitos (ahora solo una advertencia si falta la API key)
    check_requirements()
    
    # Ejecutar componentes según argumentos
    if args.all:
        run_all(args.task, args.interactive, args.autonomo)
    elif args.docker_manager:
        dm_process = run_docker_manager()
        if dm_process: dm_process.wait()
    elif args.api:
        api_process = run_api_agent()
        if api_process: api_process.wait()
    elif args.cli:
        cli_agent = run_cli_agent(args.task, args.interactive, args.autonomo)
        if cli_agent: cli_agent.wait()
        else: parser.print_help() # Mostrar ayuda si CLI no puede iniciar por falta de args
    elif args.frontend: # Nuevo caso para ejecutar solo el frontend
        frontend_process = run_frontend()
        if frontend_process: 
            try:
                frontend_process.wait()
            except KeyboardInterrupt:
                log.info("\nRecibido Ctrl+C. Terminando proceso frontend.")
                frontend_process.terminate()
                try:
                    frontend_process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    frontend_process.kill()
                log.info("Proceso frontend terminado.")
                sys.exit(0)
    else:
        # Si no se especifica ningún argumento, mostrar ayuda
        parser.print_help()
        # También podrías considerar ejecutar --all por defecto, si es el caso de uso más común.
        # log.info("No se especificó ninguna opción, ejecutando --all por defecto.")
        # run_all(args.task, args.interactive, args.autonomo)
    
    # Salir limpiamente si llegamos aquí sin interrupción
    sys.exit(0)

if __name__ == "__main__":
    main()