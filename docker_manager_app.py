import os
import io
import tarfile
import tempfile
import shutil
import logging
import re
from datetime import datetime
from contextlib import asynccontextmanager
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Query, Body
from fastapi.responses import StreamingResponse, JSONResponse, PlainTextResponse
import docker
from docker.errors import APIError, NotFound
from collections import Counter
import math  # Added import

# Configuración del logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
log = logging.getLogger(__name__)

# Inicialización de FastAPI y cliente Docker
try:
    docker_client = docker.from_env()
    docker_client.ping()
    log.info("Docker client initialized and connected successfully.")
except Exception as e:
    log.error(f"Failed to initialize Docker client: {e}")
    docker_client = None # Allow app to start, endpoints will fail

CONTAINER_NAME = os.getenv("CONTAINER_NAME", "managed_container_pytest")
IMAGE_NAME = os.getenv("IMAGE_NAME", "ubuntu:latest")
CONTAINER_WORKSPACE = "/workspace" # Must be Unix-style

# --- Funciones Auxiliares de Path ---
def to_unix_path(path_str: str) -> str:
    """Convierte un path de OS a formato Unix (con /)."""
    return path_str.replace(os.sep, '/')

# --- Funciones Auxiliares Docker ---

def cleanup_containers():
    if not docker_client: return
    log.info(f"Cleaning up container '{CONTAINER_NAME}' and orphans...")
    try:
        cont = docker_client.containers.get(CONTAINER_NAME)
        log.info(f"Removing container {cont.name} ({cont.id[:12]})...")
        cont.remove(force=True)
    except NotFound:
        log.info(f"Container '{CONTAINER_NAME}' not found, no need to remove.")
    except APIError as e:
        log.error(f"Error removing container '{CONTAINER_NAME}': {e}")
    try:
        filters = {"label": "managed_by=docker_manager_app"}
        orphan_containers = docker_client.containers.list(all=True, filters=filters)
        for cont in orphan_containers:
            if cont.name != CONTAINER_NAME:
                log.info(f"Removing orphan container {cont.name} ({cont.id[:12]})...")
                try:
                    cont.remove(force=True)
                except APIError as e:
                    log.warning(f"Could not remove orphan container {cont.name}: {e}")
    except APIError as e:
        log.error(f"Error listing containers for cleanup: {e}")

def ensure_workspace_dir(container):
    unix_workspace_path = to_unix_path(CONTAINER_WORKSPACE)
    try:
        log.debug(f"Ensuring {unix_workspace_path} exists in container {container.id[:12]}")
        # Use array form for exec_run cmd for clarity with paths
        exit_code, _ = container.exec_run(cmd=["mkdir", "-p", unix_workspace_path])
        if exit_code != 0:
            log.warning(f"Command 'mkdir -p {unix_workspace_path}' exited with code {exit_code} in container {container.id[:12]}.")
        return exit_code == 0
    except APIError as e:
        log.error(f"Failed to ensure workspace directory in container {container.id[:12]}: {e}")
        return False

def create_container():
    if not docker_client:
        raise HTTPException(status_code=503, detail="Docker client not available for container creation.")
    
    unix_workspace_path = to_unix_path(CONTAINER_WORKSPACE)
    log.info(f"Creating new container '{CONTAINER_NAME}' from image '{IMAGE_NAME}' with working_dir '{unix_workspace_path}'...")
    try:
        container = docker_client.containers.run(
            IMAGE_NAME,
            name=CONTAINER_NAME,
            detach=True,
            tty=True,
            stdin_open=True,
            labels={"managed_by": "docker_manager_app"},
            working_dir=unix_workspace_path # Set working directory to Unix-style path
        )
        log.info(f"Container '{container.name}' ({container.id[:12]}) created.")
        if not ensure_workspace_dir(container): # Still ensure explicitly, working_dir might not always create
             log.warning(f"Failed to create workspace directory in new container {container.id[:12]}.")
        return container
    except APIError as e:
        log.error(f"Failed to create container '{CONTAINER_NAME}': {e}")
        raise HTTPException(status_code=500, detail=f"Failed to create initial container: {e}")

_container_instance = None
def get_container(force_reload=False):
    global _container_instance
    if not docker_client:
        raise HTTPException(status_code=503, detail="Docker client not available.")

    if _container_instance and not force_reload:
        try:
            _container_instance.reload()
            if _container_instance.status not in ["running", "restarting"]:
                 log.warning(f"Cached container '{_container_instance.name}' not running (status: {_container_instance.status}). Attempting start.")
                 _container_instance.start()
                 _container_instance.reload()
                 if _container_instance.status != "running":
                     log.error(f"Failed to start cached container '{_container_instance.name}'. Current status: {_container_instance.status}")
                     _container_instance = None # Invalidate if start failed
                 else:
                     log.info(f"Cached container '{_container_instance.name}' started.")
            if _container_instance and _container_instance.status == "running": # Check again after potential start
                ensure_workspace_dir(_container_instance)
                return _container_instance
        except NotFound:
            log.info(f"Cached container instance '{CONTAINER_NAME}' no longer found.")
            _container_instance = None
        except APIError as e:
            log.error(f"API error with cached container '{CONTAINER_NAME}': {e}.")
            _container_instance = None

    # If cache is invalid or force_reload
    try:
        cont = docker_client.containers.get(CONTAINER_NAME)
        log.info(f"Found existing container '{CONTAINER_NAME}' ({cont.id[:12]}). Status: {cont.status}")
        if cont.status == "created" or cont.status == "exited":
            log.info(f"Container '{CONTAINER_NAME}' found in '{cont.status}' state, starting...")
            cont.start()
            cont.reload()
        elif cont.status not in ["running", "restarting"]:
            log.warning(f"Container '{CONTAINER_NAME}' found in state: {cont.status}. Attempting forced reset logic.")
            # This state is problematic, might be better to cleanup and recreate
            raise NotFound("Container in unusable state, triggering recreation.")
        
        _container_instance = cont
        ensure_workspace_dir(_container_instance)
        log.debug(f"Returning container '{_container_instance.name}' ({_container_instance.id[:12]}) in status '{_container_instance.status}'")
        return _container_instance
    except NotFound:
        log.warning(f"Container '{CONTAINER_NAME}' not found or in unusable state. Attempting to create a new one.")
        _container_instance = create_container()
        return _container_instance
    except APIError as e:
        log.error(f"API error getting/managing container '{CONTAINER_NAME}': {e}")
        _container_instance = None # Invalidate cache on other API errors
        raise HTTPException(status_code=500, detail=f"API error accessing container state: {e}")


# --- Ciclo de Vida de la Aplicación (Lifespan) ---
@asynccontextmanager
async def lifespan(app_instance: FastAPI):
    log.info("Application startup sequence initiated.")
    if not docker_client:
        log.critical("Docker client is not initialized. Most app functionality will fail.")
    else:
        cleanup_containers()
        try:
            get_container(force_reload=True)
            log.info("Initial container ensured/created successfully.")
        except Exception as e:
            log.critical(f"CRITICAL: Failed to ensure/create initial container during startup: {e}. Application might be unstable.")
    yield
    log.info("Application shutdown sequence initiated.")
    # cleanup_containers() # Optional

app = FastAPI(lifespan=lifespan)

# --- Endpoints de la API ---

