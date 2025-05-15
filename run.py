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
        return False
    
    return True

def run_docker_manager():
    """Ejecuta el Docker Manager."""
    log.info("Iniciando Docker Manager...")
    return subprocess.Popen([sys.executable, "docker_manager_app.py"])

def run_api_agent():
    """Ejecuta el API Agent."""
    log.info("Iniciando API Agent...")
    return subprocess.Popen([sys.executable, "run_backend.py"])

def run_cli_agent(task=None, interactive=False, autonomo=False):
    """Ejecuta el CLI Agent."""
    if interactive:
        log.info("Iniciando CLI Agent en modo interactivo...")
        return subprocess.Popen([sys.executable, "cli_agent.py", "--interactive"])
    elif autonomo and task:
        log.info(f"Iniciando CLI Agent en modo autónomo para tarea: {task}")
        return subprocess.Popen([sys.executable, "cli_agent.py", "--autonomo", "--task", task])
    elif task:
        log.info(f"Iniciando CLI Agent para tarea: {task}")
        return subprocess.Popen([sys.executable, "cli_agent.py", "--task", task])
    else:
        log.warning("Se requiere una tarea para el CLI Agent o el modo interactivo")
        return None

def run_all(task=None, interactive=False, autonomo=False):
    """Ejecuta todos los componentes del sistema."""
    processes = []
    
    # Primero iniciar el Docker Manager
    docker_manager = run_docker_manager()
    processes.append(docker_manager)
    log.info("Esperando a que Docker Manager inicie...")
    import time
    time.sleep(3)  # Dar tiempo para que Docker Manager inicie
    
    # Después iniciar el API Agent
    api_agent = run_api_agent()
    processes.append(api_agent)
    log.info("Esperando a que API Agent inicie...")
    time.sleep(2)  # Dar tiempo para que API Agent inicie
    
    # Finalmente iniciar el CLI Agent si corresponde
    if interactive or task:
        cli_agent = run_cli_agent(task, interactive, autonomo)
        if cli_agent:
            processes.append(cli_agent)
    
    # Esperar a que todos los procesos terminen
    try:
        for p in processes:
            p.wait()
    except KeyboardInterrupt:
        log.info("Recibido Ctrl+C, terminando procesos...")
        for p in processes:
            p.terminate()
        
        # Esperar a que terminen
        for p in processes:
            try:
                p.wait(timeout=5)
            except subprocess.TimeoutExpired:
                p.kill()
        
        log.info("Todos los procesos terminados.")

def main():
    """Función principal."""
    parser = argparse.ArgumentParser(description="Ejecuta el agente de Gemini Docker")
    
    # Argumentos generales
    parser.add_argument("--docker-manager", action="store_true", help="Ejecutar solo Docker Manager")
    parser.add_argument("--api", action="store_true", help="Ejecutar solo API Agent")
    parser.add_argument("--cli", action="store_true", help="Ejecutar solo CLI Agent")
    parser.add_argument("--all", action="store_true", help="Ejecutar todos los componentes")
    
    # Argumentos para CLI Agent
    parser.add_argument("--task", "-t", type=str, help="Tarea para el CLI Agent")
    parser.add_argument("--interactive", "-i", action="store_true", help="Ejecutar CLI Agent en modo interactivo")
    parser.add_argument("--autonomo", "-a", action="store_true", help="Ejecutar CLI Agent en modo completamente autónomo")
    
    # Modelo Gemini
    parser.add_argument("--model", type=str, help="Modelo de Gemini a utilizar", default=os.getenv("DEFAULT_MODEL", "gemini-2.5-flash-preview-04-17"))
    
    args = parser.parse_args()
    
    # Configurar modelo en variable de entorno
    os.environ["DEFAULT_MODEL"] = args.model
    log.info(f"Usando modelo: {args.model}")
    
    # Verificar requisitos
    if not check_requirements():
        log.error("No se cumplen todos los requisitos. Abortando.")
        return 1
    
    # Ejecutar componentes según argumentos
    if args.all:
        run_all(args.task, args.interactive, args.autonomo)
    elif args.docker_manager:
        run_docker_manager().wait()
    elif args.api:
        run_api_agent().wait()
    elif args.cli:
        cli_agent = run_cli_agent(args.task, args.interactive, args.autonomo)
        if cli_agent:
            cli_agent.wait()
        else:
            parser.print_help()
    else:
        parser.print_help()
    
    return 0

if __name__ == "__main__":
    sys.exit(main())