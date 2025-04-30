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

const FlowCodePage: NextPage = () => {
  const [prompt, setPrompt] = useState('');
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showPlan, setShowPlan] = useState(false);
  const [plan, setPlan] = useState<PlanVisualizationOutput | AgenticPlanningOutput | null>(null);
  const [planSteps, setPlanSteps] = useState<PlanStep[]>([]);
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
    setIsExecuting(false);
    setShowResults(false);
    setResults([]);

    try {
      // Preparar información detallada de los archivos para Gemini
      const fileInfos = uploadedFiles.map(file => ({
        name: file.name,
        type: file.type,
        size: formatBytes(file.size),
      }));

      // Preparar archivos para el flujo agéntico con información detallada
      const fileNames = uploadedFiles.map(file => file.name);
      const fileContents = uploadedFiles.map(file => {
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

        // Añadir metadatos al inicio del contenido
        return `[Archivo: ${file.name}]
Tipo: ${file.type}
Tamaño: ${formatBytes(file.size)}
---
${contenido}`;
      });

      // Si el Docker está inicializado, subir archivos al contenedor antes de comenzar el plan
      if (isDockerInitialized && uploadedFiles.length > 0) {
        try {
          // Obtener un contenedor disponible
          const container = await dockerService.getAvailableContainer();
          
          // Subir archivos al contenedor
          toast({
            title: "Subiendo archivos",
            description: `Subiendo ${uploadedFiles.length} archivos al contenedor Docker...`,
          });
          
          // Preparar archivos para subir
          const filesToUpload = uploadedFiles.map(file => ({
            name: file.name,
            dataUri: file.dataUri
          }));
          
          // Subir archivos al directorio uploads
          await dockerService.uploadFilesFromDataUris(container.id, filesToUpload);
          
          toast({
            title: "Archivos subidos",
            description: `${uploadedFiles.length} archivos subidos correctamente al contenedor.`,
          });
        } catch (error) {
          console.error('Error al subir archivos al contenedor Docker:', error);
          toast({
            variant: 'destructive',
            title: "Error al subir archivos",
            description: "No se pudieron subir archivos al contenedor Docker.",
          });
        }
      }

      // Preparar la entrada para el flujo agéntico con información detallada
      const input = {
        prompt: uploadedFiles.length > 0 
          ? `${prompt}\n\nArchivos disponibles:\n${fileInfos.map(f => `- ${f.name} (${f.type}, ${f.size})`).join('\n')}`
          : prompt,
        fileNames,
        fileContents,
      };

      // Generar el plan usando el flujo agéntico
      const agenticPlan = await generateAgenticPlan(input);
      
      // Actualizar la interfaz con el plan generado
      const planAdaptado: PlanVisualizationOutput = {
        plan: agenticPlan.plan,
        requiresExternalInfo: agenticPlan.requiereInfoExterna,
        requiresFileAnalysis: agenticPlan.requiereAnalisisArchivos,
        visualizationFormats: agenticPlan.detallesVisualizacion ? [agenticPlan.detallesVisualizacion] : []
      };
      setPlan(planAdaptado);

      // Crear los pasos del plan a partir de la respuesta agéntica
      const steps: PlanStep[] = [
        {
          id: 1, 
          description: `Analizar la solicitud: "${prompt ? prompt.substring(0, 50)+'...' : 'Basado en archivos cargados'}"`, 
          status: 'completed', 
          icon: <Info className="h-5 w-5 text-blue-500" />
        },
      ];

      // Añadir pasos para archivos solicitados
      if (agenticPlan.archivosSolicitados && agenticPlan.archivosSolicitados.length > 0) {
        steps.push({
          id: 2, 
          description: `Analizar archivos: ${agenticPlan.archivosSolicitados.join(', ')}`, 
          status: 'completed', 
          icon: <FileText className="h-5 w-5 text-purple-500" />
        });
      }

      // Añadir pasos para búsquedas realizadas
      if (agenticPlan.busquedasRealizadas && agenticPlan.busquedasRealizadas.length > 0) {
        steps.push({
          id: 3, 
          description: `Buscar información: ${agenticPlan.busquedasRealizadas.join(', ')}`, 
          status: 'completed', 
          icon: <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-orange-500"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        });
      }

      // Añadir paso para la generación del plan
      steps.push({
        id: 4, 
        description: 'Generar plan detallado', 
        status: 'completed', 
        icon: <Wand2 className="h-5 w-5 text-green-500" />
      });

      // Paso para la visualización si hay detalles
      if (agenticPlan.detallesVisualizacion) {
        steps.push({
          id: 5, 
          description: `Preparar visualización: ${agenticPlan.detallesVisualizacion.substring(0, 50)}...`, 
          status: 'completed', 
          icon: <Presentation className="h-5 w-5 text-indigo-500" />
        });
      }

      setPlanSteps(steps);
      setShowPlan(true);

      // Mostrar resultados inmediatamente con la visualización del plan
      const generatedResults: ResultItem[] = [
        { 
          type: 'plan', 
          title: 'Plan Generado por Gemini', 
          content: `Plan detallado generado usando Gemini 2.5 Flash con función agéntica.`,
          plan: agenticPlan
        }
      ];

      setResults(generatedResults);
      setShowResults(true);

    } catch (error: any) {
      console.error('Error al generar el plan:', error);
      toast({
        variant: 'destructive',
        title: 'Error al Generar el Plan',
        description: error.message || 'Ocurrió un error desconocido al generar el plan. Por favor, inténtalo de nuevo.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleExecutePlan = async () => {
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

    // Simular ejecución
    for (let i = 0; i < planSteps.length; i++) {
      setPlanSteps(prev => prev.map((step, index) => index === i ? {...step, status: 'in-progress'} : step));
      await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 1500)); // Simular trabajo

      // Simular posibles errores
      if (Math.random() < 0.1 && i > 0) { // 10% de probabilidad de error después del primer paso
        setPlanSteps(prev => prev.map((step, index) => index === i ? {...step, status: 'error'} : step));
        toast({
          variant: 'destructive',
          title: 'Error de Ejecución',
          description: `Ocurrió un error durante el paso: ${planSteps[i].description}`,
        });
        setIsExecuting(false);
        return; // Detener ejecución en caso de error
      }

      setPlanSteps(prev => prev.map((step, index) => index === i ? {...step, status: 'completed'} : step));
    }

    // Simular la generación de resultados basados en el plan
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

  const isAgenticPlan = (plan: PlanVisualizationOutput | AgenticPlanningOutput | null): plan is AgenticPlanningOutput => {
    return !!plan && 'pasos' in plan && 'requiereInfoExterna' in plan;
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
                <Rocket className="h-5 w-5 text-accent" /> {item.title}
              </CardTitle>
              <CardDescription>
                Generado con Gemini 2.5 Flash en modo agéntico
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* Mostrar pasos del plan */}
                <div className="space-y-3">
                  <h3 className="text-lg font-medium">Pasos del Plan</h3>
                  {item.plan?.pasos?.map((paso, pasoIndex) => (
                    <div key={pasoIndex} className="bg-muted/30 rounded-md p-3 border">
                      <h4 className="font-medium text-sm flex items-start gap-2">
                        <span className="flex-shrink-0 bg-accent/20 text-accent rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold">{pasoIndex + 1}</span>
                        <span>{paso.paso}</span>
                      </h4>
                      <p className="text-xs text-muted-foreground mt-2 ml-8">{paso.explicacion}</p>
                    </div>
                  ))}
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
                    disabled={isExecuting}
                  >
                    <CheckCircle className="h-4 w-4 mr-1" />
                    Aceptar y Ejecutar Plan
                  </Button>

                  <Button 
                    variant="outline" 
                    className="text-xs"
                    onClick={() => setShowPlan(false)}
                  >
                    <XCircle className="h-4 w-4 mr-1" />
                    Rechazar Plan
                  </Button>
                </div>
                
                {/* Añadir área para comentarios/feedback sobre el plan - Movido al final */}
                <div className="mt-4 space-y-2 pt-4 border-t">
                  <h3 className="text-sm font-medium">¿Quieres mejorar el plan?</h3>
                  <Textarea 
                    placeholder="Añade comentarios o sugerencias para mejorar el plan. Por ejemplo: 'Añade un paso para visualizar los resultados en un gráfico' o 'Necesito que el análisis incluya también estadísticas'"
                    className="min-h-[100px] text-sm"
                    id="plan-feedback"
                  />
                  <Button 
                    size="sm" 
                    className="mt-2"
                    onClick={async () => {
                      const feedback = (document.getElementById('plan-feedback') as HTMLTextAreaElement)?.value;
                      if (feedback && item.plan) {
                        toast({
                          title: "Recalculando plan",
                          description: "Procesando tus comentarios para mejorar el plan...",
                        });

                        try {
                          // Preparar información detallada de los archivos
                          const fileInfos = uploadedFiles.map(file => ({
                            name: file.name,
                            type: file.type,
                            size: formatBytes(file.size),
                          }));

                          // Preparar la entrada para el flujo agéntico con el feedback e información de archivos
                          const input = {
                            prompt: `${prompt}\n\n${uploadedFiles.length > 0 
                              ? `Archivos disponibles:\n${fileInfos.map(f => `- ${f.name} (${f.type}, ${f.size})`).join('\n')}\n\n`
                              : ''}Comentarios adicionales: ${feedback}`,
                            fileNames: uploadedFiles.map(f => f.name),
                            fileContents: uploadedFiles.map(f => {
                              const [, base64Content] = f.dataUri.split(',');
                              let contenido = '';
                              if (base64Content) {
                                try {
                                  contenido = decodeURIComponent(escape(atob(base64Content)));
                                } catch (error) {
                                  contenido = `[Contenido binario no mostrado: ${f.name}]`;
                                }
                              } else {
                                contenido = `[No se pudo extraer contenido: ${f.name}]`;
                              }

                              return `[Archivo: ${f.name}]
Tipo: ${f.type}
Tamaño: ${formatBytes(f.size)}
---
${contenido}`;
                            }),
                          };

                          // Generar nuevo plan con el feedback incorporado
                          const nuevoAgenticPlan = await generateAgenticPlan(input);
                          
                          // Actualizar el estado con el nuevo plan
                          const planAdaptado: PlanVisualizationOutput = {
                            plan: nuevoAgenticPlan.plan,
                            requiresExternalInfo: nuevoAgenticPlan.requiereInfoExterna,
                            requiresFileAnalysis: nuevoAgenticPlan.requiereAnalisisArchivos,
                            visualizationFormats: nuevoAgenticPlan.detallesVisualizacion ? [nuevoAgenticPlan.detallesVisualizacion] : []
                          };
                          setPlan(planAdaptado);

                          // Actualizar los resultados con el nuevo plan
                          setResults(prevResults => prevResults.map(result => {
                            if (result.type === 'plan') {
                              return {
                                ...result,
                                plan: nuevoAgenticPlan
                              };
                            }
                            return result;
                          }));

                          // Limpiar el textarea de feedback
                          (document.getElementById('plan-feedback') as HTMLTextAreaElement).value = '';

                          toast({
                            title: "Plan actualizado",
                            description: "El plan ha sido mejorado con tus comentarios.",
                          });
                        } catch (error: any) {
                          console.error('Error al mejorar el plan:', error);
                          toast({
                            variant: 'destructive',
                            title: "Error al mejorar el plan",
                            description: error.message || "No se pudo procesar tu feedback. Por favor, inténtalo de nuevo.",
                          });
                        }
                      }
                    }}
                  >
                    Mejorar Plan
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
            onClick={handleExecutePlan}
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