@app.post("/run", summary="Run a command inside the container")
def run_command(command: str = Form(...), workdir: str = Form(None)):
    cont = get_container()
    log.info(f"Executing command in {cont.id[:12]}: {command[:100]}{'...' if len(command)>100 else ''}")
    
    unix_container_workspace = to_unix_path(CONTAINER_WORKSPACE)
    effective_workdir_unix: str
    if workdir:
        if not workdir.startswith("/"):
            full_workdir = os.path.join(unix_container_workspace, workdir)
        else:
            full_workdir = workdir
        
        normalized_full_workdir = os.path.normpath(full_workdir)
        effective_workdir_unix = to_unix_path(normalized_full_workdir)
        if not effective_workdir_unix.startswith(unix_container_workspace):
            log.warning(f"Workdir '{effective_workdir_unix}' is outside main workspace '{unix_container_workspace}'. Forcing to workspace root.")
            effective_workdir_unix = unix_container_workspace
    else:
        effective_workdir_unix = unix_container_workspace

    # --- Logging persistente ---
    log_file_path = f"{unix_container_workspace}/colabai_commands.log"
    timestamp = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")
    log_entry_header = f"\n---\n[{timestamp}] CMD: {command}\n"

    try:
        _, output_stream_generator = cont.exec_run(
            cmd=["/bin/bash", "-c", command],
            stream=True,
            demux=False,
            tty=False, 
            workdir=effective_workdir_unix
        )
        
        async def logging_stream_wrapper(gen):
            output_bytes = b""
            for chunk in gen:
                if chunk is not None:
                    output_bytes += chunk
                    yield chunk
            # Guardar en log persistente al finalizar
            # Codificamos la salida como utf-8, ignorando errores
            safe_output = output_bytes.decode("utf-8", errors="replace")
            log_entry = log_entry_header + safe_output + "\n"
            # Escribimos el log en el contenedor (append)
            cont.exec_run(cmd=["/bin/bash", "-c", f"echo {repr(log_entry)} >> {log_file_path}"])
        
        return StreamingResponse(logging_stream_wrapper(output_stream_generator), media_type="text/plain")
    except APIError as e:
        log.error(f"API error running command '{command}' in {cont.id[:12]}: {e}")
        raise HTTPException(status_code=500, detail=f"Docker API error executing command: {e}")
    except Exception as e:
         log.error(f"Unexpected error running command '{command}' in {cont.id[:12]}: {e}")
         raise HTTPException(status_code=500, detail=f"Unexpected error executing command: {e}")

@app.post("/copy_to", summary="Copy a file into the container")
async def copy_to_docker(
    container_path: str = Form(...), 
    file: UploadFile = File(...)
):
    cont = get_container()
    
    # Normalize the user-provided container_path and ensure it's Unix-style
    # Assume container_path is intended as an absolute path or relative to /
    norm_container_path_os = os.path.normpath(container_path)
    final_container_path_unix = to_unix_path(norm_container_path_os)

    # The directory where the tar will be extracted in the container (must be Unix-style)
    target_dir_in_container_unix = to_unix_path(os.path.dirname(final_container_path_unix))
    # The name the file will have inside the tar archive (basename is usually OS-agnostic for simple names)
    arcname_in_tar = os.path.basename(final_container_path_unix) 

    # Handle cases like copying to root ('/') or if dirname is empty/'.'
    if not target_dir_in_container_unix or target_dir_in_container_unix == ".":
        # If original container_path was "file.txt", final becomes "/file.txt", dirname is "/"
        # If original container_path was "/file.txt", final is "/file.txt", dirname is "/"
        if final_container_path_unix.startswith("/") and not os.path.dirname(final_container_path_unix) == "/":
             # e.g. final_container_path_unix = /file.txt, os.path.dirname gives /
             pass # target_dir_in_container_unix is already correct (e.g. "/")
        else: # If input was truly relative like "file.txt", default to workspace
            target_dir_in_container_unix = to_unix_path(CONTAINER_WORKSPACE)


    log.info(f"Copying '{file.filename}' as '{arcname_in_tar}' to dir '{target_dir_in_container_unix}' in {cont.id[:12]}")

    # Ensure target directory exists in container using Unix path
    exit_code, out_mkdir = cont.exec_run(cmd=["mkdir", "-p", target_dir_in_container_unix])
    if exit_code != 0:
        err_msg = f"Failed to create target directory '{target_dir_in_container_unix}' in container: {out_mkdir.decode()}"
        log.error(err_msg)
        raise HTTPException(status_code=500, detail=err_msg)

    # Save uploaded file to a temporary local file
    with tempfile.NamedTemporaryFile(delete=False, prefix="upload_", suffix=f"_{file.filename or 'unknown'}") as tmp_file:
        local_tmp_path = tmp_file.name
        shutil.copyfileobj(file.file, tmp_file)
    
    try:
        tar_stream = io.BytesIO()
        with tarfile.open(fileobj=tar_stream, mode='w') as tar:
            tar.add(local_tmp_path, arcname=arcname_in_tar)
        tar_stream.seek(0)

        # path for put_archive must be Unix-style
        success = cont.put_archive(path=target_dir_in_container_unix, data=tar_stream.read())
        if not success:
             log.error(f"put_archive reported failure for copying '{file.filename}' to {cont.id[:12]}:{final_container_path_unix}")
             raise HTTPException(status_code=500, detail="Docker reported failure during file copy (put_archive). Check container permissions and path.")
        
        log.info(f"File '{file.filename}' successfully copied to {cont.id[:12]}:{final_container_path_unix}")
        return JSONResponse(
            status_code=200,
            content={"detail": f"File '{file.filename}' copied into container at '{final_container_path_unix}'"}
        )
    except APIError as e:
        log.error(f"API error copying file '{file.filename}' to {cont.id[:12]}:{final_container_path_unix}: {e}")
        raise HTTPException(status_code=500, detail=f"Docker API error copying file: {e}")
    finally:
        await file.close()
        if os.path.exists(local_tmp_path):
            os.remove(local_tmp_path)


@app.get("/copy_from", summary="Copy a file or directory from the container as a TAR archive")
def copy_from_docker(container_path: str, archive_name: str = "archive.tar"):
    cont = get_container()
    
    unix_container_path = to_unix_path(os.path.normpath(container_path)) # Normalize and ensure Unix
    log.info(f"Attempting to copy from {cont.id[:12]}:{unix_container_path}")
    
    if ".." in unix_container_path.split('/'): # More robust ".." check for Unix paths
        raise HTTPException(status_code=400, detail="Path traversal detected in container_path.")

    safe_archive_name = os.path.basename(archive_name or "archive.tar") # Basename is fine
    if not safe_archive_name.endswith(".tar"):
        safe_archive_name += ".tar"
    
    try:
        # Verify path exists using Unix path
        exit_code, stat_out = cont.exec_run(cmd=["stat", unix_container_path])
        if exit_code != 0:
            log.warning(f"Path not found/accessible in container {cont.id[:12]}: {unix_container_path}. Output: {stat_out.decode()}")
            raise NotFound(f"Path not found in container: {unix_container_path}")

        stream, stat_info = cont.get_archive(unix_container_path) # API expects Unix path
        log.info(f"Successfully retrieved archive stream for {unix_container_path}. Stat: {stat_info}")
        return StreamingResponse(stream, media_type="application/x-tar", headers={
            "Content-Disposition": f"attachment; filename=\"{safe_archive_name}\""
        })
    except NotFound:
        log.warning(f"Path not found in container {cont.id[:12]}:{unix_container_path}")
        raise HTTPException(status_code=404, detail=f"Path not found in container: {unix_container_path}")
    except APIError as e:
        if isinstance(e, NotFound) or ("No such file or directory" in str(e.explanation) or "not found" in str(e.explanation).lower()):
            log.warning(f"Path not found (APIError) in {cont.id[:12]}:{unix_container_path} - {e}")
            raise HTTPException(status_code=404, detail=f"Path not found in container: {unix_container_path} - {e.explanation}")
        log.error(f"API error getting archive from {cont.id[:12]}:{unix_container_path}: {e}")
        raise HTTPException(status_code=500, detail=f"Docker API error getting archive: {e}")
    except Exception as e:
        log.error(f"Unexpected error copying from {cont.id[:12]}:{unix_container_path}: {e}")
        raise HTTPException(status_code=500, detail=f"Unexpected server error getting archive: {e}")


