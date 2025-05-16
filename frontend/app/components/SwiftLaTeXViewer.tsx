'use client';

import { useState, useEffect, useRef } from 'react';

interface SwiftLaTeXViewerProps {
  latexContent: string;
  onPdfReady?: (pdfUrl: string) => void;
}

// Declaración de la API para PdfTeXEngine
declare global {
  interface Window {
    PdfTeXEngine: any;
  }
}

const SwiftLaTeXViewer = ({ latexContent, onPdfReady }: SwiftLaTeXViewerProps) => {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [compilationLog, setCompilationLog] = useState<string | null>(null);
  const engineRef = useRef<any>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const engineInitialized = useRef<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isHidden, setIsHidden] = useState(false);
  
  // Detectar si el componente está en un contenedor oculto
  useEffect(() => {
    if (typeof window !== 'undefined' && containerRef.current) {
      const checkVisibility = () => {
        const isElementHidden = (element: HTMLElement): boolean => {
          if (!element) return false;
          
          // Verificar si el elemento o alguno de sus padres está oculto
          const style = window.getComputedStyle(element);
          if (style.display === 'none' || style.visibility === 'hidden') return true;
          
          // Verificar si tiene la clase 'hidden' o algún padre la tiene
          if (element.classList.contains('hidden')) return true;
          
          // Verificar padres
          let parent = element.parentElement;
          while (parent) {
            const parentStyle = window.getComputedStyle(parent);
            if (parentStyle.display === 'none' || parentStyle.visibility === 'hidden' || 
                parent.classList.contains('hidden')) {
              return true;
            }
            parent = parent.parentElement;
          }
          
          return false;
        };
        
        setIsHidden(isElementHidden(containerRef.current as HTMLElement));
      };
      
      checkVisibility();
      
      // Verificar cada vez que cambie el DOM
      const observer = new MutationObserver(checkVisibility);
      observer.observe(document.body, { 
        attributes: true, 
        childList: true, 
        subtree: true 
      });
      
      return () => observer.disconnect();
    }
  }, []);
  
  // Silenciar errores específicos de SwiftLaTeX
  useEffect(() => {
    // Guardar la función original de console.error
    const originalConsoleError = console.error;
    
    // Reemplazar con una versión que filtra los errores de SwiftLaTeX
    console.error = function(...args) {
      // Si el error contiene "Unknown command undefined" de SwiftLaTeX, lo ignoramos
      if (args.length > 0 && 
          typeof args[0] === 'string' && 
          args[0].includes('Unknown command undefined')) {
        return;
      }
      
      // Para todos los demás errores, usar la función original
      return originalConsoleError.apply(console, args);
    };
    
    // Restaurar la función original al desmontar el componente
    return () => {
      console.error = originalConsoleError;
    };
  }, []);
  
  // Limpiar contenido LaTeX para asegurarse que sea válido
  const cleanLatexContent = (content: string): string => {
    // Quitar los delimitadores si existen
    let cleaned = content;

    // Verificar si el contenido comienza con ```latex y termina con ```
    if (cleaned.startsWith("```latex")) {
      cleaned = cleaned.substring(8);
      if (cleaned.endsWith("```")) {
        cleaned = cleaned.substring(0, cleaned.length - 3);
      }
    }
    
    // Verificar si el contenido comienza con '''latex y termina con '''
    if (cleaned.startsWith("'''latex")) {
      cleaned = cleaned.substring(7); 
      if (cleaned.endsWith("'''")) {
        cleaned = cleaned.substring(0, cleaned.length - 3);
      }
    }

    return cleaned.trim();
  };

  // Inicializar el engine una sola vez
  useEffect(() => {
    // Cargar el script solo si está en el lado del cliente
    if (typeof window === 'undefined') return;
    
    const loadScripts = async () => {
      try {
        // Cargar primero swiftlatexpdftex.js
        await new Promise<void>((resolve, reject) => {
          if (document.querySelector('script[src="/swiftlatexpdftex.js"]')) {
            resolve();
            return;
          }
          
          const pdftexScript = document.createElement('script');
          pdftexScript.src = '/swiftlatexpdftex.js';
          pdftexScript.async = true;
          pdftexScript.onload = () => {
            console.log("Script swiftlatexpdftex.js cargado");
            resolve();
          };
          pdftexScript.onerror = (e) => {
            console.error("Error cargando swiftlatexpdftex.js:", e);
            reject(new Error("No se pudo cargar el motor LaTeX (pdftex)"));
          };
          document.body.appendChild(pdftexScript);
        });
        
        // Luego cargar PdfTeXEngine.js
        await new Promise<void>((resolve, reject) => {
          if (document.querySelector('script[src="/PdfTeXEngine.js"]')) {
            resolve();
            return;
          }
          
          const engineScript = document.createElement('script');
          engineScript.src = '/PdfTeXEngine.js';
          engineScript.async = true;
          engineScript.onload = () => {
            console.log("Script PdfTeXEngine.js cargado");
            resolve();
          };
          engineScript.onerror = (e) => {
            console.error("Error cargando PdfTeXEngine.js:", e);
            reject(new Error("No se pudo cargar el motor LaTeX (engine)"));
          };
          document.body.appendChild(engineScript);
        });
        
        // Esperar un momento para asegurarse de que todo está inicializado
        await new Promise(resolve => setTimeout(resolve, 500));
        
        return true;
      } catch (error) {
        console.error("Error cargando scripts:", error);
        throw error;
      }
    };

    const initEngine = async () => {
      if (engineInitialized.current) return;
      
      try {
        await loadScripts();
        
        // Verificar que PdfTeXEngine esté disponible
        if (typeof window.PdfTeXEngine !== 'function') {
          console.error("PdfTeXEngine no está disponible como constructor");
          throw new Error("El motor LaTeX no está disponible correctamente");
        }
        
        // Crear e inicializar el motor
        console.log("Inicializando PdfTeXEngine...");
        const engine = new window.PdfTeXEngine();
        await engine.loadEngine();
        
        if (engine.isReady && engine.isReady()) {
          console.log("PdfTeXEngine inicializado correctamente");
          engineRef.current = engine;
          engineInitialized.current = true;
          compilePdfFromLatex();
        } else {
          throw new Error("No se pudo inicializar el motor LaTeX");
        }
      } catch (err) {
        console.error("Error inicializando el motor:", err);
        setError("Error al cargar el motor LaTeX: " + (err instanceof Error ? err.message : String(err)));
        setIsLoading(false);
      }
    };
    
    initEngine();

    // Limpiar al desmontar
    return () => {
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
      }
    };
  }, []);

  // Efecto para compilar cuando cambia el contenido LaTeX
  useEffect(() => {
    if (engineInitialized.current && engineRef.current) {
      compilePdfFromLatex();
    }
  }, [latexContent]);

  // Compilar LaTeX
  const compilePdfFromLatex = async () => {
    if (!engineRef.current || !engineRef.current.isReady || !engineRef.current.isReady()) {
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      
      // Limpiar URL anterior si existe
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
        setPdfUrl(null);
      }
      
      const cleanedContent = cleanLatexContent(latexContent);
      console.log("Compilando LaTeX...");
      
      // Compilar siguiendo exactamente el ejemplo
      engineRef.current.writeMemFSFile("main.tex", cleanedContent);
      engineRef.current.setEngineMainFile("main.tex");
      const result = await engineRef.current.compileLaTeX();
      
      console.log("Compilación completada, estado:", result.status);
      setCompilationLog(result.log);
      
      if (result.status === 0 && result.pdf && result.pdf.length > 0) {
        const pdfblob = new Blob([result.pdf], {type: 'application/pdf'});
        const objectURL = URL.createObjectURL(pdfblob);
        setPdfUrl(objectURL);
        
        // Notificar que el PDF está listo
        if (onPdfReady) {
          onPdfReady(objectURL);
        }
      } else {
        // Extraer mensaje de error del log
        const logLines = result.log.split('\n');
        let errorMessage = "Error en la compilación LaTeX. Revisa el log para más detalles.";
        
        // Buscar líneas de error en el log
        const errorLines = logLines.filter((line: string) => 
          line.includes('!') || 
          line.includes('Error') || 
          line.includes('Fatal') ||
          line.includes('Undefined control sequence')
        );
        
        if (errorLines.length > 0) {
          errorMessage = errorLines[0].trim();
        }
        
        setError(errorMessage);
      }
    } catch (err: any) {
      console.error("Error en la compilación:", err);
      setError(`Error: ${err.message || "Ocurrió un error desconocido durante la compilación"}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Ajustar altura del iframe
  useEffect(() => {
    if (pdfUrl && iframeRef.current) {
      const onIframeLoad = () => {
        try {
          const iframe = iframeRef.current as HTMLIFrameElement;
          if (iframe && iframe.contentWindow) {
            const height = iframe.contentWindow.document.body.scrollHeight;
            iframe.style.height = `${Math.max(height, 800)}px`;
          }
        } catch (e) {
          console.error("Error al ajustar altura del iframe:", e);
        }
      };

      const iframe = iframeRef.current;
      iframe.addEventListener('load', onIframeLoad);
      
      return () => {
        iframe.removeEventListener('load', onIframeLoad);
      };
    }
  }, [pdfUrl]);

  // Si el componente está oculto, solo renderizar lo mínimo necesario para la compilación
  if (isHidden) {
    return <div ref={containerRef} className="latex-viewer-container hidden" />;
  }

  return (
    <div className="latex-viewer-container" ref={containerRef}>
      {isLoading ? (
        <div className="flex justify-center items-center py-16">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
          <span className="ml-3 text-lg">Compilando documento LaTeX...</span>
        </div>
      ) : error ? (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
          <h3 className="text-lg font-medium text-red-800 mb-2">Error en la compilación</h3>
          <p className="text-red-700">{error}</p>
          
          {compilationLog && (
            <div className="mt-4">
              <details open>
                <summary className="cursor-pointer text-sm font-medium mb-2 p-1 bg-red-100 hover:bg-red-200 rounded-md">
                  Ver log de compilación
                </summary>
                <pre className="p-3 bg-gray-800 text-gray-200 rounded text-xs overflow-x-auto max-h-96 whitespace-pre-wrap">
                  {compilationLog}
                </pre>
              </details>
            </div>
          )}

          <div className="mt-4 pt-3 border-t border-red-200">
            <h4 className="text-md font-medium text-red-800 mb-2">Sugerencias de solución:</h4>
            <ul className="list-disc list-inside text-sm text-red-700 space-y-1">
              <li>Revisa la sintaxis LaTeX en tu documento</li>
              <li>Comprueba que todos los comandos y entornos estén bien cerrados (begin/end)</li>
              <li>Asegúrate de no usar comandos no estándar o paquetes no soportados</li>
              <li>Verifica que el documento tenga estructura completa (documentclass, begin/end document)</li>
            </ul>
          </div>
        </div>
      ) : pdfUrl ? (
        <div className="pdf-container border rounded-lg overflow-hidden shadow-lg">
          <iframe
            ref={iframeRef}
            src={pdfUrl}
            className="w-full min-h-[800px]"
            title="PDF Preview"
          />
        </div>
      ) : (
        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="text-yellow-700">No se pudo generar la vista previa del PDF.</p>
        </div>
      )}
    </div>
  );
};

export default SwiftLaTeXViewer; 