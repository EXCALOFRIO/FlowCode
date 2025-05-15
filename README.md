# Gemini Docker Agent - Backend

Este proyecto proporciona una API REST y utilidades CLI para gestionar tareas y operaciones dentro de un contenedor Docker, incluyendo instalación de dependencias, manipulación de archivos y ejecución de comandos, todo de forma automatizada y segura.

## Requisitos previos

- **Python 3.9+**
- **Docker** instalado y corriendo en el sistema
- **pip** (gestor de paquetes de Python)

## Instalación

1. **Clona el repositorio** (o descarga los archivos):

   ```sh
   git clone <URL_DEL_REPO>
   cd FlowCode
   ```

2. **Instala las dependencias de Python:**

   ```sh
   pip install -r requirements.txt
   ```

3. **Configura las variables de entorno:**

   - Si usas la API de Gemini, asegúrate de tener la variable `GOOGLE_API_KEY` en tu entorno o en un archivo `.env`.

4. **Asegúrate de que Docker esté corriendo**

## Ejecución de los servicios backend

Puedes lanzar ambos servicios (Docker Manager y API Agent) con:

```sh
python run_backend.py
```

Esto iniciará:
- Docker Manager en http://localhost:9000
- API Agent en http://localhost:8001

También puedes usar la CLI interactiva:

```sh
python cli_agent.py --interactive
```

O acceder a la documentación de la API REST:

- http://localhost:8001/docs

## Ejecución de tests

El proyecto incluye un conjunto de tests automáticos para el backend, usando `pytest` y `fastapi.testclient`.

### ¿Qué se prueba?

- **Estado y ciclo de vida del contenedor Docker**: creación, reinicio, estado.
- **Ejecución de comandos dentro del contenedor**: comandos simples, creación de archivos, manejo de errores.
- **Copiado de archivos hacia y desde el contenedor**.
- **Instalación de dependencias (pip y apt)**.
- **Permisos de archivos y búsqueda de archivos**.

### Cómo ejecutar los tests

Asegúrate de que Docker esté corriendo y que no haya conflictos de puertos.

Desde la raíz del proyecto:

```sh
pytest test_docker_manager.py
```

Esto lanzará los tests definidos en `test_docker_manager.py` y mostrará el resultado en consola.

## Estructura principal de archivos

- `docker_manager_app.py`: API REST principal para gestión de contenedor Docker.
- `api_agent.py`: API para gestión de tareas y planes de ejecución.
- `cli_agent.py`: Interfaz de línea de comandos para interacción con el agente.
- `test_docker_manager.py`: Tests automáticos del backend.
- `requirements.txt`: Dependencias de Python.
- `run_backend.py`: Script para lanzar ambos servicios backend.
- `run.py`: Script avanzado para gestión de puertos y frontend.

## Notas adicionales

- El contenedor Docker se crea y gestiona automáticamente; los tests lo reinician según sea necesario.
- Si tienes problemas con permisos o puertos, revisa que Docker esté correctamente instalado y que los puertos 9000 y 8001 estén libres.
- Para desarrollo avanzado, revisa los archivos `structured_agent.py` y `apt_helper.py` para lógica de agentes y utilidades de instalación.

---

**Autor:** Alejandro

**Licencia:** MIT