@app.get("/status", summary="Get container status")
def status():
    cont = get_container()
    log.info(f"Reporting status for container {cont.name} ({cont.id[:12]})")
    image_tag = "unknown"
    if cont.image.tags: image_tag = cont.image.tags[0]
    elif cont.image.id: image_tag = str(cont.image.id)

    return {
        "id": cont.id,
        "name": cont.name,
        "status": cont.status,
        "image": image_tag,
        "workspace": to_unix_path(CONTAINER_WORKSPACE),
        "working_dir": to_unix_path(cont.attrs['Config']['WorkingDir'])
    }

@app.post("/reset", summary="Reset container")
def reset_container_endpoint():
    log.warning("Received request to reset container.")
    cleanup_containers()
    try:
        get_container(force_reload=True)
        log.info("Container reset successfully.")
        return JSONResponse({"detail": "Container reset successfully"})
    except Exception as e:
        log.error(f"Failed to create new container after reset: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to create new container after reset: {e}")

@app.get("/commands_log", summary="Obtener el log persistente de comandos ejecutados")
def get_commands_log():
    cont = get_container()
    log_file_path = f"{to_unix_path(CONTAINER_WORKSPACE)}/colabai_commands.log"
    # Usar cat para leer el archivo de log
    exit_code, output = cont.exec_run(cmd=["/bin/bash", "-c", f"cat {log_file_path} 2>/dev/null || true"])
    content = output.decode("utf-8", errors="replace")
    return PlainTextResponse(content, media_type="text/plain")

# --- New Endpoints ---

@app.get("/list_files", summary="List files and directories in a container path")
def list_files(path: str = Query(CONTAINER_WORKSPACE, description="Path in the container to list files from.")):
    cont = get_container()
    
    # Normalize and ensure Unix path for Docker command
    query_path_unix = to_unix_path(os.path.normpath(path))
    
    if ".." in query_path_unix.split('/'):
        raise HTTPException(status_code=400, detail="Path traversal detected.")
    
    # Ensure path is absolute for consistency or make it relative to workspace
    if not query_path_unix.startswith("/"):
        effective_path_unix = to_unix_path(os.path.join(CONTAINER_WORKSPACE, query_path_unix))
        effective_path_unix = to_unix_path(os.path.normpath(effective_path_unix)) # Normalize again
    else:
        effective_path_unix = query_path_unix

    # Optional: strict check if path must be under CONTAINER_WORKSPACE
    # unix_container_workspace = to_unix_path(CONTAINER_WORKSPACE)
    # if not effective_path_unix.startswith(unix_container_workspace):
    #     raise HTTPException(status_code=400, detail=f"Path must be within {unix_container_workspace}")

    log.info(f"Listing files in {cont.id[:12]}:{effective_path_unix}")
    
    exit_code, output = cont.exec_run(cmd=["ls", "-Alp", "--full-time", effective_path_unix], tty=False)
    output_str = output.decode()
    
    if exit_code == 0:
        lines = output_str.strip().split('\n')
        if not lines or (len(lines)==1 and lines[0].startswith("total")):
            return JSONResponse(content={"path": effective_path_unix, "files": []})
        if lines[0].startswith("total "): lines = lines[1:]
        
        files_list = []
        for line in lines:
            parts = line.split(maxsplit=8)
            if len(parts) < 9: continue
            name = parts[8]
            item_type = "file"
            if name.endswith('/'):
                item_type = "directory"
                name = name[:-1]
            files_list.append({
                "name": name, "type": item_type, "permissions": parts[0],
                "links": parts[1], "owner": parts[2], "group": parts[3],
                "size": parts[4], "last_modified": f"{parts[5]} {parts[6]} {parts[7]}",
                "full_path": to_unix_path(os.path.join(effective_path_unix, name)) # Construct full Unix path
            })
        return JSONResponse(content={"path": effective_path_unix, "files": files_list})
    elif "No such file or directory" in output_str:
        raise HTTPException(status_code=404, detail=f"Path not found in container: {effective_path_unix}")
    else:
        log.error(f"Error listing files in {effective_path_unix}: {output_str}")
        raise HTTPException(status_code=500, detail=f"Error listing files: {output_str}")

@app.delete("/delete_path", summary="Delete a file or directory in the container's workspace")
def delete_path(container_path: str = Query(..., description="Path to delete. If relative, assumed under workspace.")):
    cont = get_container()

    # Construct absolute Unix path, ensuring it's under workspace for safety
    if container_path.startswith('/'):
        # If an absolute path is given, it MUST be under CONTAINER_WORKSPACE
        # Or we decide a policy for it. For now, let's assume relative or under workspace.
        # This logic can be made stricter.
        # If input was truly relative like "file.txt", default to workspace
        norm_path = to_unix_path(os.path.normpath(container_path))
    else:
        norm_path = to_unix_path(os.path.normpath(os.path.join(CONTAINER_WORKSPACE, container_path)))

    unix_container_workspace = to_unix_path(CONTAINER_WORKSPACE)
    if not norm_path.startswith(unix_container_workspace + "/") or norm_path == unix_container_workspace : # Check if trying to delete workspace itself
        if norm_path == unix_container_workspace and container_path in ('/', '.', unix_container_workspace): # Allow deleting workspace content, but not workspace via "/"
             raise HTTPException(status_code=403, detail=f"Direct deletion of workspace root '{unix_container_workspace}' is not allowed via this input. Specify sub-paths.")
        elif not norm_path.startswith(unix_container_workspace + "/"): # Deletion outside workspace
             raise HTTPException(status_code=403, detail=f"Deletion outside of {unix_container_workspace} is not allowed. Path: {norm_path}")


    log.info(f"Attempting to delete {cont.id[:12]}:{norm_path}")
    exit_code, output = cont.exec_run(cmd=["rm", "-rf", norm_path], tty=False)
    output_str = output.decode()

    if exit_code == 0:
        return JSONResponse({"detail": f"Path '{norm_path}' deleted successfully."})
    elif "No such file or directory" in output_str:
        raise HTTPException(status_code=404, detail=f"Path not found: {norm_path}")
    else:
        log.error(f"Error deleting path {norm_path}: {output_str}")
        raise HTTPException(status_code=500, detail=f"Error deleting path: {output_str}")

@app.get("/read_file", summary="Read content of a file from the container")
async def read_file(container_path: str = Query(..., description="Path to the file in the container.")):
    cont = get_container()
    unix_path = to_unix_path(os.path.normpath(container_path))
    log.info(f"Attempting to read file from {cont.id[:12]}:{unix_path}")

    if ".." in unix_path.split('/'):
        raise HTTPException(status_code=400, detail="Path traversal detected.")

    try:
        exit_code, stat_out = cont.exec_run(cmd=["stat", "-c", "%F", unix_path])
        stat_out_decoded = stat_out.decode().strip()
        if exit_code != 0:
            raise NotFound(f"Path not found or not accessible: {unix_path}")
        if stat_out_decoded != "regular file" and stat_out_decoded != "regular empty file":
             raise HTTPException(status_code=400, detail=f"Path is not a regular file: {unix_path} (type: {stat_out_decoded})")

        stream, _ = cont.get_archive(unix_path) # API expects Unix path
        
        tar_bytes = io.BytesIO()
        for chunk in stream: tar_bytes.write(chunk)
        tar_bytes.seek(0)

        with tarfile.open(fileobj=tar_bytes, mode="r") as tar:
            file_basename = os.path.basename(unix_path)
            try: member = tar.getmember(file_basename)
            except KeyError:
                 members = [m for m in tar.getmembers() if m.isfile()]
                 if not members: raise HTTPException(status_code=500, detail="Could not find file in archive from container.")
                 member = members[0]
            
            extracted_file = tar.extractfile(member)
            if extracted_file:
                content = extracted_file.read()
                # Determine media type more reliably
                media_type = "application/octet-stream" # Default
                try:
                    decoded_content_for_check = content.decode('utf-8')
                    # Heuristic: If it decodes and contains typical text characters or newlines, it's likely text.
                    # This is a simple check; a more robust one might involve checking for non-printable chars.
                    if '\n' in decoded_content_for_check or all(31 < ord(char) < 127 or ord(char) in (9,10,13) for char in decoded_content_for_check[:1024]):
                        media_type = "text/plain; charset=utf-8"
                except UnicodeDecodeError:
                    pass # Stays application/octet-stream
                
                return StreamingResponse(io.BytesIO(content), media_type=media_type, headers={
                    "Content-Disposition": f"attachment; filename=\"{os.path.basename(unix_path)}\""
                })
            else: raise HTTPException(status_code=500, detail="Could not extract file from archive.")
    except NotFound:
        log.warning(f"File not found in container {cont.id[:12]}:{unix_path}")
        raise HTTPException(status_code=404, detail=f"File not found in container: {unix_path}")
    except APIError as e:
        if hasattr(e, 'explanation') and e.explanation and ("No such file or directory" in str(e.explanation) or "not found" in str(e.explanation).lower()):
             raise HTTPException(status_code=404, detail=f"File not found in container (API Error): {unix_path}")
        log.error(f"API error reading file from {cont.id[:12]}:{unix_path}: {e}")
        raise HTTPException(status_code=500, detail=f"Docker API error reading file: {e}")
    except Exception as e:
        log.error(f"Unexpected error reading file from {cont.id[:12]}:{unix_path}: {type(e).__name__} {e}")
        raise HTTPException(status_code=500, detail=f"Unexpected server error reading file: {e}")

