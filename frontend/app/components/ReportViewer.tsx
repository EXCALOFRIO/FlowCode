'use client';

import { useState, useEffect, useRef } from 'react';
import SwiftLaTeXViewer from './SwiftLaTeXViewer';

interface ReportViewerProps {
  report: string; // Se espera que sea el contenido LaTeX crudo
  onBack: () => void;
}

export default function ReportViewer({ report, onBack }: ReportViewerProps) {
  const [isClient, setIsClient] = useState(false);
  const [cleanedReport, setCleanedReport] = useState('');
  const [isPdfReady, setIsPdfReady] = useState(false);
  const [isCompiling, setIsCompiling] = useState(false);
  const [pdfData, setPdfData] = useState<string | null>(null);
  const viewerRef = useRef<HTMLDivElement>(null);

  // Efecto para activar renderizado del cliente
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Efecto para limpiar el reporte de delimitadores
  useEffect(() => {
    // Limpiar el reporte de posibles delimitadores
    let currentReport = report;
    
    // Quitar delimitadores de código
    if (currentReport.startsWith("```latex")) {
      currentReport = currentReport.substring(8);
      if (currentReport.endsWith("```")) {
        currentReport = currentReport.substring(0, currentReport.length - 3);
      }
    }
    
    // Quitar otro tipo de delimitadores
    if (currentReport.startsWith("'''latex")) {
      currentReport = currentReport.substring(7);
      if (currentReport.endsWith("'''")) {
        currentReport = currentReport.substring(0, currentReport.length - 3);
      }
    }
    
    setCleanedReport(currentReport.trim());
    // Resetear el estado del PDF cuando cambia el reporte
    setIsPdfReady(false);
    setIsCompiling(true);
    setPdfData(null);
  }, [report]);

  // Función para manejar cuando el PDF está listo
  const handlePdfReady = (pdfUrl: string) => {
    console.log("PDF compilado y listo para mostrar");
    setPdfData(pdfUrl);
    setIsPdfReady(true);
    setIsCompiling(false);
  };

  // Si no estamos en el cliente, mostramos una pantalla de carga básica
  if (!isClient) {
    return (
      <div className="w-full h-full flex justify-center items-center">
        <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-blue-500"></div>
        <span className="ml-4 text-xl font-medium">Cargando...</span>
      </div>
    );
  }

  return (
    <div className="w-full h-screen min-h-screen relative" ref={viewerRef}>
      {/* Siempre renderizamos el SwiftLaTeXViewer pero lo ocultamos si no está listo */}
      <div className={isPdfReady ? "" : "hidden"}>
        <div className="pdf-container h-screen min-h-screen">
          {isPdfReady && pdfData && (
            <iframe 
              src={pdfData}
              className="w-full h-screen min-h-screen"
              title="PDF Preview"
            />
          )}
          {/* Botón Volver eliminado */}
        </div>
      </div>
      
      {/* Pantalla de compilación */}
      {!isPdfReady && (
        <div className="w-full h-screen min-h-screen flex flex-col justify-center items-center">
          <div className="hidden">
            <SwiftLaTeXViewer 
              latexContent={cleanedReport} 
              onPdfReady={handlePdfReady} 
            />
          </div>
          
          <div className="text-center mb-6">
            {isCompiling && (
              <>
                <div className="animate-spin mx-auto rounded-full h-16 w-16 border-t-4 border-b-4 border-blue-500 mb-4"></div>
                <h2 className="text-2xl font-semibold mb-2">Compilando documento PDF</h2>
                <p className="text-gray-600 mb-6">Por favor espere, el documento se está generando...</p>
              </>
            )}
          </div>
          {/* Botón Volver eliminado */}
        </div>
      )}

      <style jsx global>{`
        .pdf-container {
          width: 100%;
          height: 100%;
          background: #f8f9fa;
          overflow: auto;
          position: relative;
        }
        
        .pdf-container iframe {
          min-height: 100%;
          width: 100%;
        }
      `}</style>
    </div>
  );
}