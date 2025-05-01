'use client';

import type {NextPage} from 'next';
import React, {useState, useCallback, useRef} from 'react';
import {
  Textarea,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Progress,
  Badge,
  ScrollArea,
} from '@/components/ui';
import {
  UploadCloud,
  FileText,
  FileImage,
  FileSpreadsheet,
  FileArchive,
  X,
  Rocket,
  Wand2,
  Loader2,
  CheckCircle,
  Info,
  BarChart,
  Table,
  Presentation,
  Download,
  XCircle,
  RotateCcw,
} from 'lucide-react';
import {useToast} from '@/hooks/use-toast';
import {planVisualization, PlanVisualizationOutput} from '@/ai/flows/plan-visualization-flow';
import {generateAgenticPlan} from '@/ai/flows/agentric-planning-flow';
import {cn} from '@/lib/utils';
import { DockerStatus } from '@/components/DockerStatus';
import { useDocker } from '@/hooks/DockerContext';
import { dockerService } from '@/services/docker-service';
import { AgenticPlanningOutput } from '@/ai/flows/types';
import { geminiService } from '@/services/gemini-service';
import { marked } from 'marked';

// Define types for file handling and plan steps
interface UploadedFile {
  name: string;
  type: string;
  size: number;
  dataUri: string;
}

interface PlanStep {
  id: number;
  description: string;
  status: 'pending' | 'in-progress' | 'completed' | 'error';
  icon?: React.ReactNode;
  subSteps?: SubStep[]; // Añadimos subpasos para cada paso
  isCollapsed?: boolean; // Añadimos propiedad para colapsar/expandir
}

interface SubStep {
  id: number;
  description: string;
  status: 'pending' | 'in-progress' | 'completed' | 'error';
  parentId: number; // ID del paso padre
}

interface ResultItem {
  type: 'text' | 'table' | 'graph' | 'animation' | 'file' | 'plan';
  title: string;
  content?: any; // Could be string for text, data for table/graph, URL for file/animation
  fileName?: string;
  fileType?: string;
  plan?: AgenticPlanningOutput; // Añadir el plan generado
}

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

// Utilidad para verificar si un objeto es de tipo AgenticPlanningOutput
const isAgenticPlan = (obj: any): obj is AgenticPlanningOutput => {
  return obj && typeof obj === 'object' && 'pasos' in obj && 'requiereInfoExterna' in obj;
};