@app.post("/execute_script", summary="Upload and execute a script in the container")
async def execute_script(
    script_file: UploadFile = File(...),
    interpreter: str = Form("bash", description="Interpreter (bash, python3, sh)."),
    args: str = Form("", description="Arguments to pass to the script.")
):
    cont = get_container()
    
    base, ext = os.path.splitext(script_file.filename or "script")
    script_name_on_container = f"exec_script_{datetime.now().strftime('%Y%m%d%H%M%S%f')}{ext or '.tmp'}"
    
    unix_container_workspace = to_unix_path(CONTAINER_WORKSPACE)
    container_script_path_unix = to_unix_path(os.path.join(unix_container_workspace, script_name_on_container))

    log.info(f"Uploading script '{script_file.filename}' to {container_script_path_unix} for execution with '{interpreter} {args}'")

    local_script_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, prefix="script_upload_") as tmp_local_script:
            shutil.copyfileobj(script_file.file, tmp_local_script)
            local_script_path = tmp_local_script.name
        
        tar_stream = io.BytesIO()
        with tarfile.open(fileobj=tar_stream, mode='w') as tar:
            tar.add(local_script_path, arcname=script_name_on_container)
        tar_stream.seek(0)

        if not cont.put_archive(path=unix_container_workspace, data=tar_stream.read()): # path is Unix
            raise HTTPException(status_code=500, detail="Failed to copy script to container.")
    finally:
        await script_file.close()
        if local_script_path and os.path.exists(local_script_path):
            os.remove(local_script_path)

    exit_code_chmod, out_chmod = cont.exec_run(cmd=["chmod", "+x", container_script_path_unix])
    if exit_code_chmod != 0:
        cont.exec_run(cmd=["rm", "-f", container_script_path_unix])
        log.error(f"Failed to chmod +x {container_script_path_unix}: {out_chmod.decode()}")
        raise HTTPException(status_code=500, detail=f"Failed to make script executable: {out_chmod.decode()}")

    command_to_run = f"{interpreter} {container_script_path_unix} {args}"
    log.info(f"Executing script in container: {command_to_run}")
    
    try:
        # Use the corrected pattern for exec_run stream
        _, output_generator = cont.exec_run(
            cmd=["/bin/bash", "-c", command_to_run],
            stream=True, demux=False, tty=False, workdir=unix_container_workspace
        )
        
        async def final_output_generator_with_cleanup(gen):
            try:
                for chunk in gen:
                    if chunk is not None: yield chunk
            finally:
                log.info(f"Deleting script {container_script_path_unix} after execution.")
                del_ec, del_out = cont.exec_run(cmd=["rm", "-f", container_script_path_unix])
                if del_ec != 0: log.warning(f"Failed to delete script {container_script_path_unix}: {del_out.decode()}")

        return StreamingResponse(final_output_generator_with_cleanup(output_generator), media_type="text/plain")
    except APIError as e:
        log.error(f"API error executing script '{command_to_run}': {e}")
        cont.exec_run(cmd=["rm", "-f", container_script_path_unix])
        raise HTTPException(status_code=500, detail=f"Docker API error executing script: {e}")


@app.get("/container_logs", summary="Get recent logs from the container")
def get_container_logs(tail: int = Query(100, description="Number of log lines.")):
    cont = get_container()
    try:
        logs = cont.logs(tail=tail, stdout=True, stderr=True, timestamps=True)
        return PlainTextResponse(logs.decode('utf-8', errors='replace'))
    except APIError as e:
        log.error(f"API error getting logs for {cont.id[:12]}: {e}")
        raise HTTPException(status_code=500, detail=f"Docker API error getting logs: {e}")

@app.get("/container_stats", summary="Get resource usage statistics for the container")
def get_container_stats():
    cont = get_container()
    try:
        # For stream=False, decode is not needed and causes error. Result is already a dict.
        stats_data = cont.stats(stream=False) 
        return JSONResponse(content=stats_data)
    except APIError as e:
        log.error(f"API error getting stats for {cont.id[:12]}: {e}")
        raise HTTPException(status_code=500, detail=f"Docker API error getting stats: {e}")

def sanitize_for_http_header(text: str) -> str:
    """
    Sanitiza un texto para que pueda ser usado de forma segura en headers HTTP.
    Los headers HTTP solo pueden contener caracteres ASCII.
    """
    # Reemplazar caracteres no ASCII con ? y limitar la longitud
    ascii_text = text.encode('ascii', errors='replace').decode('ascii')
    # Limitar a 1024 caracteres para evitar headers muy grandes
    return ascii_text[:1024]

@app.post("/install_dependencies", summary="Install dependencies from a file (requirements.txt, packages.txt)")
async def install_dependencies(
    dep_file: UploadFile = File(...),
    dep_type: str = Form(..., description="'pip' for requirements.txt, 'apt' for packages list.")
):
    cont = get_container()
    original_filename = dep_file.filename or "dependencies"
    unix_container_workspace = to_unix_path(CONTAINER_WORKSPACE)

    apt_install_template = r"apt-get update && apt-get install -y $(cat {} | sed 's/#.*//' | grep -v '^\s*$' | tr '\n' ' ')"

    if dep_type == "pip":
        container_dep_filename = "requirements_uploaded.txt"
        install_command_template = "python3 -m pip install --no-cache-dir --break-system-packages -r {}"
        check_cmd = "apt-get update && apt-get install -y python3-pip"
        log.info("Ensuring python3-pip for pip dependencies...")
        # Considerar hacer este chequeo bloqueante también o asumir que pip está
        ec_check, out_check = cont.exec_run(cmd=["/bin/bash", "-c", check_cmd])
        if ec_check != 0:
            log.warning(f"python3-pip check/install command issues: {out_check.decode(errors='ignore')[:200]}")
            # Podrías incluso fallar aquí si pip es esencial y no se puede instalar
    elif dep_type == "apt":
        container_dep_filename = "packages_uploaded.list"
        install_command_template = apt_install_template
    else:
        await dep_file.close() # Asegurarse de cerrar el archivo
        raise HTTPException(status_code=400, detail="Invalid dep_type. Must be 'pip' or 'apt'.")

    container_dep_path_unix = to_unix_path(os.path.join(unix_container_workspace, container_dep_filename))
    log.info(f"Uploading '{original_filename}' as '{container_dep_path_unix}' for type '{dep_type}'")

    local_file_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, prefix="dep_upload_") as tmp_local_file:
            shutil.copyfileobj(dep_file.file, tmp_local_file)
            local_file_path = tmp_local_file.name
        
        tar_stream = io.BytesIO()
        with tarfile.open(fileobj=tar_stream, mode='w') as tar:
            tar.add(local_file_path, arcname=container_dep_filename)
        tar_stream.seek(0)

        if not cont.put_archive(path=unix_container_workspace, data=tar_stream.read()):
            raise HTTPException(status_code=500, detail=f"Failed to copy dep file to container: {container_dep_path_unix}")
    finally:
        await dep_file.close() # Cerrar el archivo aquí después de usarlo
        if local_file_path and os.path.exists(local_file_path):
            os.remove(local_file_path)

    install_command = install_command_template.format(container_dep_path_unix)
    log.info(f"Executing install command (blocking): {install_command}")
    
    # Cambiar a ejecución bloqueante para obtener el código de salida
    exit_code, output_bytes = cont.exec_run(
        cmd=["/bin/bash", "-c", install_command], demux=False, tty=True, workdir=unix_container_workspace
    )
    
    output_str = output_bytes.decode("utf-8", errors="replace")

    log.info(f"Install command exit code: {exit_code}")
    # log.debug(f"Install command output:\n{output_str}") # Puede ser muy verboso

    # Limpiar el archivo de dependencias después del intento
    log.info(f"Deleting dep file {container_dep_path_unix} after install attempt.")
    cont.exec_run(cmd=["rm", "-f", container_dep_path_unix])

    if exit_code == 0:
        return JSONResponse(
            status_code=200,
            content={"detail": "Dependencies installed successfully.", "output": output_str}
        )
    else:
        log.error(f"Dependency installation failed with exit code {exit_code}.")
        # Sanitizar el output para los headers HTTP y limitar su longitud
        safe_output = sanitize_for_http_header(output_str)
        raise HTTPException(
            status_code=500,
            detail=f"Dependency installation failed with exit code {exit_code}.",
            headers={"X-Install-Output": safe_output} 
        )

