'use client';

import { useState, useEffect } from 'react';
import { executeStep, getTask, generateDetailedReport } from '../lib/api';
import { Task, StepResult, ExecutionStatus } from '../types';
import ReportViewer from './ReportViewer';

interface TaskDetailsProps {
  taskId: string | null;
  setLoading: (loading: boolean) => void;
  onReset?: () => void;
}

export default function TaskDetails({ taskId, setLoading, onReset }: TaskDetailsProps) {
  const [task, setTask] = useState<Task | null>(null);
  const [stepResults, setStepResults] = useState<StepResult[]>([]);
  const [executionStatus, setExecutionStatus] = useState<ExecutionStatus>('idle');
  const [userFeedback, setUserFeedback] = useState<string>('');
  const [planAccepted, setPlanAccepted] = useState<boolean>(false);
  const [autoExecuteEnabled, setAutoExecuteEnabled] = useState<boolean>(false);
  const [detailedReport, setDetailedReport] = useState<string | null>(null);
  const [isGeneratingReport, setIsGeneratingReport] = useState<boolean>(false);

  // Cargar la tarea cuando se establece el ID
  useEffect(() => {
    if (!taskId) return;
    
    const fetchTask = async () => {
      setLoading(true);
      try {
        const fetchedTask = await getTask(taskId);
        setTask(fetchedTask);
        setExecutionStatus('planning');
        
        // Verificar si la tarea tiene habilitada la ejecución automática
        if (fetchedTask.auto_execute) {
          setAutoExecuteEnabled(true);
        }
      } catch (err) {
        console.error('Error al obtener la tarea:', err);
        setExecutionStatus('error');
      } finally {
        setLoading(false);
      }
    };

    fetchTask();
  }, [taskId, setLoading]);

  // Ejecutar automáticamente sólo si autoExecuteEnabled está habilitado
  useEffect(() => {
    if (task && executionStatus === 'planning' && !planAccepted && autoExecuteEnabled) {
      // Aceptar el plan automáticamente solo si autoExecute está habilitado
      setPlanAccepted(true);
      handleExecuteStep();
    }
  }, [task, executionStatus, autoExecuteEnabled]);

  // Continuar automáticamente solo si autoExecuteEnabled está habilitado
  useEffect(() => {
    if (stepResults.length > 0 && autoExecuteEnabled) {
      const lastResult = stepResults[stepResults.length - 1];
      
      // Solo continuar automáticamente si:
      // 1. El estado es "waiting_for_input"
      // 2. Hay un siguiente paso definido (para evitar el "Paso 3" falso)
      // 3. La tarea no está completada
      if (
        lastResult.status === 'waiting_for_input' && 
        lastResult.next_step && 
        lastResult.task_status !== 'completed'
      ) {
        const timeoutId = setTimeout(() => {
          handleExecuteStep('Continuar automáticamente');
        }, 1000);
        
        return () => clearTimeout(timeoutId);
      }
      
      // Si la tarea está completada y estamos en espera de input, finalizarla automáticamente
      if (lastResult.status === 'waiting_for_input' && lastResult.task_status === 'completed') {
        setExecutionStatus('completed');
      }
    }
  }, [stepResults, autoExecuteEnabled]);

  // Ejecutar paso
  const handleExecuteStep = async (feedback?: string) => {
    if (!taskId) return;

    setExecutionStatus('executing');
    setLoading(true);

    try {
      const result = await executeStep(taskId, feedback);
      setStepResults((prev) => [...prev, result]);

      // Actualizar estado basado en el resultado
      if (result.status === 'waiting_for_input') {
        // Si es el último paso y no hay siguiente paso, marcar como completado
        if (!result.next_step && result.task_status === 'completed') {
          setExecutionStatus('completed');
        } else {
          setExecutionStatus('waiting_for_input');
        }
      } else if (result.task_status === 'completed') {
        setExecutionStatus('completed');
      } else {
        // Si hay un siguiente paso, sigue en ejecución
        setExecutionStatus(result.next_step ? 'planning' : 'completed');
      }
    } catch (err) {
      console.error('Error al ejecutar paso:', err);
      setExecutionStatus('error');
    } finally {
      setLoading(false);
      setUserFeedback('');
    }
  };

  // Manejar envío de feedback
  const handleSubmitFeedback = (e: React.FormEvent) => {
    e.preventDefault();
    handleExecuteStep(userFeedback);
  };

  // Aceptar plan y comenzar ejecución
  const handleAcceptPlan = () => {
    setPlanAccepted(true);
    handleExecuteStep();
  };

  // Función para ejecutar todos los pasos automáticamente
  const handleAutoContinue = async () => {
    if (!taskId || !task) return;

    // Habilitar auto-ejecución
    setAutoExecuteEnabled(true);
    
    setExecutionStatus('executing');
    setLoading(true);

    try {
      // Empezar desde el primer paso o continuar desde donde estamos
      let currentIndex = stepResults.length > 0 ? stepResults[stepResults.length - 1].step_index : 0;
      
      // Mostrar mensaje de ejecución automática
      console.log(`Ejecutando automáticamente todos los pasos desde el paso ${currentIndex + 1}`);
      
      // Si estamos en modo de planificación (plan no aceptado), aceptarlo primero
      if (!planAccepted) {
        setPlanAccepted(true);
      }

      // Variable para controlar si seguimos ejecutando pasos
      let continueExecution = true;
      let maxRetries = 5; // Máximo de intentos para evitar bucles infinitos
      let retryCount = 0;

      // Ejecución de todos los pasos restantes
      while (continueExecution && retryCount < maxRetries) {
        const result = await executeStep(taskId, 'Continuar automáticamente');
        
        // Agregar el resultado al historial
        setStepResults((prev) => [...prev, result]);
        
        console.log(`Paso ${result.step_index + 1} ejecutado, estado: ${result.status}`);

        // Verificar si hay errores o se ha completado
        if (result.status === 'error') {
          console.error('Error en la ejecución automática:', result.message);
          setExecutionStatus('error');
          continueExecution = false;
        } 
        // Si la tarea está completada o no hay más pasos
        else if (result.task_status === 'completed' || !result.next_step) {
          console.log('Tarea completada o no hay más pasos');
          setExecutionStatus('completed');
          continueExecution = false;
        }
        // Si seguimos en espera de input, intentar de nuevo
        else if (result.status === 'waiting_for_input') {
          console.log('Todavía esperando input, reintentando...');
          retryCount++;
        }
      }

      // Si salimos por número máximo de intentos
      if (retryCount >= maxRetries) {
        console.warn('Se alcanzó el máximo de reintentos automáticos');
        setExecutionStatus('waiting_for_input');
      }
    } catch (err) {
      console.error('Error al ejecutar pasos automáticamente:', err);
      setExecutionStatus('error');
    } finally {
      setLoading(false);
    }
  };

  // Función para generar un reporte científico detallado
  const handleGenerateDetailedReport = async () => {
    if (!taskId) return;
    
    setIsGeneratingReport(true);
    setLoading(true);
    
    try {
      const reportData = await generateDetailedReport(taskId);
      setDetailedReport(reportData.report);
      
      // Si el reporte contiene indicación de que está en proceso de generación,
      // iniciar polling para obtener el reporte completo
      if (reportData.report.includes("Generando reporte detallado")) {
        startReportPolling();
      }
    } catch (err) {
      console.error('Error al generar reporte detallado:', err);
    } finally {
      setIsGeneratingReport(false);
      setLoading(false);
    }
  };
  
  // Función para verificar periódicamente si el reporte completo está disponible
  const startReportPolling = () => {
    const pollingInterval = setInterval(async () => {
      if (!taskId) {
        clearInterval(pollingInterval);
        return;
      }
      
      try {
        // Obtener la tarea actualizada
        const updatedTask = await getTask(taskId);
        
        // Verificar si hay un reporte completo disponible (no contiene mensaje de generación)
        if (updatedTask.report && !updatedTask.report.includes("Generando reporte detallado")) {
          setDetailedReport(updatedTask.report);
          clearInterval(pollingInterval);
        }
      } catch (err) {
        console.error('Error al verificar reporte actualizado:', err);
        clearInterval(pollingInterval);
      }
    }, 5000); // Verificar cada 5 segundos
    
    // Limpiar el intervalo después de 2 minutos para evitar polling infinito
    setTimeout(() => {
      clearInterval(pollingInterval);
    }, 120000);
  };

  // Función para renderizar contenido en Markdown
  const renderMarkdown = (content: string | undefined) => {
    if (!content) return null;
    
    // Reemplazar los bloques de código
    const formattedContent = content
      // Convertir bloques de código con ```
      .replace(/```([\s\S]*?)```/g, '<pre class="bg-muted p-2 rounded-md overflow-x-auto my-2"><code>$1</code></pre>')
      // Convertir listas con *
      .replace(/^\s*\*\s+(.+)$/gm, '<li>$1</li>')
      // Convertir listas con números
      .replace(/^\s*\d+\.\s+(.+)$/gm, '<li>$1</li>')
      // Convertir encabezados
      .replace(/^#+\s+(.+)$/gm, (match, p1, offset, string) => {
        const level = match.trim().indexOf(' ');
        return `<h${level} class="font-bold my-2">${p1}</h${level}>`;
      })
      // Convertir negritas
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      // Convertir cursivas
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      // Convertir enlaces
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-primary hover:underline">$1</a>')
      // Convertir saltos de línea
      .replace(/\n/g, '<br/>');
    
    return <div dangerouslySetInnerHTML={{ __html: formattedContent }} />;
  };

  // Nueva función para renderizar el markdown con estilo profesional y navegación
  const renderMarkdownProfesional = (content: string | undefined) => {
    if (!content) return null;

    // Procesamos el contenido para agregar IDs a los encabezados para navegación
    let processedContent = content;
    const headings: {id: string, title: string, level: number}[] = [];
    
    // Añadir IDs a los encabezados y recopilar la estructura para el índice navegable
    processedContent = content.replace(/^(#+)\s+(.+)$/gm, (match, hashes, title) => {
      const level = hashes.length;
      // Crear un ID para la navegación (slug)
      const id = title.toLowerCase()
        .replace(/[^\w\s-]/g, '') // Remover caracteres especiales
        .replace(/\s+/g, '-'); // Reemplazar espacios con guiones
      
      // Almacenar para el índice
      headings.push({id, title, level});
      
      // Devolver el encabezado con un ID
      return `<h${level} id="${id}" class="scroll-mt-16">${title}</h${level}>`;
    });

    // Crear un índice al inicio si hay encabezados
    if (headings.length > 0) {
      // Removemos el índice original si existe (el que sólo tiene links)
      processedContent = processedContent.replace(/^## Índice\n\n([\s\S]*?)(?=\n## )/gm, '');
      
      // Creamos nuestro nuevo índice navegable
      let tocHtml = `<div class="bg-gray-50 dark:bg-gray-900 p-4 mb-6 rounded-lg border border-gray-200 dark:border-gray-800">`;
      tocHtml += `<h2 class="text-xl font-bold mb-3">Índice</h2>`;
      tocHtml += `<ul class="space-y-1">`;
      
      headings.forEach(({id, title, level}) => {
        if (level > 1) { // Excluir el título principal del índice
          // Añadir indentación basada en el nivel
          const indentClass = level > 2 ? `ml-${(level-2)*4}` : '';
          tocHtml += `<li class="${indentClass}"><a href="#${id}" class="text-blue-600 dark:text-blue-400 hover:underline">${title}</a></li>`;
        }
      });
      
      tocHtml += `</ul></div>`;
      
      // Insertamos el TOC después del título principal (h1)
      const titleEnd = processedContent.indexOf('\n', processedContent.indexOf('# '));
      processedContent = 
        processedContent.substring(0, titleEnd + 1) + 
        '\n' + tocHtml + '\n' + 
        processedContent.substring(titleEnd + 1);
    }
    
    // Mejorar el formato de todos los elementos
    
    // Bloques de código con sintaxis
    processedContent = processedContent.replace(/```([\w]*)\n([\s\S]*?)```/g, 
      '<pre class="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg shadow-inner my-4 overflow-x-auto"><code class="language-$1">$2</code></pre>');
    
    // Tabla con estilo mejorado
    processedContent = processedContent.replace(/(\|[^\n]+\|\n)(\|[\-:| ]+\|\n)(\|[^\n]+\|\n)+/g, 
      '<div class="overflow-x-auto my-4"><table class="border-collapse w-full text-sm">$&</table></div>');
    
    // Mejora de enlaces
    processedContent = processedContent.replace(/\[([^\]]+)\]\(([^)]+)\)/g, 
      '<a href="$2" class="text-blue-600 dark:text-blue-400 font-medium hover:underline transition-colors">$1</a>');
    
    // Mejora de listas
    processedContent = processedContent.replace(/^\s*[\*\-]\s+(.+)$/gm, 
      '<li class="ml-4 mb-1">$1</li>');
    
    // Mejorar las secciones de código inline
    processedContent = processedContent.replace(/`([^`]+)`/g, 
      '<code class="bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded text-sm font-mono">$1</code>');
    
    // Aplicar mejor formato a bloques de citas
    processedContent = processedContent.replace(/^>\s+(.+)$/gm, 
      '<blockquote class="pl-4 border-l-4 border-gray-300 dark:border-gray-700 italic text-gray-700 dark:text-gray-300 my-4">$1</blockquote>');
    
    // Mejorar formato de fechas y datos numéricos
    // Esto es más específico para reporte de tiempo como solicitó el usuario
    processedContent = processedContent.replace(/(\d{2}:\d{2}:\d{2})/g, 
      '<span class="font-mono text-green-600 dark:text-green-400 font-bold">$1</span>');
    
    return <div dangerouslySetInnerHTML={{ __html: processedContent }} />;
  };

  // Formatear resultado para mostrarlo de manera más legible con Markdown
  const formatResult = (result: any) => {
    if (typeof result === 'string') {
      return renderMarkdown(result);
    }
    
    // Extraer mensaje si está disponible y renderizarlo como Markdown
    if (result.message) {
      return renderMarkdown(result.message);
    }
    
    // Si hay un resultado específico de comando, mostrarlo
    if (result.result?.stdout) {
      return (
        <>
          <div className="text-sm font-medium mb-1">Salida del comando:</div>
          <pre className="bg-muted p-2 rounded-md overflow-x-auto">
            {result.result.stdout}
          </pre>
        </>
      );
    }
    
    // Para otros casos, intentar formatear JSON
    try {
      return <pre className="overflow-x-auto">{JSON.stringify(result, null, 2)}</pre>;
    } catch (e) {
      return 'No se puede mostrar el resultado';
    }
  };

  // Verificar si un paso está completado
  const isStepCompleted = (stepIndex: number) => {
    return stepResults.some(result => 
      result.step_index === stepIndex && 
      (result.status === 'success' || result.status === 'waiting_for_input')
    );
  };

  // Verificar si un paso está actualmente en ejecución
  const isStepInProgress = (stepIndex: number) => {
    if (stepResults.length === 0) return false;
    
    const lastResult = stepResults[stepResults.length - 1];
    return lastResult.step_index === stepIndex && 
           lastResult.status !== 'success' && 
           lastResult.status !== 'error';
  };

  // Si no hay tarea seleccionada
  if (!taskId) {
    return null;
  }

  // Si está cargando la tarea
  if (!task) {
    return (
      <div className="flex items-center justify-center h-64 border border-dashed border-border rounded-lg">
        <p className="text-muted-foreground">Cargando detalles de la tarea...</p>
      </div>
    );
  }

  // Mostrar reporte detallado si existe
  if (detailedReport) {
    return (
      <ReportViewer 
        report={detailedReport} 
        onBack={() => setDetailedReport(null)} 
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Detalles de la tarea */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-bold tracking-tight">{task.description}</h2>
          {onReset && (
            <button
              onClick={onReset}
              className="px-3 py-1 text-xs rounded bg-secondary text-secondary-foreground hover:bg-secondary/80"
            >
              Nueva tarea
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-2 py-1 text-xs rounded-full font-medium ${
            executionStatus === 'completed' ? 'bg-green-500/20 text-green-600 dark:text-green-400' : 
            executionStatus === 'error' ? 'bg-red-500/20 text-red-600 dark:text-red-400' :
            'bg-blue-500/20 text-blue-600 dark:text-blue-400'
          }`}>
            {executionStatus === 'idle' ? 'Iniciando' :
             executionStatus === 'planning' ? 'Planificando' :
             executionStatus === 'executing' ? 'Ejecutando' :
             executionStatus === 'waiting_for_input' ? 'Esperando entrada' :
             executionStatus === 'completed' ? 'Completado' :
             executionStatus === 'error' ? 'Error' : 'Desconocido'}
          </span>
          <span className="text-xs text-muted-foreground">ID: {taskId}</span>
        </div>
      </div>

      {/* Contenido principal - Layout de 2 columnas cuando se ha aceptado el plan */}
      {!planAccepted && task && Array.isArray(task.plan) && (
        <div className="p-4 border rounded-lg space-y-4">
          <h3 className="font-medium">Plan generado:</h3>
          <ul className="space-y-2">
            {task && task.plan && task.plan.map((step, index) => (
              <li key={index} className="flex items-start">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs mr-2">
                  {index + 1}
                </span>
                <span>
                  {step.titulo ? `${step.titulo}: ${step.descripcion || ''}` : step.step || `Paso ${index + 1}`}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-col space-y-3">
            <button
              onClick={handleAcceptPlan}
              className="w-full inline-flex justify-center items-center px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-md"
            >
              Ejecutar Plan
            </button>
            
            <button
              onClick={() => {
                setPlanAccepted(true);
                setAutoExecuteEnabled(true);
                handleExecuteStep();
              }}
              className="w-full inline-flex justify-center items-center px-4 py-2 bg-secondary text-secondary-foreground hover:bg-secondary/90 rounded-md"
            >
              Ejecutar Plan Automáticamente
            </button>
          </div>
        </div>
      )}

      {planAccepted && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Panel izquierdo - Plan con estado de cada paso */}
          <div className="md:col-span-1">
            <div className="sticky top-24 p-4 border rounded-lg space-y-4">
              <h3 className="font-semibold text-lg">Plan de ejecución</h3>
              <ul className="space-y-3">
                {task && task.plan && task.plan.map((step, index) => (
                  <li key={index} className={`p-3 rounded-lg border ${
                    isStepCompleted(index) ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-900' : 
                    isStepInProgress(index) ? 'bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-900' : 
                    'bg-card border-border'
                  }`}>
                    <div className="flex items-start">
                      <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs mr-2 ${
                        isStepCompleted(index) ? 'bg-green-500 text-white' : 
                        isStepInProgress(index) ? 'bg-blue-500 text-white' : 
                        'bg-muted text-muted-foreground'
                      }`}>
                        {isStepCompleted(index) ? '✓' : index + 1}
                      </div>
                      <div>
                        <p className="font-medium text-sm">
                          {step.titulo || `Paso ${index + 1}`}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {step.descripcion || step.step || ''}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Panel derecho - Resultados de la ejecución */}
          <div className="md:col-span-2">
            {/* Resultados de pasos */}
            {stepResults.length > 0 && !detailedReport && (
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="font-semibold text-lg">Progreso de la ejecución:</h3>
                  {executionStatus === 'waiting_for_input' && !autoExecuteEnabled && (
                    <button
                      onClick={handleAutoContinue}
                      className="text-sm px-3 py-1 bg-secondary text-secondary-foreground hover:bg-secondary/80 rounded-md"
                    >
                      Completar todos los pasos automáticamente
                    </button>
                  )}
                </div>
                <div className="space-y-4">
                  {stepResults.map((result, index) => (
                    <div key={index} className="p-4 border rounded-lg transition-all">
                      <div className="flex justify-between items-start mb-2">
                        <h4 className="font-medium">
                          Paso {result.step_index + 1}: {
                            typeof result.step_description === 'string' 
                              ? result.step_description 
                              : result.step_description.titulo || result.step_description.step || `Paso ${result.step_index + 1}`
                          }
                        </h4>
                        <span className={`px-2 py-1 text-xs rounded-full ${
                          result.status === 'success' ? 'bg-green-500/20 text-green-600 dark:text-green-400' : 
                          result.status === 'error' ? 'bg-red-500/20 text-red-600 dark:text-red-400' :
                          result.status === 'waiting_for_input' ? 
                            (result.task_status && (result.task_status === 'completed' || 
                             (stepResults.length > index + 1))) ? 'bg-green-500/20 text-green-600 dark:text-green-400' :
                            'bg-blue-500/20 text-blue-600 dark:text-blue-400' :
                          'bg-blue-500/20 text-blue-600 dark:text-blue-400'
                        }`}>
                          {result.status === 'success' ? 'Éxito' : 
                           result.status === 'error' ? 'Error' :
                           result.status === 'waiting_for_input' ? 
                             (result.task_status && (result.task_status === 'completed' || 
                              (stepResults.length > index + 1))) ? 'Terminada' : 'En curso' :
                           result.status}
                        </span>
                      </div>
                      
                      {/* Contenido del resultado */}
                      <div className="mt-2 p-3 bg-accent rounded text-sm whitespace-pre-wrap overflow-x-auto">
                        {result.message ? renderMarkdown(result.message) : formatResult(result.result)}
                      </div>
                      
                      {/* Información adicional */}
                      {result.function_called && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          <span className="font-medium">Función:</span> {result.function_called}
                          {result.function_args && (
                            <span className="ml-1">({JSON.stringify(result.function_args)})</span>
                          )}
                        </p>
                      )}
                      
                      {/* Estrategia de recuperación si aplicó */}
                      {result.recovery_strategy && (
                        <div className="mt-2 p-2 bg-yellow-500/10 border border-yellow-200 rounded-md text-xs">
                          <span className="font-medium">Recuperación aplicada:</span> {result.recovery_strategy}
                          <span className="ml-2">(Intento {result.retries} de 3)</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Mensajes de estado final */}
            {executionStatus === 'completed' && !detailedReport && (
              <div className="p-4 bg-green-500/10 border border-green-200 rounded-md shadow-sm mt-8">
                <div className="text-green-600 dark:text-green-400 font-medium text-lg mb-2">¡Tarea completada con éxito!</div>
                <p className="text-sm text-muted-foreground mb-4">
                  La tarea se ha completado correctamente. Puedes generar un reporte científico detallado de la tarea.
                </p>
                <button
                  onClick={handleGenerateDetailedReport}
                  disabled={isGeneratingReport}
                  className="inline-flex items-center justify-center px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-md disabled:opacity-50"
                >
                  {isGeneratingReport ? (
                    <>
                      <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Generando reporte...
                    </>
                  ) : (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      Generar reporte científico detallado
                    </>
                  )}
                </button>
              </div>
            )}

            {executionStatus === 'error' && (
              <div className="p-4 bg-red-500/10 border border-red-200 rounded-md">
                <p className="text-red-600 dark:text-red-400 font-medium">Ocurrió un error durante la ejecución de la tarea.</p>
                <p className="text-sm mt-2">Por favor, revisa los pasos anteriores para identificar el problema y prueba a crear una nueva tarea.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
} 