const FlowCodePage: NextPage = () => {
  const [prompt, setPrompt] = useState('');
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showPlan, setShowPlan] = useState(false);
  const [plan, setPlan] = useState<PlanVisualizationOutput | AgenticPlanningOutput | null>(null);
  const [planSteps, setPlanSteps] = useState<PlanStep[]>([]);
  const [isGeneratingSubSteps, setIsGeneratingSubSteps] = useState(false); // Estado para la generación de subpasos
  const [showSubStepsGenerated, setShowSubStepsGenerated] = useState(false); // Mostrar cuando los subpasos estén generados
  const [isExecuting, setIsExecuting] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [results, setResults] = useState<ResultItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const {toast} = useToast();

  // Usar el hook de Docker
  const { isInitialized: isDockerInitialized } = useDocker();

  const getFileIcon = (fileType: string): React.ReactNode => {
    if (fileType.startsWith('image/')) return <FileImage className="h-5 w-5 text-muted-foreground" />;
    if (fileType === 'text/plain' || fileType === 'application/json' || fileType === 'text/csv')
      return <FileText className="h-5 w-5 text-muted-foreground" />;
    if (
      fileType === 'application/vnd.ms-excel' ||
      fileType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
      return <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />;
    if (fileType === 'application/zip' || fileType === 'application/x-rar-compressed')
      return <FileArchive className="h-5 w-5 text-muted-foreground" />;
    return <FileText className="h-5 w-5 text-muted-foreground" />;
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      handleFiles(Array.from(event.target.files));
    }
  };

  const handleFiles = (files: File[]) => {
    let totalSize = uploadedFiles.reduce((acc, f) => acc + f.size, 0);
    const newFiles: UploadedFile[] = [];
    const filesToProcess = files.length;
    let filesProcessed = 0;

    const updateStateIfNeeded = () => {
      filesProcessed++;
      if (filesProcessed === filesToProcess) {
        setUploadedFiles((prevFiles) => [...prevFiles, ...newFiles]);
      }
    };

    if (files.length === 0) return;


    for (const file of files) {
      if (totalSize + file.size > MAX_FILE_SIZE) {
        toast({
          variant: 'destructive',
          title: 'File Limit Exceeded',
          description: `Cannot upload ${file.name}. Total size exceeds 50MB limit.`,
        });
         updateStateIfNeeded(); // Count skipped file towards processed
        continue;
      }
      if (file.size === 0) {
        toast({
          variant: 'destructive',
          title: 'Empty File',
          description: `Cannot upload empty file: ${file.name}.`,
        });
         updateStateIfNeeded(); // Count skipped file towards processed
        continue;
      }

      totalSize += file.size;

      const reader = new FileReader();
      reader.onload = (e) => {
        if (e.target?.result) {
          newFiles.push({
            name: file.name,
            type: file.type,
            size: file.size,
            dataUri: e.target.result as string,
          });
           updateStateIfNeeded();
        } else {
           toast({
            variant: 'destructive',
            title: 'File Read Error',
            description: `Could not read file: ${file.name}`,
           });
            updateStateIfNeeded(); // Count failed file read towards processed
        }
      };
      reader.onerror = () => {
        toast({
          variant: 'destructive',
          title: 'File Read Error',
          description: `Could not read file: ${file.name}`,
        });
         updateStateIfNeeded(); // Count failed file read towards processed
      };
      reader.readAsDataURL(file);
    }
  };


  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDragging(false);
      if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
        handleFiles(Array.from(event.dataTransfer.files));
        event.dataTransfer.clearData();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [uploadedFiles] // Include handleFiles dependency indirectly through uploadedFiles
  );

  const removeFile = (fileName: string) => {
    setUploadedFiles(uploadedFiles.filter((file) => file.name !== fileName));
  };

  const handleGeneratePlan = async () => {
    if (!prompt.trim() && uploadedFiles.length === 0) {
      toast({
        variant: 'destructive',
        title: 'Input Required',
        description: 'Please enter a prompt or upload at least one file.',
      });
      return;
    }
    setIsLoading(true);
    setShowPlan(false);
    setPlan(null);
    setPlanSteps([]);
    setIsGeneratingSubSteps(false);
    setShowSubStepsGenerated(false);
    setIsExecuting(false);
    setShowResults(false);
    setResults([]);

    try {
      // Paso 1: Mejorar el prompt usando técnicas de enhance-prompt
      const enrichedPrompt = `${prompt}\n\nNecesito un plan extremadamente detallado. Para cada paso, proporciona una descripción completa y explicación detallada de qué hacer y por qué es importante. Incluye todos los aspectos técnicos relevantes y posibles desafíos que pueda encontrar.`;
      
      console.log("Preparando análisis de archivos y contexto...");
      
      // Preparar archivos para el flujo agéntico
      const fileNameArray = uploadedFiles.map(file => file.name);
      
      // Extraer contenido de los archivos
      const fileContentArray = uploadedFiles.map(file => {
        // Intentar extraer el contenido del dataUri
        const [, base64Content] = file.dataUri.split(',');
        let contenido = '';
        if (base64Content) {
          try {
            // Decodificar el contenido base64
            contenido = decodeURIComponent(escape(atob(base64Content)));
          } catch (error) {
            console.warn('No se pudo decodificar el archivo como texto:', file.name);
            contenido = `[Contenido binario no mostrado: ${file.name}]`;
          }
        } else {
          contenido = `[No se pudo extraer contenido: ${file.name}]`;
        }
        return contenido;
      });
      
      // Paso 2: Verificar si se necesita información externa (como en incorporate-external-info)
      console.log("Verificando si se necesita información externa...");
      
      // Paso 3: Generar el plan con todas las mejoras
      console.log("Generando plan con Gemini...");
      const newPlan = await generateAgenticPlan({
        prompt: enrichedPrompt,
        fileNames: fileNameArray,
        fileContents: fileContentArray
      });
      
      console.log("Plan generado:", newPlan);
      setPlan(newPlan);
      
      // Asegurarse de que newPlan.pasos sea siempre un array
      if (newPlan && newPlan.pasos && Array.isArray(newPlan.pasos)) {
        const newPlanSteps: PlanStep[] = newPlan.pasos.map((paso, index) => ({
          id: index + 1,
          description: paso.paso,
          status: 'pending',
          icon: <Info size={16} />,
          subSteps: [],
          isCollapsed: true
        }));
        
        setPlanSteps(newPlanSteps);
      } else {
        // Si pasos no es un array, crear un paso genérico
        console.error("Error: newPlan.pasos no es un array", newPlan);
        // Crear un paso por defecto si no hay pasos
        const defaultStep: PlanStep = {
          id: 1,
          description: "Realizar la tarea solicitada",
          status: 'pending',
          icon: <Info size={16} />,
          subSteps: [],
          isCollapsed: true
        };
        setPlanSteps([defaultStep]);
        
        // Notificar al usuario
        toast({
          variant: 'destructive',
          title: 'Error al procesar el plan',
          description: 'No se pudieron generar los pasos correctamente. Se ha creado un plan genérico.',
        });
      }
      
      // Almacenar el resultado para mostrarlo
      const resultItem: ResultItem = {
        type: 'plan',
        title: 'Plan Generado con Gemini',
        plan: newPlan
      };
      
      setResults([resultItem]);
      setShowPlan(true);
      setIsLoading(false);
      setShowResults(true);
    } catch (error) {
      console.error('Error al generar el plan:', error);
      setIsLoading(false);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Error desconocido al generar el plan.',
      });
    }
  };

  const handleExecutePlan = async () => {
    if (!plan || planSteps.length === 0) return;
    
    // Verificar que Docker está inicializado antes de ejecutar el plan
    if (!isDockerInitialized) {
      toast({
        variant: 'destructive',
        title: 'Docker No Inicializado',
        description: 'Espera a que Docker esté inicializado antes de generar subpasos.',
      });
      return;
    }
    
    // Verificar si hay contenedores disponibles
    let containerAvailable = false;
    try {
      const container = await dockerService.getAvailableContainer();
      containerAvailable = !!(container && container.id);
    } catch (error) {
      console.error("No se pudo verificar la disponibilidad de contenedores Docker:", error);
      containerAvailable = false;
    }
    
    if (!containerAvailable) {
      toast({
        variant: 'destructive',
        title: 'Contenedores Docker No Disponibles',
        description: 'Se generarán subpasos sin interacción con Docker. Algunas funcionalidades pueden estar limitadas.',
      });
    }
    
    setIsGeneratingSubSteps(true);
    setShowSubStepsGenerated(false);

    try {
      const updateStepWithSubsteps = async (stepIndex: number) => {
        const paso = planSteps[stepIndex];
        
        // Actualizar el estado del paso a "en progreso"
        setPlanSteps(prev => prev.map((step, index) => 
          index === stepIndex ? {...step, status: 'in-progress'} : step
        ));
        
        // Preparar el prompt para generar subpasos detallados utilizando técnicas avanzadas
        let detailPrompt = `# Generación de subpasos para implementación práctica
        
        Estoy trabajando en el siguiente paso de un plan:
        
        "${paso.description}"
        
        ## Contexto general
        
        Este paso forma parte del siguiente plan general: "${plan.plan}"
        
        ## Objetivo
        
        Necesito una secuencia de subpasos extremadamente detallados, específicos y ACCIONABLES que me permitan IMPLEMENTAR este paso de forma práctica y directa.
        
        ## Requisitos específicos para los subpasos:
        1. Deben ser PRÁCTICOS y EJECUTABLES (comandos exactos, acciones concretas)
        2. Cada subpaso debe representar UNA ACCIÓN ÚNICA y clara
        3. El nivel de detalle debe ser alto pero evitando explicaciones innecesarias
        4. Los subpasos deben cubrir desde la preparación hasta la verificación de resultados
        5. Incluir comandos exactos cuando sea relevante
        6. Incluir únicamente instrucciones FINALES para EJECUTAR, no razonamientos preliminares
        
        ## Formato de respuesta:
        - Máximo 8-10 subpasos para mantener la claridad
        - Cada subpaso debe ser un párrafo separado
        - Usa **negrita** (markdown) para destacar términos clave
        - Para comandos, usa \`comando\` (entre backticks)
        - NO enumeres los pasos (no uses "1.", "2.", etc.)
        - NO uses viñetas ni guiones al inicio
        - Separa cada subpaso con una línea en blanco
        
        ## Consideraciones técnicas:
        - Asume que el usuario tiene conocimientos técnicos básicos
        - Da por hecho que las herramientas necesarias están disponibles
        - Proporciona la ruta completa de archivos cuando sea necesario
        `;
        
        // Añadir contexto sobre los archivos si están disponibles
        if (uploadedFiles.length > 0) {
          detailPrompt += `\n\n## Archivos disponibles:\n${uploadedFiles.map(file => `- ${file.name} (${file.type}, ${formatBytes(file.size)})`).join('\n')}`;
        }
        
        // Generar los subpasos utilizando Gemini con capacidades agénticas
        try {
          // Ejecutar comandos en el contenedor Docker para obtener información de contexto si es necesario
          let contextoDocker = '';
          try {
            if (isDockerInitialized) {
              // Obtener un contenedor disponible en lugar de usar "default"
              const container = await dockerService.getAvailableContainer();
              if (container && container.id) {
                const containerInfoResult = await dockerService.executeCommand(container.id, ['ls', '-la']);
                if (containerInfoResult && typeof containerInfoResult === 'string') {
                  contextoDocker = `\n\n## Contexto del entorno Docker:\n${containerInfoResult}`;
                  detailPrompt += contextoDocker;
                }
              } else {
                console.log("No se pudo obtener un contenedor Docker disponible");
              }
            }
          } catch (error) {
            console.error('Error al obtener contexto de Docker:', error);
            // Continuar sin el contexto de Docker
            contextoDocker = '\n\n## Nota: No se pudo acceder al entorno Docker para obtener contexto adicional.';
            detailPrompt += contextoDocker;
          }
          
          // Llamar a la API de Gemini para generar los subpasos
          console.log(`Generando subpasos para: "${paso.description}"`);
          const result = await geminiService.getTextResponse(detailPrompt);
          
          // Procesar la respuesta para extraer subpasos y preservar formato Markdown
          const rawText = result.trim();
          
          // Separamos por líneas en blanco para obtener subpasos claros
          const subStepBlocks = rawText.split(/\n\s*\n/)
            .filter(block => block.trim().length > 0)
            .map(block => block.trim());
          
          // Limitar a un máximo de 8 subpasos para mantener simplicidad
          const limitedSubSteps = subStepBlocks.slice(0, Math.min(subStepBlocks.length, 8));
          
          const subSteps: SubStep[] = limitedSubSteps.map((text, index) => {
            // Limpiar numeración y formatos como "1. " o "- " al inicio de la línea
            let cleanText = text.replace(/^(\d+\.|[-*•+])\s+/g, '');
            
            // Eliminar asteriscos y comillas redundantes al principio/final si existen
            if (cleanText.startsWith('"') && cleanText.endsWith('"')) {
              cleanText = cleanText.substring(1, cleanText.length - 1);
            }
            
            // Limitar longitud de cada subpaso para mejor visualización
            const maxLength = 250;
            if (cleanText.length > maxLength) {
              cleanText = cleanText.substring(0, maxLength) + '...';
            }
            
            return {
              id: (stepIndex + 1) * 100 + index,
              description: cleanText, // Mantener formato markdown en la descripción
              status: 'pending',
              parentId: paso.id
            };
          });
          
          // Actualizar el paso con los subpasos generados y cambiar su estado a completado
          setPlanSteps(prev => prev.map((step, index) => 
            index === stepIndex ? {...step, subSteps, status: 'completed'} : step
          ));
          
          return subSteps;
        } catch (error) {
          console.error(`Error al generar subpasos para el paso ${stepIndex + 1}:`, error);
          
          // Actualizar el paso con un estado de error
          setPlanSteps(prev => prev.map((step, index) => 
            index === stepIndex ? {...step, status: 'error'} : step
          ));
          
          // Generar un mensaje de error
          toast({
            variant: 'destructive',
            title: 'Error al Generar Subpasos',
            description: `No fue posible detallar el paso "${paso.description}". Por favor, intenta nuevamente.`,
          });
          
          return [];
        }
      };
      
      // Generar subpasos para cada paso del plan en paralelo
      const generationPromises = planSteps.map((_, index) => updateStepWithSubsteps(index));
      try {
        await Promise.all(generationPromises);
        
        // Verificar que todos los pasos se hayan completado correctamente
        const allStepsCompleted = planSteps.every(step => step.status === 'completed' && step.subSteps && step.subSteps.length > 0);
        
        if (allStepsCompleted) {
          setIsGeneratingSubSteps(false);
          setShowSubStepsGenerated(true);
          
          toast({
            title: 'Subpasos Generados',
            description: 'Se han generado todos los subpasos detallados para el plan.',
          });
        } else {
          // Si algún paso no se completó, intentar regenerar los que fallaron
          const failedSteps = planSteps.filter(step => step.status !== 'completed' || !step.subSteps || step.subSteps.length === 0);
          
          if (failedSteps.length > 0) {
            toast({
              variant: 'destructive',
              title: 'Generación Parcial',
              description: `Algunos pasos no pudieron generarse completamente. Intenta ejecutar el plan de todas formas.`,
            });
          }
          
          setIsGeneratingSubSteps(false);
          setShowSubStepsGenerated(true);
        }
      } catch (error) {
        console.error('Error al procesar los subpasos:', error);
        setIsGeneratingSubSteps(false);
        
        // Aún así permitimos ejecutar el plan con los subpasos que se generaron correctamente
        const hasAnySubSteps = planSteps.some(step => step.subSteps && step.subSteps.length > 0);
        if (hasAnySubSteps) {
          setShowSubStepsGenerated(true);
        }
        
        toast({
          variant: 'destructive',
          title: 'Error en la Generación',
          description: 'Ocurrió un error al generar algunos subpasos detallados. Puedes ejecutar el plan con los subpasos que se generaron correctamente.',
        });
      }
    } catch (error) {
      console.error('Error al generar los subpasos:', error);
      setIsGeneratingSubSteps(false);
      
      toast({
        variant: 'destructive',
        title: 'Error en la Generación',
        description: 'Ocurrió un error al generar los subpasos detallados.',
      });
    }
  };

  // Nueva función para ejecutar el plan con los subpasos
  const handleRunPlan = async () => {
    if (!plan || planSteps.length === 0) return;
    
    // Verificar que Docker está inicializado antes de ejecutar el plan
    if (!isDockerInitialized) {
      toast({
        variant: 'destructive',
        title: 'Docker No Inicializado',
        description: 'Espera a que Docker esté inicializado antes de ejecutar el plan.',
      });
      return;
    }
    
    setIsExecuting(true);
    setShowResults(false);
    setResults([]);

    // Ejecutar los pasos y subpasos
    for (let i = 0; i < planSteps.length; i++) {
      const paso = planSteps[i];
      setPlanSteps(prev => prev.map((step, index) => index === i ? {...step, status: 'in-progress'} : step));
      
      // Si el paso tiene subpasos, ejecutarlos uno por uno
      if (paso.subSteps && paso.subSteps.length > 0) {
        for (let j = 0; j < paso.subSteps.length; j++) {
          // Actualizar el estado del subpaso a "en progreso"
          setPlanSteps(prev => {
            const updatedSteps = [...prev];
            const currentStep = {...updatedSteps[i]};
            if (currentStep.subSteps) {
              currentStep.subSteps = currentStep.subSteps.map((subStep, subIndex) => 
                subIndex === j ? {...subStep, status: 'in-progress'} : subStep
              );
            }
            updatedSteps[i] = currentStep;
            return updatedSteps;
          });
          
          // Simular el trabajo (en una implementación real, aquí se ejecutaría cada subpaso)
          await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1000));
          
          // Actualizar el estado del subpaso a "completado"
          setPlanSteps(prev => {
            const updatedSteps = [...prev];
            const currentStep = {...updatedSteps[i]};
            if (currentStep.subSteps) {
              currentStep.subSteps = currentStep.subSteps.map((subStep, subIndex) => 
                subIndex === j ? {...subStep, status: 'completed'} : subStep
              );
            }
            updatedSteps[i] = currentStep;
            return updatedSteps;
          });
        }
      } else {
        // Si no tiene subpasos, simular trabajo para el paso principal
        await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 1500));
      }
      
      // Marcar el paso como completado
      setPlanSteps(prev => prev.map((step, index) => index === i ? {...step, status: 'completed'} : step));
    }

    // Generar resultados como lo hacía la función original
    const generatedResults: ResultItem[] = [];
    
    // Determinar si es un plan de tipo PlanVisualizationOutput (formato anterior)
    const isVisualizationPlan = 'visualizationFormats' in plan;
    
    // Si es plan de visualización, añadir los otros formatos
    if (isVisualizationPlan) {
      if (plan.visualizationFormats.includes('table')) {
        generatedResults.push({ 
          type: 'table', 
          title: 'Tabla de Datos', 
          content: { headers: ['Categoría', 'Valor'], rows: [['A', 10], ['B', 25], ['C', 15]] } 
        });
      }
      
      if (plan.visualizationFormats.includes('graph')) {
        generatedResults.push({ 
          type: 'graph', 
          title: 'Gráfico de Ejemplo', 
          content: { type: 'bar', data: [{ name: 'Ene', value: 100 }, { name: 'Feb', value: 150 }, { name: 'Mar', value: 120 }] } 
        });
      }
      
      if (plan.visualizationFormats.includes('file')) {
        const fileContent = `Resultados generados para el prompt: ${prompt}\nDetalles del plan: ${plan.plan}`;
        const base64Content = btoa(unescape(encodeURIComponent(fileContent)));
        generatedResults.push({ 
          type: 'file', 
          title: 'Archivo de Resultados Descargable', 
          fileName: 'resultados.txt', 
          fileType: 'text/plain', 
          content: 'data:text/plain;base64,' + base64Content 
        });
      }
      
      if (plan.visualizationFormats.includes('animation')) {
        generatedResults.push({ 
          type: 'animation', 
          title: 'Animación de Resultados (Placeholder)', 
          content: 'https://picsum.photos/400/300?random=1' 
        });
      }
    } 
    // Si es un plan agéntico, añadir visualizaciones basadas en su estructura
    else if ('pasos' in plan) {
      // Añadir tabla con pasos del plan
      const rowsData = plan.pasos.map((paso, idx) => [
        `Paso ${idx + 1}`,
        paso.paso
      ]);
      
      generatedResults.push({ 
        type: 'table', 
        title: 'Pasos del Plan', 
        content: { 
          headers: ['#', 'Descripción'], 
          rows: rowsData 
        } 
      });
      
      // Si tiene detalles de visualización, añadir un placeholder gráfico
      if (plan.detallesVisualizacion) {
        generatedResults.push({ 
          type: 'graph', 
          title: 'Visualización Propuesta', 
          content: { 
            type: 'bar', 
            data: [
              { name: 'Elemento 1', value: 100 }, 
              { name: 'Elemento 2', value: 150 }, 
              { name: 'Elemento 3', value: 120 }
            ] 
          } 
        });
      }
    }

    setResults(generatedResults);
    setShowResults(true);
    setIsExecuting(false);
    setShowPlan(false); // Ocultar plan después de la ejecución
  };

  const handleNewProject = () => {
      setPrompt('');
      setUploadedFiles([]);
      setIsLoading(false);
      setShowPlan(false);
      setPlan(null);
      setPlanSteps([]);
      setIsExecuting(false);
      setShowResults(false);
      setResults([]);
  }

  const formatBytes = (bytes: number, decimals = 2): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    // Ensure i is within bounds of sizes array
    const sizeIndex = Math.max(0, Math.min(i, sizes.length - 1));
    return parseFloat((bytes / Math.pow(k, sizeIndex)).toFixed(dm)) + ' ' + sizes[sizeIndex];
  };

  // Añadir una función para manejar los diferentes tipos de planes
  const isPlanVisualization = (plan: PlanVisualizationOutput | AgenticPlanningOutput | null): plan is PlanVisualizationOutput => {
    return !!plan && 'visualizationFormats' in plan && 'requiresExternalInfo' in plan;
  };

  // Función para renderizar texto con formato Markdown básico
  const renderMarkdownText = (text: string): React.ReactNode => {
    if (!text) return null;
    
    // Procesar negrita: **texto** -> <strong>texto</strong>
    const boldProcessed = text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        const content = part.slice(2, -2);
        return <strong key={index}>{content}</strong>;
      }
      return part;
    });
    
    // Procesar código inline: `código` -> <code>código</code>
    const result = boldProcessed.map((part, index) => {
      if (typeof part === 'string') {
        return part.split(/(`[^`]+`)/g).map((codePart, codeIndex) => {
          if (codePart.startsWith('`') && codePart.endsWith('`')) {
            const content = codePart.slice(1, -1);
            return <code key={`${index}-${codeIndex}`} className="px-1 py-0.5 bg-muted rounded text-xs font-mono">{content}</code>;
          }
          return codePart;
        });
      }
      return part;
    });
    
    return result;
  };

  const renderPlanSteps = () => {
    return (
      <div className="space-y-3 mt-4">
        {planSteps.map((step, index) => (
          <div 
            key={step.id} 
            className={`rounded-md p-3 border transition-all ${
              step.status === 'completed' 
                ? 'bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-900' 
                : step.status === 'in-progress'
                ? 'bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-900'
                : step.status === 'error'
                ? 'bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-900'
                : 'bg-muted/50 border-muted-foreground/20'
            }`}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium flex items-center gap-2 flex-shrink overflow-hidden">
                <span className={`flex-shrink-0 flex items-center justify-center h-6 w-6 rounded-full ${
                  step.status === 'completed' 
                    ? 'bg-green-500 text-white' 
                    : step.status === 'in-progress'
                    ? 'bg-blue-500 text-white'
                    : step.status === 'error'
                    ? 'bg-red-500 text-white'
                    : 'bg-muted-foreground/20 text-muted-foreground'
                } text-xs font-medium`}>{step.id}</span>
                <span className="truncate">{step.description}</span>
              </h3>
              
              {/* Indicador de estado y botón para colapsar/expandir */}
              <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                {step.status === 'in-progress' && (
                  <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                )}
                {step.status === 'completed' && (
                  <CheckCircle className="h-4 w-4 text-green-500" />
                )}
                {step.status === 'error' && (
                  <XCircle className="h-4 w-4 text-red-500" />
                )}
                
                {/* Botón para colapsar/expandir subpasos */}
                {step.subSteps && step.subSteps.length > 0 && (
                  <Button
                    variant="ghost" 
                    size="icon"
                    className="h-6 w-6 p-0 hover:bg-muted/60"
                    onClick={() => {
                      setPlanSteps(prev => prev.map((s, i) => 
                        i === index ? {...s, isCollapsed: !s.isCollapsed} : s
                      ));
                    }}
                  >
                    {step.isCollapsed ? (
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                    )}
                  </Button>
                )}
              </div>
            </div>
            
            {/* Contenedor de subpasos, visible solo cuando no está colapsado */}
            {step.subSteps && step.subSteps.length > 0 && !step.isCollapsed && (
              <div className="mt-3 pl-8 space-y-3 max-w-full overflow-hidden">
                {step.subSteps.map((subStep) => (
                  <div 
                    key={subStep.id} 
                    className={`rounded-md p-2 border transition-all w-full max-w-full overflow-hidden ${
                      subStep.status === 'completed' 
                        ? 'bg-green-50 border-green-100 dark:bg-green-950/20 dark:border-green-900/50' 
                        : subStep.status === 'in-progress'
                        ? 'bg-blue-50 border-blue-100 dark:bg-blue-950/20 dark:border-blue-900/50'
                        : subStep.status === 'error'
                        ? 'bg-red-50 border-red-100 dark:bg-red-950/20 dark:border-red-900/50'
                        : 'bg-muted/30 border-muted-foreground/10'
                    }`}
                  >
                    <div className="flex items-start gap-2 w-full max-w-full">
                      <div className={`flex-shrink-0 mt-0.5 flex items-center justify-center h-4 w-4 rounded-full ${
                        subStep.status === 'completed' 
                          ? 'bg-green-500 text-white' 
                          : subStep.status === 'in-progress'
                          ? 'bg-blue-500 text-white'
                          : subStep.status === 'error'
                          ? 'bg-red-500 text-white'
                          : 'bg-muted-foreground/20 text-muted-foreground'
                      } text-[10px] font-medium`}>
                        {subStep.status === 'completed' && <CheckCircle className="h-2.5 w-2.5" />}
                        {subStep.status === 'in-progress' && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                        {(subStep.status === 'pending' || subStep.status === 'error') && 
                          <span className="text-[8px]">{Math.floor((subStep.id % 100))}</span>
                        }
                      </div>
                      
                      <div
                        className="text-sm flex-1 overflow-hidden prose prose-sm max-w-none dark:prose-invert break-words markdown-content"
                        dangerouslySetInnerHTML={{
                          __html: marked(subStep.description)
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  };

  // Function to render different result types
  const renderResultItem = (item: ResultItem, index: number) => {
    switch (item.type) {
      case 'text':
        return (
          <Card key={index} className="mb-4 result-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5 text-accent" /> {item.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm whitespace-pre-wrap">{item.content}</p> {/* Use pre-wrap for formatting */}
            </CardContent>
          </Card>
        );
      case 'table':
         // Basic table rendering - replace with actual ShadCN table later if needed
         return (
           <Card key={index} className="mb-4 result-card">
             <CardHeader>
               <CardTitle className="flex items-center gap-2"><Table className="h-5 w-5 text-accent" /> {item.title}</CardTitle>
             </CardHeader>
             <CardContent>
                <div className="overflow-x-auto rounded-md border">
                 <table className="w-full text-sm">
                   <thead className="bg-muted/50">
                     <tr className="border-b">
                       {item.content?.headers.map((header: string, hIndex: number) => <th key={hIndex} className="p-3 text-left font-medium text-muted-foreground">{header}</th>)}
                     </tr>
                   </thead>
                   <tbody>
                     {item.content?.rows.map((row: any[], rIndex: number) => (
                       <tr key={rIndex} className="border-b last:border-b-0 hover:bg-muted/50 transition-colors">
                         {row.map((cell, cIndex) => <td key={cIndex} className="p-3 align-top">{cell}</td>)}
                       </tr>
                     ))}
                   </tbody>
                 </table>
                 </div>
             </CardContent>
           </Card>
         );
       case 'graph':
         // Basic placeholder for graph - integrate ShadCN charts or other libs later
         return (
           <Card key={index} className="mb-4 result-card">
             <CardHeader>
               <CardTitle className="flex items-center gap-2"><BarChart className="h-5 w-5 text-accent" /> {item.title}</CardTitle>
             </CardHeader>
             <CardContent className="flex items-center justify-center h-64 bg-muted/30 rounded-md border">
               <p className="text-muted-foreground text-center p-4">[Graph Placeholder: {item.content?.type}]<br/>Chart rendering is not yet implemented.</p>
                {/* Ideally, render a chart component here using ShadCN Charts */}
             </CardContent>
           </Card>
         );
      case 'animation':
        return (
            <Card key={index} className="mb-4 result-card">
                <CardHeader>
                <CardTitle className="flex items-center gap-2"><Presentation className="h-5 w-5 text-accent" /> {item.title}</CardTitle>
                </CardHeader>
                <CardContent className="flex justify-center">
                 {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.content} alt={item.title} className="rounded-md border w-full max-w-md mx-auto object-contain" />
                </CardContent>
            </Card>
        )
       case 'file':
         return (
           <Card key={index} className="mb-4 result-card">
             <CardHeader>
               <CardTitle className="flex items-center gap-2">{getFileIcon(item.fileType || 'text/plain')} {item.title}</CardTitle>
             </CardHeader>
             <CardContent>
               <a href={item.content} download={item.fileName}>
                 <Button variant="outline" className="gap-2">
                     <Download className="h-4 w-4"/> {/* Add Download icon */}
                     Download {item.fileName}
                 </Button>
               </a>
             </CardContent>
           </Card>
         );
      case 'plan':
        return (
          <Card key={index} className="mb-4 result-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 4h6v6"/><path d="M10 20H4v-6"/><path d="M20 10 4 10"/><path d="M10 4v4.5"/><path d="M14 20v-4.5"/></svg>
                Plan Generado con Gemini
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <h3 className="text-lg font-semibold">Resumen del Plan</h3>
                  {item.plan && (
                    <p className="whitespace-pre-wrap">{item.plan.plan}</p>
                  )}
                
                  <h3 className="text-lg font-semibold mt-6">Pasos a Seguir</h3>
                  
                  {/* Si hay pasos en el estado del componente, usamos esos */}
                  {planSteps.length > 0 ? (
                    renderPlanSteps()
                  ) : (
                    /* Si no, mostramos los del plan directamente */
                    <div className="space-y-3">
                      {item.plan && isAgenticPlan(item.plan) && item.plan.pasos.map((paso, idx) => (
                        <div key={idx} className="rounded-md p-3 border bg-muted/50 border-muted-foreground/20">
                          <h3 className="text-sm font-medium flex items-center gap-2">
                            <span className="flex items-center justify-center h-6 w-6 rounded-full bg-muted-foreground/20 text-muted-foreground text-xs font-medium">{idx + 1}</span>
                            {paso.paso}
                          </h3>
                          <p className="text-sm text-muted-foreground mt-1 pl-8">{paso.explicacion}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Mostrar información de análisis de archivos */}
                {item.plan && isAgenticPlan(item.plan) && item.plan.requiereAnalisisArchivos && (
                  <div className="rounded-md p-3 border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30">
                    <h3 className="text-sm font-medium flex items-center gap-2">
                      <FileText className="h-4 w-4" /> 
                      Análisis de Archivos Requerido
                    </h3>
                    {item.plan?.archivosSolicitados && item.plan.archivosSolicitados.length > 0 && (
                      <p className="text-xs mt-1">
                        Archivos analizados: {item.plan.archivosSolicitados.join(', ')}
                      </p>
                    )}
                  </div>
                )}

                {/* Mostrar información de búsqueda externa */}
                {item.plan && isAgenticPlan(item.plan) && item.plan.requiereInfoExterna && (
                  <div className="rounded-md p-3 border border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30">
                    <h3 className="text-sm font-medium flex items-center gap-2">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                      Información Externa Requerida
                    </h3>
                    {item.plan?.busquedasRealizadas && item.plan.busquedasRealizadas.length > 0 && (
                      <p className="text-xs mt-1">
                        Búsquedas realizadas: {item.plan.busquedasRealizadas.join(', ')}
                      </p>
                    )}
                  </div>
                )}

                {/* Mostrar detalles de visualización */}
                {item.plan && isAgenticPlan(item.plan) && item.plan.detallesVisualizacion && (
                  <div className="rounded-md p-3 border border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30">
                    <h3 className="text-sm font-medium flex items-center gap-2">
                      <Presentation className="h-4 w-4" />
                      Detalles de Visualización
                    </h3>
                    <p className="text-xs mt-1">
                      {item.plan.detallesVisualizacion}
                    </p>
                  </div>
                )}
                
                {/* Botones de acción */}
                <div className="flex gap-2 mt-4">
                  <Button 
                    variant="secondary" 
                    className="text-xs"
                    onClick={handleExecutePlan}
                    disabled={isExecuting || isGeneratingSubSteps}
                  >
                    <CheckCircle className="h-4 w-4 mr-1" />
                    Aceptar Plan
                  </Button>

                  <Button 
                    variant="outline" 
                    className="text-xs"
                    onClick={() => setShowPlan(false)}
                    disabled={isExecuting || isGeneratingSubSteps}
                  >
                    <RotateCcw className="h-4 w-4 mr-1" />
                    Volver a Editar
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      default:
        return null;
    }
  };


  return (
    <div className="flex flex-col items-center justify-start min-h-screen p-4 md:p-8 transition-all duration-500 ease-in-out">
      {/* Estilos para formato markdown en subpasos */}
      <style jsx global>{`
        .markdown-content code {
          background-color: rgba(0, 0, 0, 0.05);
          padding: 0.2em 0.4em;
          border-radius: 3px;
          font-family: monospace;
          font-size: 0.9em;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .markdown-content strong {
          font-weight: 600;
        }
        .dark .markdown-content code {
          background-color: rgba(255, 255, 255, 0.1);
        }
        .prose p {
          margin-top: 0.5em;
          margin-bottom: 0.5em;
        }
        .prose code {
          background-color: rgba(0, 0, 0, 0.05);
          padding: 0.2em 0.4em;
          border-radius: 3px;
          font-family: monospace;
          font-size: 0.9em;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .dark .prose code {
          background-color: rgba(255, 255, 255, 0.1);
        }
      `}</style>
      
      <div className="w-full max-w-3xl">
        <DockerStatus />
      </div>
      
      <Card className={cn(
          'w-full max-w-3xl transition-all duration-500 ease-in-out',
          showPlan || showResults || isExecuting ? 'mb-8 shadow-md' : 'my-auto shadow-xl prompt-box-shadow'
          )}>
        <CardHeader className="text-center">
          <CardTitle className="text-3xl font-bold tracking-tight flex items-center justify-center gap-2">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2L2 7V17L12 22L22 17V7L12 2Z" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M2 7L12 12M12 12L22 7M12 12V22M12 12L6 9.5M12 12L18 9.5" stroke="hsl(var(--accent))" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M2 17L6 14.5M22 17L18 14.5" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
             FlowCode
          </CardTitle>
          <CardDescription className="text-lg text-muted-foreground">
            Describe your idea, add files, and let AI build the plan.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Textarea
              placeholder="¿Qué necesitas crear hoy? Describe tu idea, ej: 'Analiza las ventas del archivo CSV y crea un gráfico de tendencias mensuales' o 'Genera 10 ideas de nombres para una startup de IA'"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="min-h-[120px] text-base focus:ring-2 focus:ring-accent focus:ring-offset-2 transition-shadow"
              rows={4}
              disabled={isLoading || isExecuting}
              spellCheck={false}
            />
          </div>

           <div
            className={cn(
                "relative flex flex-col items-center justify-center p-6 rounded-lg transition-all duration-300 file-dropzone-border cursor-pointer",
                isDragging ? 'border-accent bg-accent/10' : 'border-border bg-background/50',
                (isLoading || isExecuting) ? 'opacity-50 cursor-not-allowed' : ''
                )}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => !isLoading && !isExecuting && fileInputRef.current?.click()}
            >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              className="hidden"
              multiple
              accept="*"
              disabled={isLoading || isExecuting}
            />
             <div className="flex flex-col items-center pointer-events-none">
                 <UploadCloud className="h-12 w-12 text-muted-foreground mb-2" />
                <p className="text-muted-foreground text-center text-sm">
                {isDragging ? 'Drop files here' : 'Drag & drop files here, or click to select'}
                </p>
                <p className="text-xs text-muted-foreground/80 mt-1">Max total size: 50MB</p>
            </div>
          </div>

          {uploadedFiles.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-foreground">Uploaded Files:</h4>
              <ScrollArea className="h-24 w-full rounded-md border p-2">
                <ul className="space-y-1">
                  {uploadedFiles.map((file, index) => (
                    <li key={index} className="flex items-center justify-between text-sm p-1 rounded hover:bg-muted/50">
                      <div className="flex items-center gap-2 truncate min-w-0">
                        <div className="flex-shrink-0">{getFileIcon(file.type)}</div>
                        <span className="truncate flex-grow" title={file.name}>{file.name}</span>
                        <Badge variant="secondary" className="text-xs flex-shrink-0">{formatBytes(file.size)}</Badge>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-destructive flex-shrink-0"
                        onClick={(e) => { e.stopPropagation(); removeFile(file.name); }}
                        disabled={isLoading || isExecuting}
                        aria-label={`Remove ${file.name}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            </div>
          )}

          <Button
            size="lg"
            className="w-full text-lg font-semibold rounded-full shadow-md hover:shadow-lg transition-shadow bg-gradient-to-r from-primary via-accent to-primary hover:from-primary/90 hover:via-accent/90 hover:to-primary/90 text-primary-foreground"
            onClick={handleGeneratePlan}
            disabled={isLoading || isExecuting || (!prompt.trim() && uploadedFiles.length === 0)}
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Generating Plan...
              </>
            ) : (
              <>
                <Wand2 className="mr-2 h-5 w-5" />
                Generate Plan
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {showPlan && plan && !isExecuting && (
        <div className="w-full max-w-3xl mt-4 flex justify-end animate-fade-in">
          <Button
            size="lg"
            className="text-lg font-semibold rounded-full shadow-md hover:shadow-lg transition-shadow bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white"
            onClick={handleRunPlan}
          >
            <Rocket className="mr-2 h-5 w-5" />
            Ejecutar Plan
          </Button>
        </div>
      )}

        {isExecuting && (
        <Card className="w-full max-w-3xl animate-fade-in mt-8 plan-step-card bg-gradient-to-b from-background to-secondary/80">
            <CardHeader>
            <CardTitle className="text-2xl font-semibold flex items-center gap-2"><Loader2 className="text-accent animate-spin" /> Executing Plan...</CardTitle>
            <CardDescription>Working on your request. Follow the progress below.</CardDescription>
            </CardHeader>
            <CardContent>
            <ul className="space-y-3">
                {planSteps.map((step) => (
                <li key={step.id} className={cn(
                    'flex items-center gap-3 p-3 rounded-md border transition-all duration-300 shadow-sm',
                    step.status === 'completed' && 'border-green-300 bg-green-50 dark:bg-green-900/30',
                    step.status === 'in-progress' && 'border-blue-300 bg-blue-50 dark:bg-blue-900/30 animate-pulse',
                    step.status === 'error' && 'border-red-300 bg-red-50 dark:bg-red-900/30',
                    step.status === 'pending' && 'border-border/50 bg-card/70'
                    )}>
                    <div className="flex-shrink-0">
                     {step.status === 'pending' && <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/50"></div>}
                    {step.status === 'in-progress' && <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />}
                    {step.status === 'completed' && <CheckCircle className="h-5 w-5 text-green-500" />}
                     {step.status === 'error' && <XCircle className="h-5 w-5 text-red-500" />}
                    </div>
                    <p className={cn(
                        'text-sm flex-grow',
                        step.status === 'completed' && 'text-green-700 dark:text-green-300',
                        step.status === 'error' && 'text-red-700 dark:text-red-300',
                         step.status === 'in-progress' && 'text-blue-700 dark:text-blue-300',
                        step.status === 'pending' && 'text-foreground'
                        )}>{step.description}</p>
                    {step.icon && <div className={cn(
                        "ml-auto opacity-70",
                        step.status === 'completed' && 'text-green-500',
                         step.status === 'error' && 'text-red-500',
                         step.status === 'in-progress' && 'text-blue-500'
                        )}>{step.icon}</div>}
                </li>
                ))}
            </ul>
            <Progress value={planSteps.filter(s => s.status === 'completed' || s.status === 'error').length / planSteps.length * 100} className="mt-4 h-2" />
            </CardContent>
        </Card>
        )}


        {showResults && results.length > 0 && (
            <div className="w-full max-w-3xl mt-8 animate-fade-in">
            <h2 className="text-2xl font-semibold mb-6 text-center flex items-center justify-center gap-2"><CheckCircle className="text-green-500 h-7 w-7"/> Results Ready!</h2>
            {results.map(renderResultItem)}
             <Button
                 size="lg"
                 variant="outline"
                className="w-full mt-8 text-lg font-semibold rounded-full"
                onClick={handleNewProject}
             >
                 <RotateCcw className="mr-2 h-5 w-5"/>
                Start New Project
            </Button>
            </div>
        )}
    </div>
  );
};

export default FlowCodePage;