@app.post("/chmod_path", summary="Change permissions of a file/directory in container's workspace")
def chmod_path(
    container_path: str = Form(..., description="Path relative to workspace or absolute."),
    mode: str = Form(..., description="Permission mode (e.g., 755, u+x).")
):
    cont = get_container()

    if ".." in mode: raise HTTPException(status_code=400, detail="Invalid characters in mode.")

    # Construct absolute Unix path
    if container_path.startswith('/'):
        abs_path_unix = to_unix_path(os.path.normpath(container_path))
    else:
        abs_path_unix = to_unix_path(os.path.normpath(os.path.join(CONTAINER_WORKSPACE, container_path)))
    
    # Security: could add check to ensure path is within workspace if desired.
    # unix_container_workspace = to_unix_path(CONTAINER_WORKSPACE)
    # if not abs_path_unix.startswith(unix_container_workspace):
    #     raise HTTPException(status_code=403, detail=f"Chmod outside of {unix_container_workspace} not allowed.")


    log.info(f"Attempting to chmod {mode} on {cont.id[:12]}:{abs_path_unix}")
    exit_code, output = cont.exec_run(cmd=["chmod", mode, abs_path_unix], tty=False)
    output_str = output.decode()

    if exit_code == 0:
        return JSONResponse({"detail": f"Permissions for '{abs_path_unix}' changed to '{mode}' successfully."})
    elif "No such file or directory" in output_str:
        raise HTTPException(status_code=404, detail=f"Path not found: {abs_path_unix}")
    elif "invalid mode" in output_str.lower():
        raise HTTPException(status_code=400, detail=f"Invalid mode: {mode}. Error: {output_str}")
    else:
        log.error(f"Error changing permissions for {abs_path_unix}: {output_str}")
        raise HTTPException(status_code=500, detail=f"Error changing permissions: {output_str}")

@app.get("/search_files", summary="Buscar archivos por patrón en el contenedor")
def search_files(
    pattern: str = Query(..., description="Patrón de búsqueda de archivos (ej: *.py o substring)", min_length=1),
    base_path: str = Query(CONTAINER_WORKSPACE, description="Directorio base para buscar")
):
    cont = get_container()
    base_path_unix = to_unix_path(os.path.normpath(base_path))
    # Usar find para buscar archivos
    cmd = f"find {base_path_unix} -type f -name '{pattern}' 2>/dev/null || true"
    exit_code, output = cont.exec_run(cmd=["/bin/bash", "-c", cmd])
    files = [line.strip() for line in output.decode().splitlines() if line.strip()]
    return {"files": files}

@app.get("/search_in_files", summary="Buscar texto dentro de archivos en el contenedor")
def search_in_files(
    query: str = Query(..., description="Texto a buscar en los archivos", min_length=1),
    base_path: str = Query(CONTAINER_WORKSPACE, description="Directorio base para buscar")
):
    cont = get_container()
    base_path_unix = to_unix_path(os.path.normpath(base_path))
    # Usar grep recursivo
    cmd = f"grep -rn --color=never --exclude-dir=.git '{query}' {base_path_unix} 2>/dev/null || true"
    exit_code, output = cont.exec_run(cmd=["/bin/bash", "-c", cmd])
    results = []
    for line in output.decode().splitlines():
        if ':' in line:
            path, lineno, content = line.split(':', 2)
            results.append({"file": path, "line": int(lineno), "content": content.strip()})
    return {"results": results}

@app.post("/edit_file_lines", summary="Edit specific lines of a file in the container, replacing them with new content")
def edit_file_lines(
    container_path: str = Form(..., description="Path to the file in the container (absolute or relative to workspace)."),
    start_line: int = Form(..., description="First line to replace (1-based, inclusive)."),
    end_line: int = Form(..., description="Last line to replace (1-based, inclusive)."),
    new_content: str = Form(..., description="New content to insert (can be multiline, \n separated)."),
):
    import os, tempfile, tarfile, io
    cont = get_container()
    # Normalizar path
    if container_path.startswith("/"):
        abs_path_unix = to_unix_path(os.path.normpath(container_path))
    else:
        abs_path_unix = to_unix_path(os.path.normpath(os.path.join(CONTAINER_WORKSPACE, container_path)))

    # Validación robusta de path traversal: debe estar bajo el workspace
    unix_workspace = to_unix_path(CONTAINER_WORKSPACE)
    if not abs_path_unix.startswith(unix_workspace + "/") and abs_path_unix != unix_workspace:
        raise HTTPException(status_code=400, detail="Path traversal detected: fuera del workspace.")

    # Leer el archivo original
    exit_code, output = cont.exec_run(cmd=["cat", abs_path_unix])
    if exit_code != 0:
        raise HTTPException(status_code=404, detail=f"File not found or not readable: {abs_path_unix}")
    original_lines = output.decode("utf-8", errors="replace").splitlines(keepends=True)

    # Validar rango
    if start_line < 1 or end_line < start_line or end_line > len(original_lines):
        raise HTTPException(status_code=400, detail="Invalid start line or end line for file.")

    # Detectar indentación previa (si existe)
    prev_line = original_lines[start_line-2] if start_line > 1 else ""
    indent = ""
    for c in prev_line:
        if c in (" ", "\t"): indent += c
        else: break
    # Aplicar indentación solo si la línea original tenía indentación y la nueva línea no es vacía
    new_lines = []
    for l in new_content.splitlines():
        if indent and l.strip():
            new_lines.append(indent + l + "\n")
        else:
            new_lines.append(l + "\n")

    # Construir el nuevo contenido
    new_file_lines = (
        original_lines[:start_line-1] +
        new_lines +
        original_lines[end_line:]
    )
    new_file_content = "".join(new_file_lines)

    # Guardar en archivo temporal
    with tempfile.NamedTemporaryFile(delete=False, mode="w", encoding="utf-8") as tmpf:
        tmpf.write(new_file_content)
        tmp_path = tmpf.name
    # Subir el archivo modificado
    tar_stream = io.BytesIO()
    arcname = os.path.basename(abs_path_unix)
    with tarfile.open(fileobj=tar_stream, mode='w') as tar:
        tar.add(tmp_path, arcname=arcname)
    tar_stream.seek(0)
    target_dir = os.path.dirname(abs_path_unix)
    exit_code_mkdir, _ = cont.exec_run(cmd=["mkdir", "-p", target_dir])
    if not cont.put_archive(path=target_dir, data=tar_stream.read()):
        os.remove(tmp_path)
        raise HTTPException(status_code=500, detail="Failed to copy modified file to container.")
    os.remove(tmp_path)
    return JSONResponse({"detail": f"File '{abs_path_unix}' updated successfully (lines {start_line}-{end_line})."})

