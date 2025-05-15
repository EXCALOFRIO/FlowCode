# FlowCode UI - Frontend para Gemini Docker Agent

Este es el frontend para la aplicación FlowCode, que proporciona una interfaz de usuario moderna para interactuar con el agente Gemini Docker.

## Características

- Interfaz moderna con Tailwind CSS
- Modo oscuro/claro
- Formulario para ingresar tareas para el agente
- Visualización del plan generado por el agente
- Seguimiento del progreso de ejecución
- Indicador de estado del contenedor Docker

## Requisitos

- Node.js 18+
- API de backend ejecutándose (FlowCode API y Docker Manager)

## Configuración

1. Instala las dependencias:

```bash
cd frontend
npm install
```

2. Ejecuta el servidor de desarrollo:

```bash
npm run dev
```

El servidor iniciará en http://localhost:3000

## Conectando con el Backend

El frontend está configurado para conectarse a través de un proxy interno a:
- API del Agente: http://localhost:8001
- Docker Manager: http://localhost:9000

Asegúrate de que ambos servicios estén ejecutándose antes de usar la interfaz. Puedes iniciarlos con:

```bash
python run.py --all
```

### Solución de problemas de conexión

Si ves errores como "Network Error" al cargar la interfaz, es posible que:

1. El backend no esté en ejecución. Verifica que has iniciado `python run.py --all` y que está funcionando correctamente.
2. Haya un problema de CORS. La configuración actual utiliza un proxy interno en Next.js para evitar este problema.
3. Los puertos configurados (8001 para el agente, 9000 para Docker Manager) no sean correctos o estén bloqueados.

El indicador de estado mostrará el estado de la conexión y reintentará conectarse automáticamente con un tiempo de espera progresivo.

## Uso

1. Ingresa una descripción de la tarea Docker que deseas realizar en el formulario.
2. Haz clic en "Ejecutar tarea" para que el agente genere un plan.
3. Revisa el plan generado y haz clic en "Ejecutar Plan" para comenzar la ejecución.
4. Observa el progreso de la ejecución y proporciona feedback si el agente lo solicita.

## Tecnologías

- Next.js 15.3
- React 18
- Tailwind CSS
- TypeScript
- Turbopack
- Next Themes (para modo oscuro/claro)
- Axios (para peticiones HTTP) 