@app.put("/edit_file_content", summary="Editar el contenido de un archivo en el contenedor (replace o smart)")
def edit_file_content(
    body: dict
):
    cont = get_container()
    # import re # Already imported at module level if you prefer

    container_path = body.get("container_path")
    content_to_write = body.get("content")
    mode = body.get("mode")
    search_text = body.get("search_text")

    if container_path is None or content_to_write is None or mode is None:
        raise HTTPException(status_code=400, detail="Faltan parámetros obligatorios: container_path, content, mode.")

    if container_path.startswith("/"):
        abs_path_unix = to_unix_path(os.path.normpath(container_path))
    else:
        abs_path_unix = to_unix_path(os.path.normpath(os.path.join(CONTAINER_WORKSPACE, container_path)))

    if ".." in abs_path_unix.split("/"):
        raise HTTPException(status_code=400, detail="Path traversal detectado.")

    final_file_content_str = ""

    if mode == "replace":
        exit_code_check, _ = cont.exec_run(cmd=["stat", abs_path_unix])
        if exit_code_check != 0:
             raise HTTPException(status_code=404, detail=f"Archivo no encontrado para reemplazar: {abs_path_unix}")
        final_file_content_str = content_to_write

    elif mode == "smart":
        exit_code, output = cont.exec_run(cmd=["cat", abs_path_unix])
        if exit_code != 0:
            raise HTTPException(status_code=404, detail=f"Archivo no encontrado o no legible: {abs_path_unix}. Error: {output.decode(errors='replace')}")

        original_text = output.decode("utf-8", errors="replace")
        # Normalize line endings to \n for consistent processing
        original_text = original_text.replace('\r\n', '\n').replace('\r', '\n')
        
        # indent_style is determined once based on the whole original text
        indent_style = analyze_indentation_style(original_text) 
        
        if not search_text: # search_text can be empty string, but not None. The check implies it must be non-empty.
            raise HTTPException(status_code=400, detail="En modo 'smart' se requiere 'search_text' no vacío.")

        def _find_and_replace_block(text, search, replacement, current_indent_style):
            if not search: # search_text from body is already checked for not being None
                return text, 0 
            original_lines = text.splitlines()
            search_lines = search.splitlines()
            num_search_lines = len(search_lines)
            num_original_lines = len(original_lines)

            if num_search_lines == 0 or num_search_lines > num_original_lines:
                return text, 0
            
            # Base indent of the search pattern itself (often empty if search_text is like "dos")
            search_block_base_indent = get_leading_whitespace(search_lines[0])
            
            i = 0
            replacements_made = 0
            while i <= num_original_lines - num_search_lines:
                # This is the indent of the current block in the original text we are checking
                file_block_base_indent = get_leading_whitespace(original_lines[i])
                
                block_matches = True
                # Store the actual full indent of the first line of the potential match in the file
                # This includes file_block_base_indent + any further spaces before the actual content being searched for
                actual_first_line_prefix_in_file = ""

                for j in range(num_search_lines):
                    candidate_line_in_file = original_lines[i + j]
                    search_pattern_line = search_lines[j]

                    # Content of candidate line after its block's base indent
                    content_candidate_after_block_indent = candidate_line_in_file[len(file_block_base_indent):] if candidate_line_in_file.startswith(file_block_base_indent) else candidate_line_in_file
                    # Content of search pattern line after its own block's base indent
                    content_search_after_block_indent = search_pattern_line[len(search_block_base_indent):] if search_pattern_line.startswith(search_block_base_indent) else search_pattern_line
                    
                    if j == 0: # For the first line, determine the full prefix
                        # The part of content_candidate_after_block_indent that is whitespace before the lstrip()'d content
                        internal_ws = get_leading_whitespace(content_candidate_after_block_indent)
                        actual_first_line_prefix_in_file = file_block_base_indent + internal_ws

                    # Compare lstrip'd versions of these content parts
                    if content_candidate_after_block_indent.lstrip() != content_search_after_block_indent.lstrip():
                        block_matches = False
                        break
                
                if block_matches:
                    # Normalize this full prefix using the determined document indent style:
                    effective_indent_str_for_replacement = normalize_indent_str(actual_first_line_prefix_in_file, current_indent_style)
                    
                    replacement_reindented = re_indent_block(replacement, effective_indent_str_for_replacement, current_indent_style)
                    
                    new_lines = (
                        original_lines[:i] + replacement_reindented.splitlines() + original_lines[i + num_search_lines:]
                    )
                    # Important: If search can match multiple times, this will only do the first.
                    # If multiple replacements are needed, the logic must continue searching or text/original_lines must be updated.
                    # For now, assume one replacement is fine as per typical use.
                    return "\n".join(new_lines), 1 
                i += 1
            return text, 0

        final_file_content_str, _ = _find_and_replace_block(original_text, search_text, content_to_write, indent_style)

    else:
        raise HTTPException(status_code=400, detail="Modo no soportado. Usa 'replace' o 'smart'.")

    if final_file_content_str and not final_file_content_str.endswith("\n"):
        final_file_content_str += "\n"

    temp_file_path = ""
    try:
        with tempfile.NamedTemporaryFile(delete=False, mode="wb") as tmpf:
            tmpf.write(final_file_content_str.encode("utf-8"))
            temp_file_path = tmpf.name

        tar_stream = io.BytesIO()
        arcname = os.path.basename(abs_path_unix)
        with tarfile.open(fileobj=tar_stream, mode='w') as tar:
            tar.add(temp_file_path, arcname=arcname)
        tar_stream.seek(0)

        target_dir = os.path.dirname(abs_path_unix)
        exit_code_mkdir, _ = cont.exec_run(cmd=["mkdir", "-p", target_dir])
        # We might want to check exit_code_mkdir, but put_archive often handles this.

        if not cont.put_archive(path=target_dir, data=tar_stream.read()):
            raise HTTPException(status_code=500, detail="No se pudo copiar el archivo modificado al contenedor.")
    finally:
        if temp_file_path and os.path.exists(temp_file_path):
            os.remove(temp_file_path)

    return JSONResponse({"detail": f"Archivo '{abs_path_unix}' actualizado correctamente en modo '{mode}'."})
@app.put("/edit_file_content_advanced", summary="Edición avanzada de archivos con manejo de indentación y reemplazo de bloques")
def edit_file_content_advanced(body: dict = Body(...)):
    """
    Endpoint avanzado para edición de archivos con manejo de indentación y reemplazo de bloques.
    Requiere: container_path, search_text, content (y opcionalmente language_hint)
    """
    import re, tempfile, io, tarfile, os
    from fastapi.responses import JSONResponse
    from collections import Counter
    cont = get_container()
    container_path = body.get("container_path")
    search_text = body.get("search_text")
    content_to_write = body.get("content")
    language_hint = body.get("language_hint")
    if not container_path or content_to_write is None:
        raise HTTPException(status_code=400, detail="Faltan parámetros obligatorios: container_path, content.")
    if search_text is None:
        search_text = ""
    if container_path.startswith("/"):
        abs_path_unix = to_unix_path(os.path.normpath(container_path))
    else:
        abs_path_unix = to_unix_path(os.path.normpath(os.path.join(CONTAINER_WORKSPACE, container_path)))
    if ".." in abs_path_unix.split("/"):
        raise HTTPException(status_code=400, detail="Path traversal detectado.")
    exit_code, output = cont.exec_run(cmd=["cat", abs_path_unix])
    if exit_code != 0:
        raise HTTPException(status_code=404, detail=f"Archivo no encontrado o no legible: {abs_path_unix}. Error: {output.decode(errors='replace')}")
    original_text = output.decode("utf-8", errors="replace")
    # Detectar estilo de indentación
    indent_style = analyze_indentation_style(original_text)

    # Buscar y reemplazar usando la lógica avanzada
    def _find_and_replace_block(text: str, search: str, replacement: str, current_indent_style: dict) -> tuple[str, int]:
        if not search: # Si el texto de búsqueda es vacío, no hacer nada
            return text, 0

        # Normalizar saltos de línea para la búsqueda y el texto original
        normalized_text = text.replace('\r\n', '\n')
        normalized_search = search.replace('\r\n', '\n')

        # Intentar encontrar el bloque de búsqueda exacto
        try:
            start_index = normalized_text.index(normalized_search)
        except ValueError:
            return text, 0 # Bloque de búsqueda no encontrado

        # Determinar la indentación base del bloque encontrado en el texto original
        # Para esto, encontrar el inicio de la línea donde comienza el match
        line_start_index = normalized_text.rfind('\n', 0, start_index) + 1
        line_of_match_start = normalized_text[line_start_index : start_index + len(normalized_search.splitlines()[0])]
        base_indent_str = get_leading_whitespace(line_of_match_start)
        
        # Preservar la indentación base exactamente como está en el texto original
        # cuando usamos tabulaciones, para evitar problemas de conversión
        if current_indent_style['type'] == 'tab':
            normalized_base_indent = base_indent_str
        else:
            # Normalizar esta indentación base al estilo detectado solo para espacios
            normalized_base_indent = normalize_indent_str(base_indent_str, current_indent_style)

        # Re-indentar el contenido de reemplazo
        # Si el contenido de reemplazo es vacío, no hay nada que re-indentar.
        if not replacement.strip():
            reindented_replacement = "" # Será una eliminación
        else:
            reindented_replacement = re_indent_block(replacement, normalized_base_indent, current_indent_style)

        # Construir el nuevo contenido
        # start_index es donde el contenido de search_text (sin su propia indentación original) comienza.
        # base_indent_str es la indentación que precede a ese contenido en la línea del archivo original.
        
        # Texto antes de la indentación de la línea del match:
        # (normalized_text[:start_index] sería hasta el inicio del contenido buscado, 
        #  así que restamos len(base_indent_str) para llegar al inicio de la indentación de esa línea)
        text_before_indent_of_match_line = normalized_text[:start_index - len(base_indent_str)]
        
        # Texto después del contenido buscado:
        text_after_searched_content = normalized_text[start_index + len(normalized_search):]

        # El reindented_replacement ya tiene la base_indent_str (normalizada) aplicada a su primera línea
        # y la indentación relativa correcta para las siguientes líneas.
        new_text = text_before_indent_of_match_line + reindented_replacement + text_after_searched_content
        return new_text, 1

    new_content, num_replacements = _find_and_replace_block(original_text, search_text, content_to_write, indent_style)

    # Manejo del salto de línea final
    if num_replacements > 0 and not content_to_write.strip() and \
       (new_content == "\n" or not new_content.strip()):
        # Si se hizo un reemplazo, el contenido de reemplazo era vacío (o solo whitespace),
        # y el resultado actual es solo un newline o completamente vacío/whitespace,
        # entonces el contenido final debe ser estrictamente una cadena vacía.
        new_content = ""
    elif new_content and not new_content.endswith("\n"):
        # Si hay contenido (y no es el caso anterior) y no termina con newline, añadirlo.
        new_content += "\n"
    # Si new_content es "" (y no cayó en el primer caso, lo que significa que no hubo reemplazo a vacío que resultara en "\n"),
    # se queda como "". Esto cubre el caso donde el archivo original ya estaba vacío y no se hizo nada,
    # o si _find_and_replace_block devolvió 
    temp_file_path = ""
    try:
        with tempfile.NamedTemporaryFile(delete=False, mode="wb") as tmpf:
            tmpf.write(new_content.encode("utf-8"))
            temp_file_path = tmpf.name
        tar_stream = io.BytesIO()
        arcname = os.path.basename(abs_path_unix)
        with tarfile.open(fileobj=tar_stream, mode='w') as tar:
            tar.add(temp_file_path, arcname=arcname)
        tar_stream.seek(0)
        target_dir = os.path.dirname(abs_path_unix)
        cont.exec_run(cmd=["mkdir", "-p", target_dir])
        if not cont.put_archive(path=target_dir, data=tar_stream.read()):
            raise HTTPException(status_code=500, detail="No se pudo copiar el archivo modificado al contenedor.")
    finally:
        if temp_file_path and os.path.exists(temp_file_path):
            os.remove(temp_file_path)
    return JSONResponse({
        "detail": f"Archivo '{abs_path_unix}' editado correctamente. {num_replacements} reemplazo(s) realizado(s).",
        "indentation_style_used": indent_style,
        "num_replacements": num_replacements
    })

@app.post("/copy_to_text", summary="Crea o sobrescribe un archivo en el contenedor con el contenido dado")
def copy_to_text(body: dict = Body(...)):
    """
    Crea o sobrescribe un archivo en el contenedor con el contenido dado.
    Requiere: container_path, content
    """
    import tempfile, io, tarfile, os
    from fastapi.responses import JSONResponse
    cont = get_container()
    container_path = body.get("container_path")
    content = body.get("content")
    if not container_path or content is None:
        raise HTTPException(status_code=400, detail="Faltan parámetros obligatorios: container_path, content.")
    if container_path.startswith("/"):
        abs_path_unix = to_unix_path(os.path.normpath(container_path))
    else:
        abs_path_unix = to_unix_path(os.path.normpath(os.path.join(CONTAINER_WORKSPACE, container_path)))
    if ".." in abs_path_unix.split("/"):
        raise HTTPException(status_code=400, detail="Path traversal detectado.")
    temp_file_path = ""
    try:
        with tempfile.NamedTemporaryFile(delete=False, mode="wb") as tmpf:
            tmpf.write(content.encode("utf-8"))
            temp_file_path = tmpf.name
        tar_stream = io.BytesIO()
        arcname = os.path.basename(abs_path_unix)
        with tarfile.open(fileobj=tar_stream, mode='w') as tar:
            tar.add(temp_file_path, arcname=arcname)
        tar_stream.seek(0)
        target_dir = os.path.dirname(abs_path_unix)
        cont.exec_run(cmd=["mkdir", "-p", target_dir])
        if not cont.put_archive(path=target_dir, data=tar_stream.read()):
            raise HTTPException(status_code=500, detail="No se pudo copiar el archivo al contenedor.")
    finally:
        if temp_file_path and os.path.exists(temp_file_path):
            os.remove(temp_file_path)
    return JSONResponse({"detail": f"Archivo '{abs_path_unix}' creado/sobrescrito correctamente."})

# (Asegúrate que estas funciones estén definidas en el ámbito global de tu archivo,
#  por ejemplo, cerca de otras funciones auxiliares como to_unix_path)

def get_leading_whitespace(line: str) -> str:
    """Obtiene el string de espacios/tabs al inicio de una línea."""
    match = re.match(r"^[ \t]*", line)
    return match.group(0) if match else ""

def get_visual_length(indent_str: str, tab_width: int = 4) -> int:
    """Calcula la longitud visual de una cadena de indentación."""
    length = 0
    for char in indent_str:
        if char == '\t':
            # El tab se expande hasta la siguiente posición múltiplo de tab_width
            length += tab_width - (length % tab_width)
        else: # Espacio
            length += 1
    return length

def detect_language_from_filename(filename: str) -> str | None:
    """Detecta el lenguaje de programación basado en la extensión del archivo."""
    name, ext = os.path.splitext(filename)
    ext_map = {
        ".py": "python", ".js": "javascript", ".java": "java", ".c": "c",
        ".cpp": "cpp", ".h": "c", ".cs": "csharp", ".html": "html",
        ".css": "css", ".rb": "ruby", ".go": "go", ".php": "php", ".ts": "typescript",
    }
    return ext_map.get(ext.lower())

def analyze_indentation_style(text_content: str, default_tab_width: int = 4) -> dict:
    """
    Analiza el texto para determinar el estilo de indentación predominante.
    Retorna: {'type': 'space'|'tab', 'width': int (ancho para espacios, o tab_width para tabs)}
    """
    space_indents_diffs = []
    tab_indented_lines_count = 0
    space_indented_lines_count = 0
    total_analyzed_indented_lines = 0
    lines = text_content.splitlines()
    
    last_line_indent_len = 0

    for line_idx, line_content_str in enumerate(lines):
        stripped_line = line_content_str.lstrip()
        # Considerar líneas de comentario si tienen indentación relevante podría ser una mejora,
        # pero por ahora se omiten si no aportan a la estructura del código.
        if not stripped_line or stripped_line.startswith(('#', '//', '/*', '*', '"""', "'''")): #TODO: Mejorar detección de comentarios
            # Si la línea es solo whitespace, pero no vacía, podría ser una línea indentada vacía.
            # No obstante, sin stripped_line, no hay contenido para analizar indentación "de código".
            if not line_content_str.strip() and line_content_str: # Línea solo con whitespace
                # Podríamos tratarla como línea con indentación 0 para 'last_line_indent_len'
                # o preservar la indentación si es la única forma de mantener párrafos.
                # Por ahora, para el análisis de estilo, las ignoramos si no tienen "código".
                pass # No actualiza last_line_indent_len basado en esto.
            else:
                 last_line_indent_len = 0 # Reset en líneas vacías o comentarios no indentados
            continue

        leading_ws = get_leading_whitespace(line_content_str)
        if not leading_ws: # Línea no indentada
            last_line_indent_len = 0
            continue

        total_analyzed_indented_lines += 1
        # Usar default_tab_width para una primera pasada de get_visual_length,
        # ya que aún no conocemos el tab_width real del archivo si usa tabs.
        current_visual_indent_len = get_visual_length(leading_ws, default_tab_width)

        if leading_ws.startswith('\t'):
            tab_indented_lines_count += 1
        elif leading_ws.startswith(' '):
            space_indented_lines_count +=1
            if last_line_indent_len > 0 and current_visual_indent_len != last_line_indent_len :
                diff = abs(current_visual_indent_len - last_line_indent_len)
                if 1 < diff <= 16: # Ampliado un poco el rango de diffs razonables
                    space_indents_diffs.append(diff)
        
        last_line_indent_len = current_visual_indent_len

    if total_analyzed_indented_lines == 0: # No hay líneas indentadas con contenido para analizar
        # Podríamos intentar analizar la indentación de líneas de comentario si existen,
        # o usar un default más genérico.
        return {'type': 'space', 'width': 4} # Default si no se puede determinar

    # Determinar tipo
    if tab_indented_lines_count > space_indented_lines_count:
        # Si los tabs son predominantes, se usa el default_tab_width como el 'width' para tabs.
        # En el futuro, se podría intentar detectar el tab_width visual si hay mezcla con espacios.
        return {'type': 'tab', 'width': default_tab_width}
    elif space_indented_lines_count > 0 : # Espacios predominantes o solo espacios
        if space_indents_diffs:
            # Usar el diff de indentación más común como el ancho.
            common_width = Counter(space_indents_diffs).most_common(1)[0][0]
            return {'type': 'space', 'width': common_width}
        else:
            # Si hay líneas indentadas con espacios, pero no se encontraron diffs (e.g. todas al mismo nivel > 0)
            # o solo un nivel de indentación. Se necesita una heurística.
            # Intentar encontrar el GCD de todas las longitudes de indentación de espacios.
            all_space_indent_lengths = []
            for line_content_str in lines:
                leading_ws = get_leading_whitespace(line_content_str)
                if leading_ws and leading_ws.startswith(' ') and line_content_str.strip() and not line_content_str.lstrip().startswith(('#', '//', '/*', '*', '"""', "'''")):
                     all_space_indent_lengths.append(get_visual_length(leading_ws, 1)) # width=1 para contar espacios
            
            import math
            def gcd_list(numbers):
                if not numbers: return 0
                result = numbers[0]
                for i in range(1, len(numbers)):
                    result = math.gcd(result, numbers[i])
                return result

            final_gcd = gcd_list(all_space_indent_lengths)
            if final_gcd > 1: # Típicamente 2 o 4
                return {'type': 'space', 'width': final_gcd}
            elif all_space_indent_lengths: # Si GCD es 1, pero hay indentaciones, usar la más pequeña > 1, o 4.
                min_len_gt_1 = min((l for l in all_space_indent_lengths if l > 1), default=0)
                if min_len_gt_1 > 0:
                    return {'type': 'space', 'width': min_len_gt_1}
                return {'type': 'space', 'width': 4} # Fallback
            return {'type': 'space', 'width': 4} # Fallback si no hay diffs y no se puede inferir de otra manera
    else: # Ni tabs ni espacios, o igual número y no se pudo decidir (improbable con la lógica actual)
        return {'type': 'space', 'width': 4} # Fallback general

def normalize_indent_str(indent_str: str, style: dict) -> str:
    """Convierte una cadena de indentación mixta al estilo detectado/objetivo."""
    # Use style['width'] as tab_width for consistent visual length calculation
    visual_len = get_visual_length(indent_str, style['width'])
    
    if style['type'] == 'space':
        return ' ' * visual_len
    else:  # 'tab'
        return '\t' * (visual_len // style['width']) + ' ' * (visual_len % style['width'])

def re_indent_block(block_to_reindent: str, base_indent_for_block: str, target_style: dict, original_line_ws: str = None) -> str:
    lines = block_to_reindent.splitlines()
    if not lines:
        return ""

    # Encontrar la indentación visual mínima y el índice de la primera línea no vacía
    min_replacement_visual_indent = None
    first_content_idx = None
    for idx, line in enumerate(lines):
        if line.strip():
            leading_ws = get_leading_whitespace(line)
            min_replacement_visual_indent = get_visual_length(leading_ws, target_style['width'])
            first_content_idx = idx
            break
    if min_replacement_visual_indent is None:
        return "\n".join([base_indent_for_block + line.lstrip() for line in lines])

    re_indented_lines = []
    for idx, line in enumerate(lines):
        stripped_line = line.lstrip()
        if not stripped_line:
            re_indented_lines.append(base_indent_for_block)
            continue
        leading_ws = get_leading_whitespace(line)
        visual_indent = get_visual_length(leading_ws, target_style['width'])
        relative_visual_indent = max(0, visual_indent - min_replacement_visual_indent)
        if idx == first_content_idx:
            # Solo la primera línea no vacía lleva la base
            # Si el estilo es tab y la base original tenía un tab, pero el reemplazo no, convertir a espacios visuales
            if target_style['type'] == 'tab' and (original_line_ws and '\t' in original_line_ws) and not leading_ws:
                # El tabulador original se convierte a la cantidad visual de espacios
                tab_visual = get_visual_length(original_line_ws, target_style['width'])
                new_line_full_indent = ' ' * tab_visual
            else:
                new_line_full_indent = base_indent_for_block
        else:
            if target_style['type'] == 'space':
                indent_rel = ' ' * relative_visual_indent
            else:
                num_tabs = relative_visual_indent // target_style['width']
                num_spaces = relative_visual_indent % target_style['width']
                indent_rel = '\t' * num_tabs + ' ' * num_spaces
            new_line_full_indent = base_indent_for_block + indent_rel
        re_indented_lines.append(new_line_full_indent + stripped_line)
    return "\n".join(re_indented_lines)


if __name__ == "__main__":
    import uvicorn
    log.info("Starting FastAPI server with Uvicorn...")
    uvicorn.run(app, host="0.0.0.0", port=9000)